"""Report which parts of supabase/rag_schema.sql are live in this project.

Reads rag-service/.env through app.config, so run it from rag-service/:

    .venv/Scripts/python.exe scripts/check_schema.py

Prints table names, row counts and pass/fail only — never a key — so the output
is safe to paste into an issue or a transcript.
"""
import socket
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from supabase import create_client

from app.config import get_settings

# Every table rag_schema.sql creates, in dependency order.
TABLES = [
    "documents",
    "document_chunks",
    "learner_profiles",
    "journeys",
    "journey_steps",
    "chat_messages",
]


def main() -> int:
    settings = get_settings()

    missing_config = [
        name
        for name, value in (
            ("SUPABASE_URL", settings.supabase_url),
            ("SUPABASE_SERVICE_ROLE_KEY", settings.supabase_service_role_key),
        )
        if not value
    ]
    if missing_config:
        print(f"FAIL  rag-service/.env is missing: {', '.join(missing_config)}")
        print("      config.py reads .env relative to the working directory —")
        print("      run this from rag-service/, not the repo root.")
        return 2

    host = urlparse(settings.supabase_url).hostname or ""
    print(f"Project: {settings.supabase_url}")

    # Reachability first. Every table probe below fails identically when the host
    # cannot be resolved, and reporting that as "schema missing" points whoever
    # reads it at the SQL editor when the real problem is that the project is gone.
    try:
        socket.getaddrinfo(host, 443)
        print(f"Host:    {host} resolves\n")
    except socket.gaierror as exc:
        print(f"Host:    {host} DOES NOT RESOLVE ({exc.strerror or exc})\n")
        print("The schema cannot be checked because the project is unreachable.")
        print("A Supabase project ref that does not resolve has been deleted or")
        print("renamed - a merely paused project still answers DNS. Check the")
        print("dashboard for the current project URL, then update both")
        print("NEXT_PUBLIC_SUPABASE_URL (root .env) and SUPABASE_URL (rag-service/.env).")
        return 3

    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    print()

    failures = []

    print("Tables:")
    for table in TABLES:
        try:
            res = client.table(table).select("*", count="exact").limit(0).execute()
            print(f"  OK       {table:<18} {res.count} rows")
        except Exception as exc:  # noqa: BLE001 - report every failure, don't stop
            failures.append(table)
            print(f"  MISSING  {table:<18} {_reason(exc)}")

    # The cosine-search function the retrieval path depends on. A zero vector is a
    # valid vector(768), so this exercises pgvector, the function signature and the
    # documents join without needing any ingested content.
    print("\nVector search:")
    try:
        client.rpc(
            "match_document_chunks",
            {"query_embedding": [0.0] * 768, "match_count": 1, "filter_profiles": None},
        ).execute()
        print("  OK       match_document_chunks(vector(768), int, text[])")
    except Exception as exc:  # noqa: BLE001
        failures.append("match_document_chunks")
        print(f"  MISSING  match_document_chunks  {_reason(exc)}")

    if failures:
        print(f"\n{len(failures)} missing: {', '.join(failures)}")
        print("Apply supabase/rag_schema.sql in the Supabase dashboard:")
        print("  SQL Editor -> New query -> paste the file -> Run. It is safe to re-run.")
        return 1

    print("\nSchema is fully applied.")
    return 0


def _reason(exc: Exception) -> str:
    text = str(exc).replace("\n", " ")
    return text[:120]


if __name__ == "__main__":
    raise SystemExit(main())
