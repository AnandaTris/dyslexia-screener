"use client";

import { useState } from "react";

// The on-screen label and the stored value differ on purpose: "plain" is the
// vocabulary the service, the schema and the design spec all use, while
// "Normal" is what actually reads as the opposite of "Grounded" to a learner.
const MODES = [
  { value: "grounded", label: "Grounded — from your sources" },
  { value: "plain", label: "Normal — general knowledge" },
];

const UNGROUNDED_BADGE = "General knowledge — not from your uploaded sources.";

// `initialMessages` is server-rendered from chat_messages. Without it the log
// looked empty after every reload while the route still fed the last turns back
// to the model — so the assistant remembered a conversation the page had thrown
// away, and follow-up questions read as non-sequiturs.
export default function ChatAssistant({ initialMessages = [] }) {
  const [messages, setMessages] = useState(initialMessages); // {role, content, citations?, mode?}
  const [input, setInput] = useState("");
  // Session state, not a saved preference: the default resets to Grounded on
  // every page load, so nobody inherits an ungrounded assistant they forgot
  // they turned on.
  const [mode, setMode] = useState("grounded");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const send = async (e) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: question, mode }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.answer,
          citations: data.citations || [],
          // The server's validated mode, not the local one — if it normalised an
          // unrecognised value back to grounded, the badge must follow.
          mode: data.mode || "grounded",
        },
      ]);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="chat-mode">
        <label htmlFor="chat-mode-select">Answer mode</label>
        <select
          id="chat-mode-select"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <p className="assistant-note">
        {mode === "plain"
          ? "Normal mode answers from the model's own knowledge. Nothing it says is checked against a source — treat it as a starting point, not a reference."
          : "Grounded mode answers only from uploaded resources, with citations. If nothing has been uploaded yet, it will say so rather than guess."}
      </p>

      <div className="chat-log" aria-live="polite">
        {messages.length === 0 && !loading && (
          <p className="assistant-note">
            Ask something like &ldquo;what does letter reversal mean?&rdquo;
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div>{m.content}</div>
            {m.citations?.length > 0 && (
              <div className="chat-citations">
                Sources: {m.citations.map((c) => c.title || c.id).join(", ")}
              </div>
            )}
            {m.role === "assistant" && m.mode === "plain" && (
              <div className="chat-ungrounded">⚠ {UNGROUNDED_BADGE}</div>
            )}
          </div>
        ))}
        {loading && <div className="chat-msg assistant">Thinking…</div>}
      </div>

      {error && (
        <div className="chat-offline" role="alert">
          {error}
        </div>
      )}

      <form className="chat-input-row" onSubmit={send}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the learning assistant…"
          aria-label="Your question"
        />
        <button className="btn btn-primary" type="submit" disabled={loading}>
          Send
        </button>
      </form>
    </div>
  );
}
