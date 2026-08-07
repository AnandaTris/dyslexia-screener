// Server-only client for the Python RAG service. Never throws — callers get a
// structured result so the UI can degrade gracefully when the service is down.
const OFFLINE_MESSAGE =
  "The learning assistant is offline. Start the Python RAG service (see WORKFLOW.md).";

const TIMEOUT_MESSAGE =
  "The learning assistant took too long to answer. It is running, but the local model " +
  "is slow on this machine — try a smaller GENERATION_MODEL, or raise RAG_SERVICE_TIMEOUT_MS.";

// Generous by default, because the model runs locally: a model with no GPU can
// take minutes per answer, and cutting it off looks identical to a crash.
// Overridable so a machine with a GPU can hold the UI to a tighter budget.
//
// Raised from 120000 on 2026-08-07 after it fired on a request that had actually
// succeeded. Measured on this hardware (Intel Iris Xe, CPU-only inference):
// grounded /chat 16 s warm but 118 s on the first call after Ollama starts, and
// /journey 76 s warm, 121.8 s cold — which blew the old 120 s budget by 325 ms in
// a live e2e run. A limit the happy path lands on top of is the wrong limit.
const DEFAULT_TIMEOUT_MS = 300000;

export async function callRagService(path, body) {
  const url = process.env.RAG_SERVICE_URL;
  const token = process.env.RAG_SERVICE_TOKEN;
  if (!url || !token) {
    return { ok: false, offline: true, error: OFFLINE_MESSAGE };
  }

  const timeoutMs = Number(process.env.RAG_SERVICE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  try {
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Token": token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
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
  } catch (err) {
    // A timeout is not an offline service. Reporting "start the Python RAG
    // service" while it is running and mid-answer sends you to debug the one
    // thing that is not wrong — so the two cases are told apart here.
    if (err?.name === "TimeoutError") {
      return { ok: false, offline: false, timeout: true, error: TIMEOUT_MESSAGE };
    }
    return { ok: false, offline: true, error: OFFLINE_MESSAGE };
  }
}
