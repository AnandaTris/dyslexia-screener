import pytest
from fastapi.testclient import TestClient

from app.main import app, require_service_token


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_client():
    """A client whose requests always pass the service-token check."""
    app.dependency_overrides[require_service_token] = lambda: None
    yield TestClient(app)
    app.dependency_overrides.clear()
