# Flashcard Maker (Manual Project + Topic Flashcards)

Flashcard Maker is a local web app for serious study prep. It lets you create unlimited projects, organize them by topics, and manually add flashcards with a **question** and **definition**.

No PDF/slide upload or auto-generation is used in this version.

## What you can do

- Create as many projects as you want (courses, exam tracks, research areas)
- Create as many topics inside each project as you want
- Add manual flashcards with:
  - Question
  - Definition
  - Optional topic assignment
- Study cards in click-through mode
- Mark mastery per card:
  - `Know`
  - `Kind of know`
  - `Don't know`
- Filter by status and by topic
- Use **light mode** or **dark mode** (toggle in UI)

## Quick start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open [http://localhost:8000](http://localhost:8000).

## Data storage

- SQLite database: `flashcards.db`
- Theme preference is saved in browser local storage.

## API

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/<id>`
- `POST /api/projects/<id>/topics`
- `GET /api/projects/<id>/cards?status=all|know|kind_of_know|dont_know&topic_id=all|<topic_id>`
- `POST /api/projects/<id>/cards`
- `PATCH /api/cards/<id>/status`
