import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callRagService } from "./ragService.js";

describe("callRagService", () => {
  beforeEach(() => {
    process.env.RAG_SERVICE_URL = "http://svc:8000";
    process.env.RAG_SERVICE_TOKEN = "secret";
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns offline when not configured", async () => {
    delete process.env.RAG_SERVICE_URL;
    const r = await callRagService("/chat", {});
    expect(r.ok).toBe(false);
    expect(r.offline).toBe(true);
  });

  it("posts with the service token and returns data on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ answer: "hi", citations: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await callRagService("/chat", { question: "q" });
    expect(r.ok).toBe(true);
    expect(r.data.answer).toBe("hi");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://svc:8000/chat");
    expect(opts.headers["X-Service-Token"]).toBe("secret");
    expect(JSON.parse(opts.body)).toEqual({ question: "q" });
  });

  it("returns offline on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const r = await callRagService("/chat", {});
    expect(r.ok).toBe(false);
    expect(r.offline).toBe(true);
  });

  it("reports a timeout as a timeout, not as an offline service", async () => {
    // Measured on a laptop with no usable GPU: a 7B model took 187s for one
    // answer. Calling that "offline" points the reader at the one component
    // that is definitely running.
    const timeout = Object.assign(new Error("signal timed out"), { name: "TimeoutError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));

    const r = await callRagService("/chat", {});
    expect(r.ok).toBe(false);
    expect(r.offline).toBe(false);
    expect(r.timeout).toBe(true);
    expect(r.error).toMatch(/took too long/i);
  });

  it("honours RAG_SERVICE_TIMEOUT_MS", async () => {
    process.env.RAG_SERVICE_TIMEOUT_MS = "5000";
    const spy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    await callRagService("/chat", {});
    expect(spy).toHaveBeenCalledWith(5000);
    delete process.env.RAG_SERVICE_TIMEOUT_MS;
  });

  it("returns a non-offline error on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const r = await callRagService("/chat", {});
    expect(r.ok).toBe(false);
    expect(r.offline).toBe(false);
    expect(r.status).toBe(500);
  });
});
