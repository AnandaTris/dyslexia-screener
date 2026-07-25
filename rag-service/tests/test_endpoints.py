import pytest
from fastapi.testclient import TestClient

from app.main import app, require_service_token, get_embedder, get_generator, get_db


class FakeEmbedder:
    def embed_batch(self, texts):
        return [[1.0] for _ in texts]

    def embed(self, text):
        return [1.0]


class FakeGenerator:
    def generate_json(self, system, user):
        if "journey" in system.lower():
            return {"steps": [{"title": "S", "description": "d", "source_ids": ["c1"]}]}
        return {"answer": "grounded", "source_ids": ["c1"]}


class FakeDb:
    def insert_document(self, *a):
        return "doc-1"

    def insert_chunks(self, *a):
        pass

    def match_chunks(self, query_embedding, match_count, filter_profiles):
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
