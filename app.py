from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "flashcards.db"
STATUS_CHOICES = {"know", "kind_of_know", "dont_know"}


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
                        FROM topics t
                        WHERE t.project_id = p.id
                    ) AS topic_count,
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
                        SELECT COALESCE(SUM(CASE WHEN f.status = 'kind_of_know' THEN 1 ELSE 0 END), 0)
                        FROM flashcards f
                        WHERE f.project_id = p.id
                    ) AS kind_of_know_count,
                    (
                        SELECT COALESCE(SUM(CASE WHEN f.status = 'dont_know' THEN 1 ELSE 0 END), 0)
                        FROM flashcards f
                        WHERE f.project_id = p.id
                    ) AS dont_know_count
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

            topics = conn.execute(
                """
                SELECT
                    t.id,
                    t.project_id,
                    t.name,
                    t.created_at,
                    (
                        SELECT COUNT(*)
                        FROM flashcards f
                        WHERE f.topic_id = t.id
                    ) AS card_count
                FROM topics t
                WHERE t.project_id = ?
                ORDER BY t.created_at DESC
                """,
                (project_id,),
            ).fetchall()

            stats = conn.execute(
                """
                SELECT
                    COUNT(*) AS total_cards,
                    COALESCE(SUM(CASE WHEN status = 'know' THEN 1 ELSE 0 END), 0) AS know_count,
                    COALESCE(SUM(CASE WHEN status = 'kind_of_know' THEN 1 ELSE 0 END), 0) AS kind_of_know_count,
                    COALESCE(SUM(CASE WHEN status = 'dont_know' THEN 1 ELSE 0 END), 0) AS dont_know_count
                FROM flashcards
                WHERE project_id = ?
                """,
                (project_id,),
            ).fetchone()

        return jsonify(
            {
                "project": dict(project),
                "topics": [dict(row) for row in topics],
                "stats": dict(stats),
            }
        )

    @app.post("/api/projects/<int:project_id>/topics")
    def create_topic(project_id: int) -> Any:
        payload = request.get_json(silent=True) or {}
        name = str(payload.get("name", "")).strip()

        if not name:
            return jsonify({"error": "Topic name is required."}), 400

        with get_conn() as conn:
            project = conn.execute(
                "SELECT id FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
            if project is None:
                return jsonify({"error": "Project not found."}), 404

            existing = conn.execute(
                "SELECT id FROM topics WHERE project_id = ? AND lower(name) = lower(?)",
                (project_id, name),
            ).fetchone()
            if existing is not None:
                return jsonify({"error": "Topic already exists in this project."}), 400

            cursor = conn.execute(
                "INSERT INTO topics (project_id, name, created_at) VALUES (?, ?, ?)",
                (project_id, name, utc_now()),
            )
            topic_id = cursor.lastrowid
            conn.commit()

            topic = conn.execute(
                """
                SELECT id, project_id, name, created_at, 0 AS card_count
                FROM topics
                WHERE id = ?
                """,
                (topic_id,),
            ).fetchone()

        return jsonify({"topic": dict(topic)}), 201

    @app.get("/api/projects/<int:project_id>/cards")
    def get_project_cards(project_id: int) -> Any:
        status = request.args.get("status", "all").strip()
        topic_raw = request.args.get("topic_id", "all").strip()

        if status != "all" and status not in STATUS_CHOICES:
            return jsonify({"error": "Invalid status filter."}), 400

        topic_id = parse_topic_id(topic_raw)
        if topic_raw != "all" and topic_id is None:
            return jsonify({"error": "Invalid topic filter."}), 400

        with get_conn() as conn:
            project = conn.execute(
                "SELECT id FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
            if project is None:
                return jsonify({"error": "Project not found."}), 404

            params: list[Any] = [project_id]
            where_parts = ["f.project_id = ?"]

            if status != "all":
                where_parts.append("f.status = ?")
                params.append(status)

            if topic_id is not None:
                topic = conn.execute(
                    "SELECT id FROM topics WHERE id = ? AND project_id = ?",
                    (topic_id, project_id),
                ).fetchone()
                if topic is None:
                    return jsonify({"error": "Topic not found in this project."}), 404
                where_parts.append("f.topic_id = ?")
                params.append(topic_id)

            query = f"""
                SELECT
                    f.id,
                    f.project_id,
                    f.topic_id,
                    t.name AS topic_name,
                    f.question,
                    f.answer,
                    f.status,
                    f.created_at,
                    f.updated_at
                FROM flashcards f
                LEFT JOIN topics t ON t.id = f.topic_id
                WHERE {' AND '.join(where_parts)}
                ORDER BY f.created_at ASC
            """
            rows = conn.execute(query, tuple(params)).fetchall()

        return jsonify({"cards": [serialize_card(row) for row in rows]})

    @app.post("/api/projects/<int:project_id>/cards")
    def add_manual_card(project_id: int) -> Any:
        payload = request.get_json(silent=True) or {}
        question = str(payload.get("question", "")).strip()
        definition = str(payload.get("definition", payload.get("answer", ""))).strip()

        if not question or not definition:
            return jsonify({"error": "Question and definition are required."}), 400

        raw_topic_id = payload.get("topic_id")
        topic_id = parse_topic_id(raw_topic_id)
        if raw_topic_id not in (None, "", "all") and topic_id is None:
            return jsonify({"error": "Invalid topic value."}), 400

        with get_conn() as conn:
            project = conn.execute(
                "SELECT id FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
            if project is None:
                return jsonify({"error": "Project not found."}), 404

            if topic_id is not None:
                topic = conn.execute(
                    "SELECT id FROM topics WHERE id = ? AND project_id = ?",
                    (topic_id, project_id),
                ).fetchone()
                if topic is None:
                    return jsonify({"error": "Topic not found in this project."}), 400

            cursor = conn.execute(
                """
                INSERT INTO flashcards
                    (project_id, topic_id, question, answer, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'dont_know', ?, ?)
                """,
                (project_id, topic_id, question, definition, utc_now(), utc_now()),
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

            CREATE TABLE IF NOT EXISTS topics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS flashcards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                topic_id INTEGER,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'dont_know',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE SET NULL
            );
            """
        )

        ensure_flashcards_topic_column(conn)

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_topics_project_id ON topics(project_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_flashcards_project_id ON flashcards(project_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_flashcards_topic_id ON flashcards(topic_id)"
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_flashcards_status ON flashcards(status)")
        conn.commit()


def ensure_flashcards_topic_column(conn: sqlite3.Connection) -> None:
    columns = conn.execute("PRAGMA table_info(flashcards)").fetchall()
    names = {row["name"] for row in columns}
    if "topic_id" not in names:
        conn.execute("ALTER TABLE flashcards ADD COLUMN topic_id INTEGER")


def parse_topic_id(raw_value: Any) -> int | None:
    if raw_value in (None, "", "all"):
        return None

    try:
        topic_id = int(raw_value)
    except (TypeError, ValueError):
        return None

    if topic_id <= 0:
        return None

    return topic_id


def fetch_card(conn: sqlite3.Connection, card_id: int) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT
            f.id,
            f.project_id,
            f.topic_id,
            t.name AS topic_name,
            f.question,
            f.answer,
            f.status,
            f.created_at,
            f.updated_at
        FROM flashcards f
        LEFT JOIN topics t ON t.id = f.topic_id
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
