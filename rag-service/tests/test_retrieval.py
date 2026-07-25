from app.retrieval import retrieve


class FakeEmbedder:
    def embed(self, text):
        return [0.1, 0.2]


class FakeDb:
    def __init__(self, rows):
        self.rows = rows
        self.last = None

    def match_chunks(self, query_embedding, match_count, filter_profiles):
        self.last = (query_embedding, match_count, filter_profiles)
        return self.rows


def test_retrieve_filters_below_threshold():
    db = FakeDb([
        {"id": "a", "similarity": 0.9, "content": "x"},
        {"id": "b", "similarity": 0.3, "content": "y"},
    ])
    out = retrieve("q", embedder=FakeEmbedder(), db=db, k=6, threshold=0.5)
    assert [c["id"] for c in out] == ["a"]
    assert db.last == ([0.1, 0.2], 6, None)


def test_retrieve_passes_profile_filter():
    db = FakeDb([])
    retrieve("q", embedder=FakeEmbedder(), db=db, profiles=["surface"])
    assert db.last[2] == ["surface"]
