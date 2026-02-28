# Flashcard Maker (Manual Project Flashcards)

Flashcard Maker is a local web app for study prep.

- Organize flashcards by **project**
- Manually add **question + definition** cards
- Study with a flip-card session view
- Track outcomes with only:
  - `Know`
  - `Didn't know`

No PDF/slide upload and no auto-generation.

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
- Theme/font preferences are saved in browser local storage.

## API

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/<id>`
- `GET /api/projects/<id>/cards?status=all|know|didnt_know`
- `POST /api/projects/<id>/cards`
- `PATCH /api/cards/<id>/status`
