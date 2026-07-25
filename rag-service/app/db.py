def to_pgvector(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.8f}" for x in vec) + "]"


class Db:
    def __init__(self, client):
        self._client = client

    def insert_document(self, title, source, doc_type, target_profiles) -> str:
        res = (
            self._client.table("documents")
            .insert(
                {
                    "title": title,
                    "source": source,
                    "doc_type": doc_type,
                    "target_profiles": target_profiles,
                }
            )
            .execute()
        )
        return res.data[0]["id"]

    def insert_chunks(self, document_id, contents, embeddings, metadatas) -> None:
        rows = [
            {
                "document_id": document_id,
                "content": content,
                "embedding": to_pgvector(embedding),
                "chunk_index": i,
                "metadata": metadata,
            }
            for i, (content, embedding, metadata) in enumerate(
                zip(contents, embeddings, metadatas)
            )
        ]
        self._client.table("document_chunks").insert(rows).execute()

    def match_chunks(self, query_embedding, match_count, filter_profiles) -> list[dict]:
        res = self._client.rpc(
            "match_document_chunks",
            {
                "query_embedding": to_pgvector(query_embedding),
                "match_count": match_count,
                "filter_profiles": filter_profiles,
            },
        ).execute()
        return res.data or []
