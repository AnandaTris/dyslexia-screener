import pytest

from app.ingest import ingest_document


class FakeEmbedder:
    def embed_batch(self, texts):
        return [[float(len(t))] for t in texts]


class FakeDb:
    def __init__(self):
        self.document = None
        self.chunks = None

    def insert_document(self, title, source, doc_type, target_profiles):
        self.document = (title, source, doc_type, target_profiles)
        return "doc-9"

    def insert_chunks(self, document_id, contents, embeddings, metadatas):
        self.chunks = (document_id, contents, embeddings, metadatas)


def fake_chunker(text, **kwargs):
    return ["chunk-a", "chunk-b"]


def test_ingest_stores_document_and_chunks():
    db = FakeDb()
    out = ingest_document(
        title="T", source="s", doc_type="guide",
        target_profiles=["phonological"], text="anything long enough",
        embedder=FakeEmbedder(), db=db, chunker=fake_chunker,
    )
    assert out == {"document_id": "doc-9", "chunks": 2}
    assert db.document == ("T", "s", "guide", ["phonological"])
    doc_id, contents, embeddings, metadatas = db.chunks
    assert doc_id == "doc-9"
    assert contents == ["chunk-a", "chunk-b"]
    assert embeddings == [[7.0], [7.0]]
    # each chunk's metadata records the parent doc_type for retrieval tagging
    assert metadatas[0]["doc_type"] == "guide"
    assert metadatas[0]["target_profiles"] == ["phonological"]


def test_ingest_rejects_empty_text():
    with pytest.raises(ValueError):
        ingest_document(
            title="T", source="s", doc_type="guide", target_profiles=[],
            text="   ", embedder=FakeEmbedder(), db=FakeDb(),
            chunker=lambda text, **k: [],
        )
