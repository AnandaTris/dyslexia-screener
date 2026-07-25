"""Ingest a local .txt or .pdf file into the RAG store.

Usage:
    python scripts/ingest_file.py path/to/file.pdf \
        --title "Phonics Guide" --doc-type guide --profiles phonological surface
"""
import argparse
import sys
from pathlib import Path

import ollama
from pypdf import PdfReader
from supabase import create_client

# Allow running as a plain script: put the service root (rag-service/) on the
# import path so `import app` resolves regardless of the current directory.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings
from app.db import Db
from app.embeddings import Embedder
from app.ingest import ingest_document


def read_text(path: str) -> str:
    if path.lower().endswith(".pdf"):
        reader = PdfReader(path)
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    with open(path, encoding="utf-8") as f:
        return f.read()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("--title", required=True)
    parser.add_argument("--doc-type", required=True, choices=["exercise", "guide", "article"])
    parser.add_argument("--profiles", nargs="*", default=[])
    args = parser.parse_args()

    settings = get_settings()
    client = ollama.Client(host=settings.ollama_host)
    db = Db(create_client(settings.supabase_url, settings.supabase_service_role_key))
    embedder = Embedder(client, settings.embedding_model)

    result = ingest_document(
        title=args.title, source=args.path, doc_type=args.doc_type,
        target_profiles=args.profiles, text=read_text(args.path),
        embedder=embedder, db=db,
    )
    print(f"Ingested '{args.title}': {result['chunks']} chunks -> {result['document_id']}")


if __name__ == "__main__":
    main()
