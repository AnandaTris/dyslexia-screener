import pytest
from fastapi.testclient import TestClient

from app.main import app, require_service_token, get_embedder, get_generator, get_db
from app import main as main_module
from app.config import Settings


class FakeEmbedder:
    def __init__(self):
        self.calls = 0

    def embed_batch(self, texts):
        self.calls += 1
        return [[1.0] for _ in texts]

    def embed(self, text):
        self.calls += 1
        return [1.0]


class FakeGenerator:
    def generate_json(self, system, user):
        # Branch on the schema each prompt asks for, so one double serves all
        # four calls the service can make.
        if "journey" in system.lower():
            return {"steps": [{"title": "S", "description": "d", "source_ids": ["c1"]}]}
        if "on_topic" in system:
            return {"on_topic": True}
        if "source_ids" in system:
            return {"answer": "grounded", "source_ids": ["c1"]}
        return {"answer": "plain"}


class FakeDb:
    def __init__(self):
        self.matches = 0

    def insert_document(self, *a):
        return "doc-1"

    def insert_chunks(self, *a):
        pass

    def match_chunks(self, query_embedding, match_count, filter_profiles):
        self.matches += 1
        return [{"id": "c1", "document_id": "d1", "title": "T",
                 "content": "help", "similarity": 0.9}]


@pytest.fixture
def api():
    app.dependency_overrides[require_service_token] = lambda: None
    app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
    app.dependency_overrides[get_generator] = lambda: FakeGenerator()
    app.dependency_overrides[get_db] = lambda: FakeDb()
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_ingest_endpoint(api):
    res = api.post("/ingest", json={
        "title": "T", "doc_type": "guide", "target_profiles": ["phonological"],
        "text": "some material to chunk and embed",
    })
    assert res.status_code == 200
    assert res.json()["document_id"] == "doc-1"
    assert res.json()["chunks"] >= 1


def test_journey_endpoint(api):
    res = api.post("/journey", json={"profile": {"primary_label": "phonological"}})
    assert res.status_code == 200
    steps = res.json()["steps"]
    assert steps[0]["citations"][0]["id"] == "c1"


def test_chat_endpoint(api):
    res = api.post("/chat", json={"question": "how to help?",
                                  "profile": {"primary_label": "surface"}})
    assert res.status_code == 200
    assert res.json()["answer"] == "grounded"
    assert res.json()["citations"][0]["id"] == "c1"


@pytest.fixture
def spies():
    """Like `api`, but hands back the doubles so a test can assert non-use."""
    embedder, db = FakeEmbedder(), FakeDb()
    app.dependency_overrides[require_service_token] = lambda: None
    app.dependency_overrides[get_embedder] = lambda: embedder
    app.dependency_overrides[get_generator] = lambda: FakeGenerator()
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app), embedder, db
    app.dependency_overrides.clear()


def test_plain_mode_never_retrieves(spies):
    client, embedder, db = spies
    res = client.post("/chat", json={"question": "what is letter reversal?",
                                     "mode": "plain"})
    assert res.status_code == 200
    assert res.json() == {"answer": "plain", "citations": []}
    # The point of the mode: no embedding call, no pgvector round trip.
    assert embedder.calls == 0
    assert db.matches == 0


def test_missing_mode_still_retrieves(spies):
    client, embedder, db = spies
    res = client.post("/chat", json={"question": "how to help?"})
    assert res.status_code == 200
    assert res.json()["citations"][0]["id"] == "c1"
    assert db.matches == 1


def test_unknown_mode_is_rejected(api):
    res = api.post("/chat", json={"question": "hi", "mode": "nonsense"})
    assert res.status_code == 422


def _fakes_with_token(monkeypatch):
    app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
    app.dependency_overrides[get_generator] = lambda: FakeGenerator()
    app.dependency_overrides[get_db] = lambda: FakeDb()
    monkeypatch.setattr(main_module, "get_settings", lambda: Settings(service_token="secret"))


def test_ingest_rejects_wrong_token(monkeypatch):
    _fakes_with_token(monkeypatch)
    try:
        res = TestClient(app).post(
            "/ingest",
            headers={"X-Service-Token": "wrong"},
            json={"title": "T", "doc_type": "guide", "text": "some material to chunk"},
        )
        assert res.status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_ingest_accepts_correct_token(monkeypatch):
    _fakes_with_token(monkeypatch)
    try:
        res = TestClient(app).post(
            "/ingest",
            headers={"X-Service-Token": "secret"},
            json={"title": "T", "doc_type": "guide", "target_profiles": ["phonological"],
                  "text": "some material to chunk and embed"},
        )
        assert res.status_code == 200
        assert res.json()["document_id"] == "doc-1"
    finally:
        app.dependency_overrides.clear()
