from __future__ import annotations

import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "flashcards.db"
UPLOAD_IMAGE_DIR = BASE_DIR / "uploads" / "cards"
STATUS_CHOICES = {"know", "didnt_know"}
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024

    UPLOAD_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    init_db()

    @app.get("/")
    def index() -> str:
        return render_template("index.html")

    @app.get("/uploads/cards/<path:filename>")
    def serve_card_image(filename: str) -> Any:
        return send_from_directory(UPLOAD_IMAGE_DIR, filename)

    @app.get("/api/health")
    def health() -> Any:
        return jsonify({"ok": True, "timestamp": utc_now()})

    @app.get("/api/projects")
    def get_projects() -> Any:
        with get_conn() as conn:
            rows = conn.execute(
                """
                SELECT
                    p.id,
                    p.name,
                    p.description,
                    p.created_at,
                    (
                        SELECT COUNT(*)
                        FROM flashcards f
                        WHERE f.project_id = p.id
                    ) AS total_cards,
                    (
                        SELECT COALESCE(SUM(CASE WHEN f.status = 'know' THEN 1 ELSE 0 END), 0)
                        FROM flashcards f
                        WHERE f.project_id = p.id
                    ) AS know_count,
                    (
                        SELECT COALESCE(SUM(CASE WHEN f.status = 'didnt_know' THEN 1 ELSE 0 END), 0)
                        FROM flashcards f
                        WHERE f.project_id = p.id
                    ) AS didnt_know_count
                FROM projects p
                ORDER BY p.created_at DESC
                """
            ).fetchall()

        return jsonify({"projects": [dict(row) for row in rows]})

    @app.post("/api/projects")
    def create_project() -> Any:
        payload = request.get_json(silent=True) or {}
        name = str(payload.get("name", "")).strip()
        description = str(payload.get("description", "")).strip()

        if not name:
            return jsonify({"error": "Project name is required."}), 400

        with get_conn() as conn:
            cursor = conn.execute(
                "INSERT INTO projects (name, description, created_at) VALUES (?, ?, ?)",
                (name, description, utc_now()),
            )
            project_id = cursor.lastrowid
            conn.commit()

            project = conn.execute(
                "SELECT id, name, description, created_at FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()

        return jsonify({"project": dict(project)}), 201

    @app.get("/api/projects/<int:project_id>")
    def get_project(project_id: int) -> Any:
        with get_conn() as conn:
            project = conn.execute(
                "SELECT id, name, description, created_at FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
            if project is None:
                return jsonify({"error": "Project not found."}), 404

            stats = conn.execute(
                """
                SELECT
                    COUNT(*) AS total_cards,
                    COALESCE(SUM(CASE WHEN status = 'know' THEN 1 ELSE 0 END), 0) AS know_count,
                    COALESCE(SUM(CASE WHEN status = 'didnt_know' THEN 1 ELSE 0 END), 0) AS didnt_know_count
                FROM flashcards
                WHERE project_id = ?
                """,
                (project_id,),
            ).fetchone()

        return jsonify({"project": dict(project), "stats": dict(stats)})

    @app.get("/api/projects/<int:project_id>/cards")
    def get_project_cards(project_id: int) -> Any:
        status = request.args.get("status", "all").strip()
        if status != "all" and status not in STATUS_CHOICES:
            return jsonify({"error": "Invalid status filter."}), 400

        with get_conn() as conn:
            project = conn.execute(
                "SELECT id FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
            if project is None:
                return jsonify({"error": "Project not found."}), 404

            if status == "all":
                rows = conn.execute(
                    """
                    SELECT
                        f.id,
                        f.project_id,
                        f.question,
                        f.answer,
                        f.image_path,
                        f.status,
                        f.created_at,
                        f.updated_at
                    FROM flashcards f
                    WHERE f.project_id = ?
                    ORDER BY f.created_at ASC
                    """,
                    (project_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT
                        f.id,
                        f.project_id,
                        f.question,
                        f.answer,
                        f.image_path,
                        f.status,
                        f.created_at,
                        f.updated_at
                    FROM flashcards f
                    WHERE f.project_id = ? AND f.status = ?
                    ORDER BY f.created_at ASC
                    """,
                    (project_id, status),
                ).fetchall()

        return jsonify({"cards": [serialize_card(row) for row in rows]})

    @app.post("/api/projects/<int:project_id>/cards")
    def create_card(project_id: int) -> Any:
        question, definition = parse_question_and_definition()
        if not question or not definition:
            return jsonify({"error": "Question and definition are required."}), 400

        image_filename = None
        try:
            image_filename = store_uploaded_image(request.files.get("image"))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        with get_conn() as conn:
            project = conn.execute(
                "SELECT id FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
            if project is None:
                if image_filename:
                    remove_image_file(image_filename)
                return jsonify({"error": "Project not found."}), 404

            cursor = conn.execute(
                """
                INSERT INTO flashcards
                    (project_id, question, answer, image_path, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'didnt_know', ?, ?)
                """,
                (
                    project_id,
                    question,
                    definition,
                    image_filename,
                    utc_now(),
                    utc_now(),
                ),
            )
            card_id = cursor.lastrowid
            conn.commit()

            card = fetch_card(conn, card_id)

        if card is None:
            return jsonify({"error": "Could not load saved flashcard."}), 500

        return jsonify({"card": serialize_card(card)}), 201

    @app.patch("/api/cards/<int:card_id>")
    def update_card(card_id: int) -> Any:
        question, definition = parse_question_and_definition()
        if not question or not definition:
            return jsonify({"error": "Question and definition are required."}), 400

        clear_image = parse_bool(value_from_request("clear_image"))
        uploaded_image = request.files.get("image")

        saved_new_image: str | None = None
        if uploaded_image and uploaded_image.filename:
            try:
                saved_new_image = store_uploaded_image(uploaded_image)
            except ValueError as exc:
                return jsonify({"error": str(exc)}), 400

        with get_conn() as conn:
            existing = fetch_card(conn, card_id)
            if existing is None:
                if saved_new_image:
                    remove_image_file(saved_new_image)
                return jsonify({"error": "Card not found."}), 404

            next_image = existing["image_path"]
            if clear_image:
                next_image = None

            if saved_new_image:
                next_image = saved_new_image

            conn.execute(
                """
                UPDATE flashcards
                SET question = ?, answer = ?, image_path = ?, updated_at = ?
                WHERE id = ?
                """,
                (question, definition, next_image, utc_now(), card_id),
            )
            conn.commit()

            updated = fetch_card(conn, card_id)

        old_image = existing["image_path"]
        if clear_image and old_image:
            remove_image_file(old_image)
        if saved_new_image and old_image and old_image != saved_new_image:
            remove_image_file(old_image)

        if updated is None:
            return jsonify({"error": "Card not found."}), 404

        return jsonify({"card": serialize_card(updated)})

    @app.delete("/api/cards/<int:card_id>")
    def delete_card(card_id: int) -> Any:
        with get_conn() as conn:
            card = fetch_card(conn, card_id)
            if card is None:
                return jsonify({"error": "Card not found."}), 404

            conn.execute("DELETE FROM flashcards WHERE id = ?", (card_id,))
            conn.commit()

        if card["image_path"]:
            remove_image_file(card["image_path"])

        return jsonify({"deleted": True, "card_id": card_id})

    @app.patch("/api/cards/<int:card_id>/status")
    def update_card_status(card_id: int) -> Any:
        payload = request.get_json(silent=True) or {}
        status = str(payload.get("status", "")).strip()

        if status not in STATUS_CHOICES:
            return jsonify({"error": "Invalid status value."}), 400

        with get_conn() as conn:
            existing = conn.execute(
                "SELECT id FROM flashcards WHERE id = ?",
                (card_id,),
            ).fetchone()
            if existing is None:
                return jsonify({"error": "Card not found."}), 404

            conn.execute(
                "UPDATE flashcards SET status = ?, updated_at = ? WHERE id = ?",
                (status, utc_now(), card_id),
            )
            conn.commit()

            card = fetch_card(conn, card_id)

        if card is None:
            return jsonify({"error": "Card not found."}), 404

        return jsonify({"card": serialize_card(card)})

    return app


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS flashcards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'didnt_know',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            """
        )

        ensure_flashcards_image_column(conn)

        # Older versions may have legacy status values from 3-level mastery.
        conn.execute(
            """
            UPDATE flashcards
            SET status = 'didnt_know'
            WHERE status IN ('dont_know', 'kind_of_know') OR status IS NULL OR status = ''
            """
        )

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_flashcards_project_id ON flashcards(project_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_flashcards_status ON flashcards(status)"
        )
        conn.commit()


def ensure_flashcards_image_column(conn: sqlite3.Connection) -> None:
    columns = conn.execute("PRAGMA table_info(flashcards)").fetchall()
    names = {row["name"] for row in columns}
    if "image_path" not in names:
        conn.execute("ALTER TABLE flashcards ADD COLUMN image_path TEXT")


def value_from_request(key: str) -> Any:
    if request.content_type and "multipart/form-data" in request.content_type:
        return request.form.get(key)

    payload = request.get_json(silent=True) or {}
    return payload.get(key)


def parse_question_and_definition() -> tuple[str, str]:
    if request.content_type and "multipart/form-data" in request.content_type:
        question = str(request.form.get("question", "")).strip()
        definition = str(request.form.get("definition", request.form.get("answer", ""))).strip()
        return question, definition

    payload = request.get_json(silent=True) or {}
    question = str(payload.get("question", "")).strip()
    definition = str(payload.get("definition", payload.get("answer", ""))).strip()
    return question, definition


def parse_bool(raw: Any) -> bool:
    if isinstance(raw, bool):
        return raw
    if raw is None:
        return False
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def sanitize_filename_stem(stem: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9_-]", "_", stem).strip("_")
    return clean[:80] or "card_image"


def store_uploaded_image(file_obj: Any) -> str | None:
    if file_obj is None:
        return None

    filename = str(getattr(file_obj, "filename", "")).strip()
    if not filename:
        return None

    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_IMAGE_EXTENSIONS:
        raise ValueError("Unsupported image type. Use PNG, JPG, JPEG, WEBP, or GIF.")

    stem = sanitize_filename_stem(Path(filename).stem)
    storage_name = f"{uuid.uuid4().hex}_{stem}{suffix}"
    file_obj.save(UPLOAD_IMAGE_DIR / storage_name)
    return storage_name


def remove_image_file(filename: str) -> None:
    if not filename:
        return
    (UPLOAD_IMAGE_DIR / filename).unlink(missing_ok=True)


def fetch_card(conn: sqlite3.Connection, card_id: int) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT
            f.id,
            f.project_id,
            f.question,
            f.answer,
            f.image_path,
            f.status,
            f.created_at,
            f.updated_at
        FROM flashcards f
        WHERE f.id = ?
        """,
        (card_id,),
    ).fetchone()


def serialize_card(row: sqlite3.Row) -> dict[str, Any]:
    payload = dict(row)
    payload["definition"] = payload.get("answer", "")
    payload["image_url"] = (
        f"/uploads/cards/{payload['image_path']}" if payload.get("image_path") else None
    )
    return payload


app = create_app()


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8000)
