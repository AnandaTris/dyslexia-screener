from pydantic import BaseModel


class IngestRequest(BaseModel):
    title: str
    source: str | None = None
    doc_type: str
    target_profiles: list[str] = []
    text: str


class ProfileModel(BaseModel):
    primary_label: str | None = None
    weights: dict[str, float] = {}


class JourneyRequest(BaseModel):
    profile: ProfileModel


class ChatMessageModel(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    question: str
    profile: ProfileModel = ProfileModel()
    journey_id: str | None = None
    recent_history: list[ChatMessageModel] = []
