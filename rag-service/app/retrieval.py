def retrieve(query: str, *, embedder, db, k: int = 6,
             profiles: list[str] | None = None, threshold: float = 0.5) -> list[dict]:
    query_embedding = embedder.embed(query)
    rows = db.match_chunks(query_embedding, k, profiles)
    return [r for r in rows if r.get("similarity", 0.0) >= threshold]
