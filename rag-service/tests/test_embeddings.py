from app.embeddings import Embedder


class FakeClient:
    def __init__(self):
        self.calls = []

    def embed(self, model, input):
        self.calls.append((model, input))
        return {"embeddings": [[float(len(c))] for c in input]}


def test_embed_batch_returns_vector_per_text():
    client = FakeClient()
    emb = Embedder(client, model="nomic-embed-text")
    out = emb.embed_batch(["a", "bb", "ccc"])
    assert out == [[1.0], [2.0], [3.0]]
    assert client.calls == [("nomic-embed-text", ["a", "bb", "ccc"])]


def test_embed_single():
    emb = Embedder(FakeClient(), model="m")
    assert emb.embed("abcd") == [4.0]
