"use client";

import { useState } from "react";

// `initialMessages` is server-rendered from chat_messages. Without it the log
// looked empty after every reload while the route still fed the last turns back
// to the model — so the assistant remembered a conversation the page had thrown
// away, and follow-up questions read as non-sequiturs.
export default function ChatAssistant({ initialMessages = [] }) {
  const [messages, setMessages] = useState(initialMessages); // {role, content, citations?}
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const send = async (e) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: question }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.answer, citations: data.citations || [] },
      ]);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
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
