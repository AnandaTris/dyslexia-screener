// Server-only client for the Python RAG service. Never throws — callers get a
// structured result so the UI can degrade gracefully when the service is down.
const OFFLINE_MESSAGE =
  "The learning assistant is offline. Start the Python RAG service (see rag-service/README.md).";

export async function callRagService(path, body) {
  const url = process.env.RAG_SERVICE_URL;
  const token = process.env.RAG_SERVICE_TOKEN;
  if (!url || !token) {
    return { ok: false, offline: true, error: OFFLINE_MESSAGE };
  }

  try {
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Token": token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      return {
        ok: false,
        offline: false,
        status: res.status,
        error: `The learning assistant returned an error (${res.status}).`,
      };
    }
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, offline: true, error: OFFLINE_MESSAGE };
  }
}
