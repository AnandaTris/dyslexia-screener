# RAG Orchestration

How the grounded learning assistant is put together: what runs where, what happens on
each request, and why it will not invent a source.

For setup and run commands see [`WORKFLOW.md`](WORKFLOW.md). For the product overview see
[`README.md`](README.md).

---

## The two-process split

```
┌──────────────────────────────┐          ┌──────────────────────────────┐
│  Next.js app   (port 3000)   │          │  rag-service   (port 8000)   │
│                              │   HTTP   │  FastAPI, Python             │
│  /dashboard  hub + chat      │ ───────► │                              │
│  /journey    cited steps     │  X-Service-Token                        │
│                              │          │  /ingest   chunk + embed     │
│  lib/ragService.js           │          │  /chat     grounded answer   │
│    the only caller           │          │  /journey  cited steps       │
│                              │          │  /health                     │
│  anon key, RLS enforced      │          │  Ollama · Supabase pgvector  │
└──────────────────────────────┘          └──────────────────────────────┘
              │                                          │
              └───────────────► Supabase ◄───────────────┘
                    anon key                service-role key
                    (RLS enforced)          (RAG store only)
```

The web app is fully usable without the Python service — the assistant reports that it is
offline and everything else works.

**Nothing is sent to a third party.** Both the embedding model and the generation model
run locally through Ollama. Gemini is used for PS1 vision only, in the Next.js app.

### The env split

| Root `.env` (Next.js reads) | `rag-service/.env` (Python reads) |
|---|---|
| `GEMINI_API_KEY` | `SERVICE_TOKEN` |
| `NEXT_PUBLIC_SUPABASE_URL` | `SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `SUPABASE_SERVICE_ROLE_KEY` |
| `RAG_SERVICE_URL` | `OLLAMA_HOST` |
| `RAG_SERVICE_TOKEN` | `EMBEDDING_MODEL` |
| `RAG_SERVICE_TIMEOUT_MS` | `GENERATION_MODEL` |
| | `RETRIEVAL_K` |
| | `SIMILARITY_THRESHOLD` |

**The web app never holds a service-role key.** It talks to Supabase with the public anon
key, so row-level security is what protects a learner's data. Only the Python service
holds the service-role key, and only it writes the document corpus — which is why the two
RAG store tables are RLS deny-all: a compromised web app cannot poison the corpus.

`SERVICE_TOKEN` must equal `RAG_SERVICE_TOKEN`. It is compared with
`hmac.compare_digest` (timing-safe) and **fails closed when unset** — an unconfigured
service rejects every call rather than accepting every call.

`config.py` reads `.env` relative to the working directory, so uvicorn must start from
`rag-service/`.

---

## Modules

| File | Responsibility |
|---|---|
| `app/main.py` | FastAPI app, the four endpoints, token auth, dependency wiring |
| `app/config.py` | Pydantic settings from `rag-service/.env` |
| `app/chunking.py` | Document text → overlapping chunks |
| `app/embeddings.py` | Ollama embedding client (`embed`, `embed_batch`) |
| `app/db.py` | Supabase adapter — inserts and the pgvector RPC |
| `app/ingest.py` | Ingestion pipeline |
| `app/retrieval.py` | Profile-filtered similarity search + threshold |
| `app/generation.py` | Grounded generation, the no-material guard, citation resolution |
| `app/plain.py` | Ungrounded generation and the two-call topic gate |
| `app/schemas.py` | Request models |
| `scripts/ingest_file.py` | CLI to load a `.txt` / `.pdf` source |
| `scripts/check_schema.py` | Reports which parts of `rag_schema.sql` are live |

Dependencies are injected through FastAPI (`get_embedder`, `get_generator`, `get_db`),
which is what lets the test suite swap in an in-memory vector store without touching
application code.

---

## Endpoints

All four are server-to-server. Every one except `/health` requires the
`X-Service-Token` header.

| Endpoint | Purpose | Returns |
|---|---|---|
| `GET /health` | Liveness | `{"status": "ok"}` |
| `POST /ingest` | Chunk, embed and store a document | `{document_id, chunks}` |
| `POST /chat` | Answer a question, grounded or plain | `{answer, citations}` |
| `POST /journey` | Ordered, cited learning steps | `{steps, note}` |

`/ingest` answers **422** when the document produces no chunks (empty text). A bad token
is **401**.

`/chat` takes `mode: "grounded" | "plain"`, defaulting to `grounded` so a client that
sends nothing keeps the cited behaviour. Pydantic rejects any third value with a **422**
before the endpoint runs. `/journey` has no such option — an uncited learning plan is
exactly what guard 3 below exists to prevent.

---

## The plain path

`mode="plain"` skips retrieval entirely: no embedding call, no pgvector round trip. It is
therefore *faster* than grounded, not slower. Citations are always `[]`, and the web UI
badges every plain answer as general knowledge.

Scope is enforced by **two** model calls, not one:

```
question + mode="plain"
  └─ is_on_topic()  → classifier call → {"on_topic": bool}
       ├─ not literally True → OFF_TOPIC_MESSAGE, the answering model is never asked
       └─ True → answering call → {"answer": str} → {answer, citations: []}
```

The one-call version — ask for `{"on_topic", "answer"}` together and let Python decide —
was built first and measured at **5/8** against `llama3.2:3b`: asked for a Python
quicksort it reported `on_topic: true` and wrote one. A model asked to be helpful and to
police itself in the same call resolves that towards helpful. Two calls measured **8/8**
end-to-end. Measured warm cost: classify **1.52 s** mean, answer **4.71 s** mean, so
~6.2 s in scope and ~1.5 s out of it.

Recent history goes to the classifier as well as the answering call, because a follow-up
like "and p?" is not self-describing and would otherwise be refused.

---

## Ingestion

```
document text
  └─ chunk_text()          2400 chars max, 400-char overlap, split on word boundaries
       └─ embed_batch()    nomic-embed-text → 768-dim vectors, one call for all chunks
            └─ insert_document()   documents row: title, source, doc_type, target_profiles
                 └─ insert_chunks()  document_chunks rows: content, embedding, index, metadata
```

Chunking is ~2400 characters (≈600 tokens) with a ~400-character (≈100 token) overlap so
a passage split across a boundary is still retrievable from both sides. Every returned
chunk is guaranteed to be at most `max_chars`: a single token longer than the budget is
hard-sliced, and the overlap tail is dropped rather than allowed to push a chunk over.

Embeddings are written as a pgvector literal by `to_pgvector()` at 8 decimal places.

**Ingestion discards the source file after chunking.** Only the extracted text is stored,
which is why there is no material-download feature — there is nothing to serve back.

```bash
cd rag-service
source .venv/bin/activate     # Windows: .venv\Scripts\activate
python scripts/ingest_file.py ./phonics.pdf \
    --title "Phonics Guide" --doc-type guide --profiles phonological
```

`--doc-type` is one of `exercise`, `guide`, `article` (enforced by a CHECK constraint).
`--profiles` tags the document for a learner emphasis; a document with **no** profiles is
treated as universal and matches every learner.

---

## Answering a question

```
screening indicators ─► lib/profile.js ─► learner_profiles
                                                │
                        question ───────────────┤
                                                ▼
                          embed (nomic-embed-text, 768-dim)
                                                ▼
                          match_document_chunks (pgvector, cosine)
                                                ▼
                          top-k chunks above the similarity threshold
                                                ▼
                          local LLM — "use ONLY these excerpts"
                                                ▼
                          {answer, citations} ─► rendered with a Sources: line
```

Step by step, for `POST /api/chat` in the web app:

1. **`app/api/chat/route.js`** authenticates the caller, loads their `learner_profiles`
   row and the last `MODEL_HISTORY_TURNS` (6) messages, and calls `lib/ragService.js`.
2. **`retrieve()`** embeds the question, calls `match_document_chunks`, and drops
   everything below `SIMILARITY_THRESHOLD`.
3. **`answer_question()`** builds the prompt from the surviving chunks and asks Ollama for
   JSON. If there are no chunks it returns a fixed message **without calling the model**.
4. **`_citations_for()`** resolves the model's `source_ids` against the chunks actually
   retrieved, dropping any it cannot find.
5. The route persists both messages to `chat_messages` and returns `{answer, citations}`.

The journey path is the same shape, except the retrieval query is synthesised from the
profile rather than typed by the user:

```python
f"learning activities for {profile['primary_label']} dyslexia support"
```

Retrieval is **filtered by the learner's profile**: `filter_profiles` is set to
`[primary_label]`, so a learner with a phonological emphasis is shown phonological
material first. Chat history is sent for conversational continuity but is *not* used for
grounding — the model is grounded by the excerpts it is given now, not by what it cited
last time.

---

## The pgvector function

`supabase/rag_schema.sql` defines the one database function the retrieval path depends on:

```sql
create or replace function public.match_document_chunks(
  query_embedding vector(768),
  match_count int default 6,
  filter_profiles text[] default null
) returns table (
  id uuid, document_id uuid, content text, chunk_index int,
  metadata jsonb, title text, similarity float
) language sql stable
  set search_path = public, pg_temp
as $$
  select dc.id, dc.document_id, dc.content, dc.chunk_index, dc.metadata,
         d.title, 1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where filter_profiles is null
     or cardinality(d.target_profiles) = 0
     or d.target_profiles && filter_profiles
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;
```

`<=>` is pgvector's cosine **distance**, so `1 - distance` is the similarity the service
thresholds on. The profile filter admits a document when no filter was requested, when
the document is untagged (universal), or when its tags overlap the requested profiles.

`document_chunks` carries an HNSW index built for `vector_cosine_ops`, matching the
operator used in the `ORDER BY`.

**The embedding dimension is not a free parameter.** The column is `vector(768)` because
that is `nomic-embed-text`'s output size. `GENERATION_MODEL` can point at any chat model
you have pulled — the code asks Ollama for JSON and does not depend on a checkpoint — but
changing `EMBEDDING_MODEL` to a model of a different width requires a migration.

Verify the function and the six tables are live with:

```bash
cd rag-service && python scripts/check_schema.py     # with .venv activated
```

A `PGRST202` error naming `match_document_chunks` means this file was never applied. The
error names only the function because that is the first thing retrieval touches — the
tables are almost certainly missing too.

---

## Why it will not invent a source

Three guards, in order of how much they matter.

**1. No chunks, no model call.** If retrieval comes back empty, `answer_question()` and
`compose_journey()` return a fixed "I don't have material on that" message without ever
prompting the LLM. An empty corpus cannot produce a confident answer, because the model is
never asked.

**2. Citations are resolved, not trusted.** The model returns `source_ids`; the service
looks each one up in the chunks that were actually retrieved and drops any it cannot find.
A hallucinated citation never reaches the UI.

**3. An empty journey is never saved.** If the service returns no steps, the route hands
back the note and persists nothing, so a learner is never left with a blank board.

The system prompts also constrain the model to the excerpts, but a prompt is a request,
not a guarantee — guards 1 and 2 are the ones that hold.

### Why the threshold is 0.5

Guard 1 rests entirely on `SIMILARITY_THRESHOLD`, so the default is not arbitrary.
Measured against a phonics document with `nomic-embed-text`:

| Question | Best cosine similarity | Chunks passing 0.5 |
|---|---|---|
| "How should I start phonological awareness work?" | **0.773** | 5 of 5 |
| "What is the capital of Argentina?" | **0.302** | **0** |

The default of `0.5` sits in the gap. Lower it much and off-topic questions start
retrieving marginal chunks, which is enough for the model to answer from — dropping it to
`0.3` in testing was enough to make an off-topic reply carry a citation.

The failure mode this leaves is an unhelpful answer, not a confident wrong one. That is
the right way round for a tool used on children.

---

## Sizing the model to the machine

This matters more than it looks. Check where Ollama actually puts the model:

```bash
ollama ps        # the PROCESSOR column says 100% CPU or 100% GPU
```

A 7B–8B model needs roughly 6–8 GB of VRAM. On an integrated GPU (Intel Iris Xe and
similar have about 1 GB) it will not fit, and Ollama silently falls back to **100% CPU** —
correct answers, but unusably slow. Measured on this machine, same question, same corpus:

| Model | Cold (incl. load) | Warm |
|---|---|---|
| `olmo2:latest` (4.5 GB) | — | **187 s** |
| `llama3.2:3b` (2.0 GB) | 38.2 s | **6.7 s** |

Both still ran 100% on CPU; the 3B model simply fits the machine. 6.7 s is a usable chat
latency. Answers are terser than `olmo2`'s but correctly grounded and cited.

If `ollama ps` says `100% CPU`, use a 3B model. If it says `100% GPU`, an 8B is fine.

Note that `config.py`'s built-in default is `llama3.1:8b`, which suits a machine with real
VRAM. `rag-service/.env` overrides it to `llama3.2:3b` for this hardware.

---

## Failure modes the client distinguishes

`lib/ragService.js` is the only caller, and it never throws — callers get a structured
result so the UI can degrade gracefully.

| Situation | Result | What the user sees |
|---|---|---|
| `RAG_SERVICE_URL`/`TOKEN` unset | `{ok: false, offline: true}` | "assistant is offline" |
| Connection refused | `{ok: false, offline: true}` | "assistant is offline" |
| Budget exceeded | `{ok: false, timeout: true, offline: false}` | "took too long to answer" |
| Non-2xx (e.g. 401) | `{ok: false, offline: false, status}` | "returned an error (401)" |
| Success | `{ok: true, data}` | The answer, with a `Sources:` line |

**A timeout is not an offline service**, and the distinction is load-bearing. Before it
existed, a slow local model produced *"The learning assistant is offline. Start the Python
RAG service"* while the service was running and mid-answer — pointing whoever read it at
the one component that was not broken.

The budget is `RAG_SERVICE_TIMEOUT_MS` (root `.env`, default **300000**). It is
deliberately generous because the model is local; on a machine with a real GPU 30000 is
safe.

The default was 120000 until 2026-08-07, when a live end-to-end run failed at **120325 ms**
— the service had answered correctly and the client gave up 325 ms too late. Measured on
CPU-only hardware: grounded `/chat` 16-20 s warm but **118 s** on the first call after
Ollama starts, and `/journey` 72-76 s warm, **121.8 s** cold. A limit the happy path lands
on top of is the wrong limit.

---

## Testing the service

```bash
cd rag-service
source .venv/bin/activate     # Windows: .venv\Scripts\activate
python -m pytest -q
```

Last verified: **34 passed, 1 skipped** (the skip is the material-download feature that
does not exist). Nothing reaches the network — Ollama and Supabase are both doubled at
the boundary.

The stack has also been proven end to end against **real Ollama** with an in-memory
vector store swapped in for pgvector via `dependency_overrides[get_db]`, driven through
`lib/ragService.js` itself: real chunking, real embeddings, real cosine ranking, real
generation, real token auth. On-topic chat returned a grounded answer with a resolved
citation; off-topic chat refused with zero citations; the journey produced ordered, cited
steps; and the bad-token, unreachable and timed-out paths each reported correctly.
