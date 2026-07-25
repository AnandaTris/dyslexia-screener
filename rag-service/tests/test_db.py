from types import SimpleNamespace

from app.db import Db, to_pgvector


class FakeQuery:
    def __init__(self, recorder, kind, payload):
        self.recorder = recorder
        self.kind = kind
        self.payload = payload

    def execute(self):
        self.recorder.append((self.kind, self.payload))
        if self.kind == "insert-documents":
            return SimpleNamespace(data=[{"id": "doc-1"}])
        if self.kind == "rpc":
            return SimpleNamespace(data=[{"id": "chunk-1", "similarity": 0.9}])
        return SimpleNamespace(data=[])


class FakeClient:
    def __init__(self):
        self.calls = []

    def table(self, name):
        recorder = self.calls
        outer = self

        class T:
            def insert(self, rows):
                return FakeQuery(recorder, f"insert-{name}", rows)

        return T()

    def rpc(self, name, params):
        return FakeQuery(self.calls, "rpc", {"name": name, "params": params})


def test_to_pgvector_formats_brackets():
    assert to_pgvector([0.5, -1.0]) == "[0.50000000,-1.00000000]"


def test_insert_document_returns_id():
    db = Db(FakeClient())
    doc_id = db.insert_document("T", "src", "guide", ["phonological"])
    assert doc_id == "doc-1"


def test_insert_chunks_encodes_embeddings_as_strings():
    client = FakeClient()
    Db(client).insert_chunks("doc-1", ["hello"], [[0.1, 0.2]], [{"k": "v"}])
    kind, rows = client.calls[0]
    assert kind == "insert-document_chunks"
    assert rows[0]["document_id"] == "doc-1"
    assert rows[0]["chunk_index"] == 0
    assert rows[0]["embedding"] == "[0.10000000,0.20000000]"


def test_match_chunks_passes_string_embedding_to_rpc():
    client = FakeClient()
    out = Db(client).match_chunks([0.1, 0.2], 5, ["phonological"])
    kind, payload = client.calls[0]
    assert kind == "rpc"
    assert payload["name"] == "match_document_chunks"
    assert payload["params"]["query_embedding"] == "[0.10000000,0.20000000]"
    assert payload["params"]["match_count"] == 5
    assert payload["params"]["filter_profiles"] == ["phonological"]
    assert out == [{"id": "chunk-1", "similarity": 0.9}]
