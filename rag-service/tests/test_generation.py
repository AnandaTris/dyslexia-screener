import json

from app.generation import (
    Generator, compose_journey, answer_question, NO_MATERIAL_MESSAGE,
)


class FakeClient:
    def __init__(self, text):
        self._text = text
        self.calls = []

    def chat(self, model, messages, format):
        self.calls.append(messages)
        return {"message": {"content": self._text}}


def test_generator_parses_json():
    gen = Generator(FakeClient('{"a": 1}'), model="m")
    assert gen.generate_json("sys", "user") == {"a": 1}


def test_generator_strips_code_fences():
    gen = Generator(FakeClient('```json\n{"a": 2}\n```'), model="m")
    assert gen.generate_json("sys", "user") == {"a": 2}


CHUNKS = [{"id": "c1", "document_id": "d1", "title": "Phonics", "content": "blend sounds"}]


def test_compose_journey_returns_steps_with_citations():
    payload = json.dumps({"steps": [
        {"title": "Sound blending", "description": "do X", "source_ids": ["c1"]},
    ]})
    out = compose_journey({"primary_label": "phonological"}, CHUNKS, Generator(FakeClient(payload), "m"))
    assert out["steps"][0]["title"] == "Sound blending"
    assert out["steps"][0]["citations"][0]["id"] == "c1"


def test_compose_journey_with_no_chunks_skips_model():
    # generator that would explode if called
    class Boom:
        def generate_json(self, *a, **k):
            raise AssertionError("model must not be called with no chunks")

    out = compose_journey({"primary_label": "phonological"}, [], Boom())
    assert out["steps"] == []
    assert out["note"]


def test_answer_with_no_chunks_returns_no_material_without_model():
    class Boom:
        def generate_json(self, *a, **k):
            raise AssertionError("model must not be called with no chunks")

    out = answer_question("what is dyslexia?", {}, [], [], Boom())
    assert out["answer"] == NO_MATERIAL_MESSAGE
    assert out["citations"] == []


def test_answer_with_chunks_uses_model_and_cites():
    payload = json.dumps({"answer": "Blend the sounds.", "source_ids": ["c1"]})
    out = answer_question("how to help?", {}, CHUNKS, [], Generator(FakeClient(payload), "m"))
    assert out["answer"] == "Blend the sounds."
    assert out["citations"][0]["id"] == "c1"


def test_compose_journey_tolerates_null_steps():
    gen = Generator(FakeClient('{"steps": null}'), "m")
    out = compose_journey({"primary_label": "phonological"}, CHUNKS, gen)
    assert out["steps"] == []


def test_answer_tolerates_null_fields():
    gen = Generator(FakeClient('{"answer": null, "source_ids": null}'), "m")
    out = answer_question("q", {}, CHUNKS, [], gen)
    assert out["answer"] == NO_MATERIAL_MESSAGE
    assert out["citations"] == []
