from fastapi import Depends, FastAPI, Header, HTTPException

from app.config import get_settings

app = FastAPI(title="Dyslexia RAG Service")


def require_service_token(x_service_token: str = Header(default="")) -> None:
    settings = get_settings()
    if not settings.service_token or x_service_token != settings.service_token:
        raise HTTPException(status_code=401, detail="Invalid service token")


# DI providers — real implementations are wired in later tasks. Kept as thin
# functions so tests can override them via app.dependency_overrides.
def get_embedder():
    raise HTTPException(status_code=503, detail="Embedder not configured")


def get_generator():
    raise HTTPException(status_code=503, detail="Generator not configured")


def get_db():
    raise HTTPException(status_code=503, detail="Db not configured")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/ingest")
def ingest(_: None = Depends(require_service_token)):
    raise HTTPException(status_code=501, detail="Not implemented")
