from app.chunking import chunk_text


def ingest_document(*, title, source, doc_type, target_profiles, text,
                    embedder, db, chunker=chunk_text) -> dict:
    chunks = chunker(text)
    if not chunks:
        raise ValueError("Document produced no chunks (empty text?)")

    embeddings = embedder.embed_batch(chunks)
    metadatas = [{"doc_type": doc_type, "target_profiles": target_profiles} for _ in chunks]

    document_id = db.insert_document(title, source, doc_type, target_profiles)
    db.insert_chunks(document_id, chunks, embeddings, metadatas)
    return {"document_id": document_id, "chunks": len(chunks)}
