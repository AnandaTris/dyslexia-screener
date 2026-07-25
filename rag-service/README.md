# Dyslexia RAG Service

Standalone FastAPI service for the learning-journey RAG feature. Called only by
the Next.js app (server-to-server) with the `X-Service-Token` header.

## Setup

Install Ollama from https://ollama.com, then pull the models (once):

```bash
ollama pull nomic-embed-text
ollama pull llama3.1:8b
ollama serve                  # leave running (or it runs as a background service)
```

Then the Python service:

```bash
cd rag-service
python -m venv .venv
. .venv/Scripts/activate      # Windows; use source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env          # then fill in the values
```

`.env` values: `SERVICE_TOKEN` (a long random string shared with the Next.js
app), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `OLLAMA_HOST` (default
`http://localhost:11434`). No hosted-LLM API key is needed — the model is local.

Apply the database schema first: run `supabase/rag_schema.sql` in the Supabase
SQL Editor.

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

## Test

```bash
pytest -v
```

## Ingest a source document

```bash
python scripts/ingest_file.py ./phonics.pdf --title "Phonics Guide" \
    --doc-type guide --profiles phonological
```
