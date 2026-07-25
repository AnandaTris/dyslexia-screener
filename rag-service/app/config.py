from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    service_token: str = ""
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    ollama_host: str = "http://localhost:11434"
    embedding_model: str = "nomic-embed-text"
    generation_model: str = "llama3.1:8b"
    retrieval_k: int = 6
    similarity_threshold: float = 0.5


@lru_cache
def get_settings() -> Settings:
    return Settings()
