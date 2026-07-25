def test_ingest_requires_token(client):
    res = client.post("/ingest", json={})
    assert res.status_code == 401
