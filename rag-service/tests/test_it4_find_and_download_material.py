"""
Integrated Test 4 — Find and Download Material

The sequence under test, from the plan:

  TestRunner -> MaterialService: listMaterial(id)
  MaterialService -> MaterialRepository: findById(id)
  MaterialRepository --> MaterialService: Available Materials
  MaterialService --> TestRunner: List of Available Materials
  TestRunner -> MaterialService: downloadMaterial(id)
  MaterialService -> MaterialRepository: findById(id)
  MaterialRepository --> MaterialService: Material File
  MaterialService --> TestRunner: Material File saved to device

The FIRST HALF is the test below, wired end to end: a real HTTP request through
the FastAPI app, the real retrieval and citation code, and a recording
MaterialRepository at the boundary. Only the embedding and composing models are
doubled. Strategy: bottom-up, call-graph.

THE SECOND HALF CANNOT RUN. `downloadMaterial` does not exist — ingestion keeps
extracted text and embeddings only, the uploaded file is discarded, and there is no
`findById(id)` on MaterialRepository. The skipped test in
test_uc5_uc9_uc10_learning_material.py records that gap.

Two mismatches with the diagram, worth knowing before reading the assertions:

  * Materials are found by SIMILARITY TO A QUERY, filtered by learner profile —
    not by `findById(id)`. There is no lookup-by-id path in MaterialRepository.
  * A material's chunks, not whole documents, are what come back. The document
    each belongs to is carried on it as `document_id`.
"""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app, get_db, get_embedder, get_generator, require_service_token


class FakeEmbedder:
    def embed(self, text):
        return [0.5, 0.5]


class RecordingMaterialRepository:
    """MaterialRepository at the boundary: every query it is asked is recorded."""

    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def match_chunks(self, query_embedding, match_count, filter_profiles):
        self.calls.append({"match_count": match_count, "filter_profiles": filter_profiles})
        return self.rows


class FakeGenerator:
    def __init__(self, source_ids):
        self.source_ids = source_ids
        self.prompts = []

    def generate_json(self, system, user):
        self.prompts.append(user)
        return {"steps": [{"title": "Segment and blend", "description": "Daily, ten minutes.",
                           "source_ids": self.source_ids}]}


MATERIALS = [
    {"id": "chunk-1", "document_id": "doc-phonics", "title": "Phonics scope and sequence",
     "content": "Segmenting and blending routines.", "similarity": 0.88},
    {"id": "chunk-2", "document_id": "doc-sight", "title": "High frequency word lists",
     "content": "Sight word practice sets.", "similarity": 0.71},
]


@pytest.fixture
def wired():
    """Overrides only the outer boundary: the repository and the two models.
    Retrieval, thresholding, citation building and the HTTP layer are real."""
    repository = RecordingMaterialRepository(MATERIALS)
    generator = FakeGenerator(["chunk-1", "chunk-2"])

    app.dependency_overrides[require_service_token] = lambda: None
    app.dependency_overrides[get_embedder] = lambda: FakeEmbedder()
    app.dependency_overrides[get_generator] = lambda: generator
    app.dependency_overrides[get_db] = lambda: repository

    yield TestClient(app), repository, generator

    app.dependency_overrides.clear()


def test_list_material_asks_the_repository_and_returns_the_available_materials(wired):
    client, repository, generator = wired

    res = client.post("/journey", json={"profile": {"primary_label": "phonological"}})

    assert res.status_code == 200

    # MaterialService consulted MaterialRepository once, scoped to the learner's
    # profile and limited to the configured page size.
    assert len(repository.calls) == 1
    assert repository.calls[0]["filter_profiles"] == ["phonological"]
    assert repository.calls[0]["match_count"] == Settings().retrieval_k

    # The list of available materials came back, attached to the step built from it.
    steps = res.json()["steps"]
    assert [c["title"] for c in steps[0]["citations"]] == [
        "Phonics scope and sequence",
        "High frequency word lists",
    ]
    assert [c["document_id"] for c in steps[0]["citations"]] == ["doc-phonics", "doc-sight"]

    # And the material really reached the composing model — the plan is grounded in
    # the retrieved text, not in the model's own recall.
    assert "Segmenting and blending routines." in generator.prompts[0]
