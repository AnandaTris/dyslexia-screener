import hmac

import ollama
from fastapi import Depends, FastAPI, Header, HTTPException

from app.config import get_settings
from app.db import Db
from app.embeddings import Embedder
from app.generation import Generator, answer_question, compose_journey
from app.ingest import ingest_document
from app.plain import answer_plain
from app.retrieval import retrieve
from app.schemas import ChatRequest, IngestRequest, JourneyRequest
from supabase import create_client

app = FastAPI(title="Dyslexia RAG Service")


def require_service_token(x_service_token: str = Header(default="")) -> None:
    settings = get_settings()
    if not settings.service_token or not hmac.compare_digest(x_service_token, settings.service_token):
        raise HTTPException(status_code=401, detail="Invalid service token")


def _ollama_client():
    return ollama.Client(host=get_settings().ollama_host)


def get_embedder() -> Embedder:
    return Embedder(_ollama_client(), get_settings().embedding_model)


def get_generator() -> Generator:
    return Generator(_ollama_client(), get_settings().generation_model)


def get_db() -> Db:
    s = get_settings()
    return Db(create_client(s.supabase_url, s.supabase_service_role_key))


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/ingest")
def ingest(req: IngestRequest, _: None = Depends(require_service_token),
           embedder: Embedder = Depends(get_embedder), db: Db = Depends(get_db)):
    try:
        return ingest_document(
            title=req.title, source=req.source, doc_type=req.doc_type,
            target_profiles=req.target_profiles, text=req.text,
            embedder=embedder, db=db,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/journey")
def journey(req: JourneyRequest, _: None = Depends(require_service_token),
            embedder: Embedder = Depends(get_embedder),
            generator: Generator = Depends(get_generator), db: Db = Depends(get_db)):
    settings = get_settings()
    profile = req.profile.model_dump()
    profiles = [profile["primary_label"]] if profile.get("primary_label") else None
    query = f"learning activities for {profile.get('primary_label','dyslexia')} dyslexia support"
    chunks = retrieve(query, embedder=embedder, db=db, k=settings.retrieval_k,
                      profiles=profiles, threshold=settings.similarity_threshold)
    return compose_journey(profile, chunks, generator)


@app.post("/chat")
def chat(req: ChatRequest, _: None = Depends(require_service_token),
         embedder: Embedder = Depends(get_embedder),
         generator: Generator = Depends(get_generator), db: Db = Depends(get_db)):
    profile = req.profile.model_dump()
    history = [m.model_dump() for m in req.recent_history]

    # Plain mode skips retrieval entirely — no embedding call, no pgvector round
    # trip, one Ollama call. It is therefore faster than grounded, not slower.
    # embedder and db stay declared as dependencies so the tests can assert they
    # were never touched.
    if req.mode == "plain":
        return answer_plain(req.question, profile, history, generator)

    settings = get_settings()
    profiles = [profile["primary_label"]] if profile.get("primary_label") else None
    chunks = retrieve(req.question, embedder=embedder, db=db, k=settings.retrieval_k,
                      profiles=profiles, threshold=settings.similarity_threshold)
    return answer_question(req.question, profile, chunks, history, generator)
