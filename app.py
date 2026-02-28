from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "flashcards.db"
STATUS_CHOICES = {"know", "didnt_know"}


def create_app() -> Flask:
    app = Flask(__name__)
    init_db()

    @app.get("/")
    def index() -> str:
        return render_template("index.html")

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
        payload = request.get_json(silent=True) or {}
        question = str(payload.get("question", "")).strip()
        definition = str(payload.get("definition", payload.get("answer", ""))).strip()

        if not question or not definition:
            return jsonify({"error": "Question and definition are required."}), 400

        with get_conn() as conn:
            project = conn.execute(
                "SELECT id FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
            if project is None:
                return jsonify({"error": "Project not found."}), 404

            cursor = conn.execute(
                """
                INSERT INTO flashcards
                    (project_id, question, answer, status, created_at, updated_at)
                VALUES (?, ?, ?, 'didnt_know', ?, ?)
                """,
                (project_id, question, definition, utc_now(), utc_now()),
            )
            card_id = cursor.lastrowid
            conn.commit()

            card = fetch_card(conn, card_id)

        if card is None:
            return jsonify({"error": "Could not load saved flashcard."}), 500

        return jsonify({"card": serialize_card(card)}), 201

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


def fetch_card(conn: sqlite3.Connection, card_id: int) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT
            f.id,
            f.project_id,
            f.question,
            f.answer,
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
    return payload


app = create_app()


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8000)
