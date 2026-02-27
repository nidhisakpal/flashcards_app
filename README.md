# FlashForge (Lecture -> Flashcards)

FlashForge is a local web app for exam prep. Upload lecture PDFs/PPTX files, generate detailed flashcards, and study with mastery buckets:

- `Know`
- `Kind of know`
- `Don't know`

You can manage separate projects (classes/exams) and keep each project's cards isolated.

## Features

- Project-based organization for multiple courses/exams
- Upload lecture files (`.pdf`, `.pptx`)
- Auto-generate flashcards from source material
- Click-through study mode with reveal/next/prev
- Mastery tracking with status filters
- Manual card creation for custom drilling
- SQLite persistence (data saved locally)

## Generation quality modes

- **OpenAI mode (recommended):** set `OPENAI_API_KEY` for higher-quality, exam-grade cards.
- **Local fallback:** if no key is set (or API call fails), app still generates cards with a deterministic local generator.

Optional env var:

- `OPENAI_MODEL` (default: `gpt-4.1-mini`)

## Quick start

1. Create and activate a virtualenv.
2. Install dependencies.
3. Run the Flask app.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Optional for better cards:
# export OPENAI_API_KEY="your_key"
# export OPENAI_MODEL="gpt-4.1-mini"

python app.py
```

Open:

- [http://localhost:8000](http://localhost:8000)

## Data storage

- SQLite DB: `flashcards.db`
- Uploaded files: `uploads/`

## API overview

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/<id>`
- `POST /api/projects/<id>/upload`
- `GET /api/projects/<id>/cards?status=all|know|kind_of_know|dont_know`
- `POST /api/projects/<id>/cards`
- `PATCH /api/cards/<id>/status`

## Notes

- `.ppt` (legacy PowerPoint binary) is not supported directly; convert to `.pptx` first.
- For best outcomes, upload text-rich lecture files (not scanned image-only PDFs).
