class Embedder:
    def __init__(self, client, model: str):
        self._client = client
        self._model = model

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        resp = self._client.embed(model=self._model, input=texts)
        return [list(e) for e in resp["embeddings"]]

    def embed(self, text: str) -> list[float]:
        return self.embed_batch([text])[0]
