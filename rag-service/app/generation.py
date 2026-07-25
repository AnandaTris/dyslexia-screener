import json

NO_MATERIAL_MESSAGE = (
    "I don't have any source material on that yet, so I can't give a grounded "
    "answer. Try asking about a topic covered by the uploaded resources."
)

_JOURNEY_SYSTEM = (
    "You are a literacy-support planner. Using ONLY the provided source excerpts, "
    "compose an ordered learning journey for a dyslexic learner whose profile "
    "emphasis is given. Every step must be justified by the excerpts and list the "
    "source ids it draws from. Do not invent activities not supported by the "
    "excerpts. Respond ONLY as JSON: "
    '{"steps":[{"title":str,"description":str,"source_ids":[str]}]}.'
)

_CHAT_SYSTEM = (
    "You are a supportive literacy assistant. Answer the question using ONLY the "
    "provided source excerpts. If the excerpts do not contain the answer, say you "
    "do not have material on that. Cite the source ids you used. Respond ONLY as "
    'JSON: {"answer":str,"source_ids":[str]}.'
)


class Generator:
    def __init__(self, client, model: str):
        self._client = client
        self._model = model

    def generate_json(self, system: str, user: str) -> dict:
        resp = self._client.chat(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            format="json",
        )
        text = resp["message"]["content"]
        text = text.replace("```json", "").replace("```", "").strip()
        return json.loads(text)


def _format_chunks(chunks: list[dict]) -> str:
    return "\n\n".join(
        f"[id: {c['id']} | title: {c.get('title','')}]\n{c['content']}" for c in chunks
    )


def _citations_for(source_ids: list[str], chunks: list[dict]) -> list[dict]:
    by_id = {c["id"]: c for c in chunks}
    out = []
    for sid in source_ids:
        c = by_id.get(sid)
        if c:
            out.append({"id": sid, "document_id": c.get("document_id"), "title": c.get("title")})
    return out


def compose_journey(profile: dict, chunks: list[dict], generator) -> dict:
    if not chunks:
        return {"steps": [], "note": "No source material available yet to build a journey."}

    user = (
        f"Learner profile emphasis: {profile.get('primary_label', 'unknown')}.\n\n"
        f"Source excerpts:\n{_format_chunks(chunks)}"
    )
    data = generator.generate_json(_JOURNEY_SYSTEM, user)
    steps = []
    for i, step in enumerate(data.get("steps") or []):
        steps.append({
            "step_index": i,
            "title": step.get("title") or "",
            "description": step.get("description") or "",
            "citations": _citations_for(step.get("source_ids") or [], chunks),
        })
    return {"steps": steps, "note": None}


def answer_question(question: str, profile: dict, chunks: list[dict],
                    history: list[dict], generator) -> dict:
    if not chunks:
        return {"answer": NO_MATERIAL_MESSAGE, "citations": []}

    hist = "\n".join(f"{m['role']}: {m['content']}" for m in history[-6:])
    user = (
        f"Conversation so far:\n{hist}\n\n" if hist else ""
    ) + f"Question: {question}\n\nSource excerpts:\n{_format_chunks(chunks)}"
    data = generator.generate_json(_CHAT_SYSTEM, user)
    return {
        "answer": data.get("answer") or NO_MATERIAL_MESSAGE,
        "citations": _citations_for(data.get("source_ids") or [], chunks),
    }
