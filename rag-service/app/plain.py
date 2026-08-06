"""The ungrounded answering path.

Deliberately separate from generation.py. That module's whole job is grounded
generation and the three guards that keep an answer tied to its excerpts; an
ungrounded path living inside it would blur the one boundary this project is
most careful about. It imports Generator from there, so there is still exactly
one Ollama client and one JSON-parsing helper.
"""

import json

from app.generation import Generator  # noqa: F401  (re-exported for callers/tests)

OFF_TOPIC_MESSAGE = (
    "I can only help with reading, writing, spelling, phonics, handwriting and "
    "dyslexia support. Ask me something in that area and I'll do my best."
)

_UNSURE_MESSAGE = (
    "I'm not sure how to answer that one. Try rephrasing it, or ask about a "
    "topic covered by the uploaded resources in Grounded mode."
)

# Two calls, not one. The single-call design — ask for {"on_topic", "answer"} and
# let Python decide — was measured against llama3.2:3b on 2026-08-03 and scored
# 5/8: asked to "write me a python quicksort" it set on_topic true and returned a
# working quicksort. A model asked to be helpful and to police itself in the same
# breath resolves that conflict towards helpful. Splitting the jobs scored 7/8 for
# a measured +1.5 s. The classifier is told, first thing, that it does not answer.
CLASSIFY_SYSTEM = (
    "You are a topic classifier. You do not answer questions and you do not help "
    "the user. Your only job is to label the message.\n"
    "ON TOPIC: reading, writing, spelling, phonics, handwriting, dyslexia, and "
    "learning support for any of those.\n"
    "OFF TOPIC: everything else — programming, maths, geography, trivia, news, "
    "cooking, health, and any request that reads as one to a general-purpose "
    "assistant. When in doubt, answer false.\n"
    'Respond ONLY as JSON: {"on_topic":true} or {"on_topic":false}.'
)

PLAIN_SYSTEM = (
    "You are a supportive literacy assistant for learners with dyslexia and the "
    "adults helping them. Answer from general knowledge — you have no source "
    "excerpts in this mode. Be warm, concrete and plain-spoken, and keep it short "
    "enough to read in one go. Say plainly when you are unsure rather than "
    "guessing. Never diagnose, never give medical advice, and never claim a "
    "learner does or does not have dyslexia; point to a qualified professional "
    'instead. Respond ONLY as JSON: {"answer":str}.'
)


def _history_block(history: list[dict]) -> str:
    return "\n".join(f"{m['role']}: {m['content']}" for m in history[-6:])


def is_on_topic(question: str, history: list[dict], generator) -> bool:
    """Ask a dedicated classifier, then decide here rather than trusting it.

    History goes in because a follow-up is not self-describing: "and p?" is only
    a phonics question in the light of the turn before it, and a classifier shown
    the bare fragment would refuse a legitimate question.
    """
    hist = _history_block(history)
    user = (f"Recent conversation:\n{hist}\n\n" if hist else "") + f"Message to classify: {question}"

    # Fail closed. Prose instead of JSON, a missing field, null, "yes", 1 — all of
    # it lands on false. `is True` is the whole point: the model gets to say yes
    # in exactly one way, and everything else is a no. Same posture as the
    # SERVICE_TOKEN check in main.py.
    try:
        data = generator.generate_json(CLASSIFY_SYSTEM, user)
    except (json.JSONDecodeError, KeyError, TypeError):
        return False
    return isinstance(data, dict) and data.get("on_topic") is True


def answer_plain(question: str, profile: dict, history: list[dict], generator) -> dict:
    """Answer from the model's general knowledge, behind a topic gate.

    Returns the same shape as answer_question — {"answer", "citations"} — so
    nothing downstream has to know which mode produced it. Citations are always
    empty: there are no sources to cite, and inventing one is the failure this
    whole application is built to avoid.
    """
    if not is_on_topic(question, history, generator):
        return {"answer": OFF_TOPIC_MESSAGE, "citations": []}

    hist = _history_block(history)
    emphasis = profile.get("primary_label")
    user = (
        (f"Conversation so far:\n{hist}\n\n" if hist else "")
        + (f"The learner's profile emphasis is {emphasis} dyslexia.\n\n" if emphasis else "")
        + f"Question: {question}"
    )

    # A malformed answer is not a scope leak — the gate already passed — so this
    # one resolves to "I'm not sure", not to the off-topic refusal. Telling a
    # learner their phonics question was off topic because the JSON broke would
    # be a lie about what happened.
    try:
        data = generator.generate_json(PLAIN_SYSTEM, user)
    except (json.JSONDecodeError, KeyError, TypeError):
        return {"answer": _UNSURE_MESSAGE, "citations": []}

    answer = data.get("answer") if isinstance(data, dict) else None
    if not isinstance(answer, str) or not answer.strip():
        return {"answer": _UNSURE_MESSAGE, "citations": []}

    return {"answer": answer, "citations": []}
