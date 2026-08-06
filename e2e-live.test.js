// TEMPORARY end-to-end harness — deleted after the run. Drives the real
// lib/ragService.js against a live uvicorn on :8000, which is the exact code
// path app/api/chat/route.js uses. Requires the service to be running.
import { describe, it, expect, beforeEach } from "vitest";
import { callRagService } from "./lib/ragService.js";

const LIVE_URL = "http://127.0.0.1:8000";
const TOKEN = process.env.E2E_SERVICE_TOKEN;
const PROFILE = { primary_label: "phonological", weights: {} };

beforeEach(() => {
  process.env.RAG_SERVICE_URL = LIVE_URL;
  process.env.RAG_SERVICE_TOKEN = TOKEN;
  delete process.env.RAG_SERVICE_TIMEOUT_MS;
});

describe("JS -> Python boundary, live", () => {
  it("returns a grounded answer with citations", async () => {
    const r = await callRagService("/chat", {
      question: "How should I start phonological awareness work with a learner?",
      profile: PROFILE,
      recent_history: [],
    });
    expect(r.ok).toBe(true);
    expect(typeof r.data.answer).toBe("string");
    expect(r.data.answer.length).toBeGreaterThan(40);
    expect(r.data.citations.length).toBeGreaterThan(0);
    console.log("    answer:", r.data.answer.slice(0, 140));
    console.log("    citations:", r.data.citations.map((c) => c.title).join(", "));
  }, 180000);

  it("builds a journey", async () => {
    const r = await callRagService("/journey", { profile: PROFILE });
    expect(r.ok).toBe(true);
    expect(r.data.steps.length).toBeGreaterThan(0);
    console.log("    steps:", r.data.steps.map((s) => s.title).join(" | ").slice(0, 200));
  }, 180000);

  it("reports a bad token as an error, not as offline", async () => {
    process.env.RAG_SERVICE_TOKEN = "wrong-token";
    const r = await callRagService("/chat", { question: "hi", profile: PROFILE });
    expect(r.ok).toBe(false);
    expect(r.offline).toBe(false);
    expect(r.status).toBe(401);
  }, 30000);

  it("reports an unreachable service as offline", async () => {
    process.env.RAG_SERVICE_URL = "http://127.0.0.1:8099";
    const r = await callRagService("/chat", { question: "hi", profile: PROFILE });
    expect(r.ok).toBe(false);
    expect(r.offline).toBe(true);
  }, 30000);

  it("reports a blown time budget as a timeout, not as offline", async () => {
    process.env.RAG_SERVICE_TIMEOUT_MS = "1";
    const r = await callRagService("/chat", {
      question: "How should I start phonological awareness work?",
      profile: PROFILE,
    });
    expect(r.ok).toBe(false);
    expect(r.timeout).toBe(true);
    expect(r.offline).toBe(false);
  }, 30000);

  it("reports missing configuration as offline", async () => {
    delete process.env.RAG_SERVICE_URL;
    const r = await callRagService("/chat", { question: "hi", profile: PROFILE });
    expect(r.ok).toBe(false);
    expect(r.offline).toBe(true);
  }, 30000);
});
