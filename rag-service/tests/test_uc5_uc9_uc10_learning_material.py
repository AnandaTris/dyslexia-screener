"""
UC5 + UC9 + UC10 — Access Learning Material + Select Material + Download Material

One test per row of the test plan:

  | Path  | Input                        | Expected output                     |
  |-------|------------------------------|-------------------------------------|
  | Happy | Search for relevant material | List of available searched materials|
  | Error | Search for unrelated material| No available material displayed     |
  | Happy | Select specific material     | Display specific material           |
  | Happy | Press download on material   | Material downloaded on user device  |

WHERE THESE LIVE. There is no MaterialService in the Next.js app. The learning
material subsystem is the RAG service in this directory: `documents` and
`document_chunks` are the materials (MaterialRepository is `app/db.py`), and
`retrieve()` plus the citation builders in `app/generation.py` are MaterialService.

ROW 4 HAS NO IMPLEMENTATION. Materials are ingested as text and chunked for
retrieval; the original file is never stored, so there is nothing to hand a user's
device. That row is the skipped test at the bottom.
"""

import pytest

from app.generation import answer_question
from app.retrieval import retrieve


class FakeEmbedder:
    def embed(self, text):
        return [0.1, 0.2]


class FakeMaterialRepository:
    """MaterialRepository: holds whatever material the test says it holds, and
    records how it was asked."""

    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def match_chunks(self, query_embedding, match_count, filter_profiles):
        self.calls.append((query_embedding, match_count, filter_profiles))
        return self.rows


class FakeGenerator:
    """Cites exactly the material ids it is told to, so a test can assert which
    material was selected for display."""

    def __init__(self, source_ids):
        self.source_ids = source_ids

    def generate_json(self, system, user):
        return {"answer": "Start with syllable segmentation.", "source_ids": self.source_ids}


def material(id_, *, title, similarity, document_id="doc-1"):
    return {"id": id_, "document_id": document_id, "title": title,
            "content": "material body", "similarity": similarity}


PHONICS = material("chunk-1", title="Phonics for dyslexic learners", similarity=0.91)
FLUENCY = material("chunk-2", title="Reading fluency drills", similarity=0.78,
                   document_id="doc-2")
OFF_TOPIC = material("chunk-9", title="School bus timetable", similarity=0.12,
                     document_id="doc-9")


def test_happy_searching_relevant_material_returns_the_available_materials():
    """MaterialRepository returns the list of all selected material."""
    repository = FakeMaterialRepository([PHONICS, FLUENCY])

    found = retrieve("phonological awareness activities", embedder=FakeEmbedder(),
                     db=repository, k=6, threshold=0.5, profiles=["phonological"])

    # A list of the available searched materials, most relevant first.
    assert [m["id"] for m in found] == ["chunk-1", "chunk-2"]
    assert [m["title"] for m in found] == [
        "Phonics for dyslexic learners",
        "Reading fluency drills",
    ]
    # MaterialRepository was asked once, scoped to the learner's profile.
    assert repository.calls == [([0.1, 0.2], 6, ["phonological"])]


def test_error_searching_unrelated_material_displays_no_material():
    """MaterialRepository does not have the searched material: the rows it returns
    are all unrelated, so nothing survives the similarity threshold and the caller
    is left with an empty list."""
    repository = FakeMaterialRepository([OFF_TOPIC])

    found = retrieve("dyslexia spelling intervention", embedder=FakeEmbedder(),
                     db=repository, threshold=0.5)

    assert found == []


def test_happy_selecting_a_specific_material_returns_it_for_display():
    """MaterialService returns the selected specific material for the frontend to
    display: of the two materials found, one is selected, with the id, document and
    title needed to render it."""
    answer = answer_question("how do I build fluency?", {"primary_label": "surface"},
                             [PHONICS, FLUENCY], [], FakeGenerator(["chunk-2"]))

    assert answer["citations"] == [
        {"id": "chunk-2", "document_id": "doc-2", "title": "Reading fluency drills"}
    ]


@pytest.mark.skip(
    reason="NOT IMPLEMENTED: ingestion stores extracted text and chunks only, "
           "never the original file, and there is no download endpoint or "
           "findById(id) on MaterialRepository. Needs file storage plus "
           "GET /materials/{id}/file before this can run."
)
def test_happy_pressing_download_returns_the_material_file():
    raise AssertionError("no download endpoint exists yet")
