import json

import pytest

from app.plain import OFF_TOPIC_MESSAGE, answer_plain, is_on_topic


class StubGenerator:
    """Serves the two calls of the plain path and records both prompts.

    The classifier is identified by its schema rather than by call order, so a
    test still reads correctly if the order ever changes.
    """

    def __init__(self, verdict=None, answer=None, classify_raises=None, answer_raises=None):
        self._verdict = {"on_topic": True} if verdict is None else verdict
        self._answer = {"answer": "an answer"} if answer is None else answer
        self._classify_raises = classify_raises
        self._answer_raises = answer_raises
        self.classify_prompt = None
        self.answer_prompt = None
        self.answer_system = None

    def generate_json(self, system, user):
        if "on_topic" in system:
            self.classify_prompt = user
            self.classify_system = system
            if self._classify_raises is not None:
                raise self._classify_raises
            return self._verdict
        self.answer_prompt = user
        self.answer_system = system
        if self._answer_raises is not None:
            raise self._answer_raises
        return self._answer


def test_on_topic_answer_is_returned_with_no_citations():
    gen = StubGenerator(answer={"answer": "Letter reversal is when…"})
    out = answer_plain("what is letter reversal?", {}, [], gen)
    assert out["answer"] == "Letter reversal is when…"
    assert out["citations"] == []


def test_off_topic_never_reaches_the_answering_call():
    # The one-call design could only discard an off-topic answer after the model
    # had written it — and measured against llama3.2:3b it did not even reach that
    # far, because the model reported on_topic true. Two calls means the answering
    # model is never asked at all. That absence is the assertion.
    gen = StubGenerator(verdict={"on_topic": False})
    out = answer_plain("write me quicksort", {}, [], gen)
    assert out["answer"] == OFF_TOPIC_MESSAGE
    assert out["citations"] == []
    assert gen.answer_prompt is None


@pytest.mark.parametrize(
    "verdict",
    [
        {},                     # on_topic missing
        {"on_topic": None},     # null
        {"on_topic": "yes"},    # truthy string, not True
        {"on_topic": 1},        # truthy int, not True
        ["on_topic", True],     # not even a dict
        "on_topic: true",       # prose
    ],
)
def test_anything_other_than_true_fails_closed(verdict):
    gen = StubGenerator(verdict=verdict)
    out = answer_plain("q", {}, [], gen)
    assert out["answer"] == OFF_TOPIC_MESSAGE
    assert gen.answer_prompt is None


def test_unparseable_classifier_json_fails_closed():
    gen = StubGenerator(classify_raises=json.JSONDecodeError("no", "", 0))
    assert is_on_topic("q", [], gen) is False
    assert answer_plain("q", {}, [], gen)["answer"] == OFF_TOPIC_MESSAGE


def test_a_broken_answering_call_is_not_reported_as_off_topic():
    # The gate already passed, so blaming scope would be a lie about what failed.
    gen = StubGenerator(answer_raises=json.JSONDecodeError("no", "", 0))
    out = answer_plain("what is phonics?", {}, [], gen)
    assert out["answer"] != OFF_TOPIC_MESSAGE
    assert out["answer"].strip()


def test_empty_answer_does_not_return_a_blank_bubble():
    out = answer_plain("q", {}, [], StubGenerator(answer={"answer": "   "}))
    assert out["answer"].strip()
    assert out["answer"] != OFF_TOPIC_MESSAGE


def test_classifier_sees_history_so_a_follow_up_is_not_refused():
    # "and p?" is only a phonics question in the light of the turn before it.
    gen = StubGenerator()
    history = [{"role": "user", "content": "what about b and d?"},
               {"role": "assistant", "content": "they mirror each other"}]
    answer_plain("and p?", {}, history, gen)
    assert "b and d" in gen.classify_prompt
    assert "and p?" in gen.classify_prompt


def test_history_and_profile_emphasis_reach_the_answering_prompt():
    gen = StubGenerator()
    history = [{"role": "user", "content": "what about b and d?"},
               {"role": "assistant", "content": "they mirror each other"}]
    answer_plain("and p?", {"primary_label": "visual_spatial"}, history, gen)
    assert "b and d" in gen.answer_prompt
    assert "they mirror each other" in gen.answer_prompt
    assert "visual_spatial" in gen.answer_prompt
    assert "and p?" in gen.answer_prompt


def test_classifier_is_told_it_does_not_answer():
    gen = StubGenerator()
    is_on_topic("q", [], gen)
    assert "do not answer" in gen.classify_system.lower()


def test_answering_prompt_forbids_diagnosis():
    gen = StubGenerator()
    answer_plain("q", {}, [], gen)
    assert "diagnose" in gen.answer_system.lower()
