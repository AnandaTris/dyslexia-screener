# Project Handoff — Dyslexia Screener + RAG Learning Assistant

**Last updated:** 2026-08-03 (session 6 — chat mode routing, paused on a measured gate failure)
**Branch:** `jer`. Last commit `8eaca47`. Uncommitted: the docs restructure, a
`lib/ragService.js` message fix, the untracked test/script files listed below, and
the chat-mode-routing work described under *Done this session*.

---

## Read this first (session 6)

Two things from session 5 are now **out of date**, both verified this session:

1. **The RAG schema IS applied.** `scripts/check_schema.py` prints
   `Schema is fully applied.` — all six tables plus `match_document_chunks` exist.
   The session-5 headline blocker is cleared.
2. **The corpus is empty.** `documents` and `document_chunks` both report **0 rows**.
   This is why every grounded question answers `NO_MATERIAL_MESSAGE`: `answer_question()`
   returns it without calling the model when retrieval is empty
   (`rag-service/app/generation.py:82-83`). Nothing is broken — there is nothing to
   retrieve. **Ingesting a document is the single highest-value next action.**

---

## Current state

Everything except the RAG database half is verified working. Each row below was run in
this session; the result is what the command actually printed.

| Component | Command | Result |
|---|---|---|
| JS test suite | `npm test` | **186 passed, 29 files** (~13 s) |
| Python test suite | `.venv/Scripts/python.exe -m pytest -q` | **34 passed, 1 skipped** |
| Ollama server | `GET http://127.0.0.1:11434/api/tags` | **HTTP 200**, two processes live |
| Ollama models | `ollama list` | `llama3.2:3b` (2.0 GB), `nomic-embed-text:latest` (274 MB), `olmo2:latest` (4.5 GB) |
| Embedding width | `client.embeddings(...)` on `nomic-embed-text` | **768 dims — matches `vector(768)`** |
| Supabase project | `socket.getaddrinfo` on the project host | **resolves** |
| `screenings` (PS1) | `check_schema.py` probe | **OK, 14 rows** |
| `error_analyses` (PS4) | `check_schema.py` probe | **OK, 4 rows** |
| The six RAG tables | `scripts/check_schema.py` | **all MISSING** |
| `match_document_chunks` | `scripts/check_schema.py` | **MISSING** |

So: web app, auth, screener, analyser, NLP pipeline, Ollama and both test suites are
good. The only broken path is RAG retrieval, and the cause is in the database, not the
code.

---

## Done this session (session 6)

Chat mode routing, implementing `docs/superpowers/specs/2026-08-03-chat-mode-routing-design.md`.
All code is written and both unit suites pass, but **the feature is not signed off** — see
the measured gate failure below.

- **`rag-service/app/plain.py`** — new. `PLAIN_SYSTEM`, `OFF_TOPIC_MESSAGE`,
  `answer_plain()`. Fails closed on anything that is not literally `on_topic: True`.
- **`schemas.py`** — `ChatRequest.mode: Literal["grounded","plain"] = "grounded"`.
- **`main.py`** — `chat()` branches on mode; the plain branch never touches embedder or db.
- **`app/api/chat/route.js`** — validates `mode`, normalises the unknown to `grounded`,
  passes it through, stores it on both rows, returns it.
- **`lib/chat.js`** — selects `mode` so badges survive a reload.
- **`supabase/rag_schema.sql`** — `chat_messages.mode` column, plus an
  `alter table ... add column if not exists` because the table already exists.
  **Not yet run against the live project.**
- **`ChatAssistant.jsx` + `globals.css`** — the "Answer mode" dropdown
  (Grounded / Normal) and the ungrounded badge.
- **Tests** — new `rag-service/tests/test_plain.py`, 3 cases in `test_endpoints.py`,
  4 in `app/api/chat/route.test.js`.

### Measured this session

| What | Command | Result |
|---|---|---|
| Python suite | `.venv/Scripts/python.exe -m pytest -q` | **52 passed, 1 skipped** (was 34) |
| JS suite | `npx vitest run --exclude "**/e2e-live.test.js"` | **190 passed, 29 files** (was 186) |
| JS suite incl. live harness | `npm test` | 2 failures, both in the untracked `e2e-live.test.js` — see *Undiagnosed* |
| Schema | `scripts/check_schema.py` | **fully applied**, corpus 0 rows |
| Plain mode, live | `POST /chat {"mode":"plain"}` | **answered** "what does letter reversal mean?" with `citations: []` |
| Bad mode, live | `POST /chat {"mode":"nonsense"}` | **422** |
| No mode, live | `POST /chat` | **grounded** → `NO_MATERIAL_MESSAGE` (corpus empty) |
| Topic gate, one call | 8-question probe vs `llama3.2:3b` | **5/8** — answered "write me a python quicksort" in full |
| Topic gate, dedicated classify call | same 8 questions, isolated | **7/8** — only "capital of France?" leaked |
| **Topic gate, two calls, live `POST /chat`** | same 8 questions | **8/8** — 4 refused, 4 answered |
| Classify call latency | 3 warm runs | **1.39 / 1.52 / 1.70 s** (min/mean/max) |
| Answer call latency | 3 warm runs | **3.89 / 4.71 / 5.32 s** (min/mean/max) |

### The design that changed mid-build

**The spec's one-call topic gate does not work on `llama3.2:3b`.** It assumed the model
would honestly report `on_topic` while also answering. Measured, it does not: asked to
`write me a python quicksort` in plain mode it set `on_topic: true` and returned a working
quicksort. The Python `is not True` check was sound — it simply never fired, because the
model never said false.

Resolved by splitting the two jobs across two calls (`is_on_topic()` then the answering
call), which the user approved after seeing the measurements. `"When in doubt, answer
false"` in the classifier prompt closed the last leak. `docs/superpowers/specs/2026-08-03-chat-mode-routing-design.md`
now carries a SUPERSEDED marker on that section with the numbers.

### Deliberately not done: `chat_messages.mode`

The user chose to skip the SQL for now, so `mode` is **not** written or read at the
database boundary. This is load-bearing: PostgREST fails an insert or select naming a
column it does not know, so writing `mode` against the unaltered table would have killed
the *entire* transcript to gain a badge. Both `app/api/chat/route.js` and `lib/chat.js`
carry a comment saying exactly what to re-add, and `route.test.js` has a test asserting
the omission so it cannot regress silently.

Badges work within a session; they disappear on reload. To finish it, run against the
project:

```sql
alter table public.chat_messages
  add column if not exists mode text not null default 'grounded';
alter table public.chat_messages
  add constraint chat_messages_mode_check check (mode in ('grounded','plain'));
```

then put `mode` back into the insert in `app/api/chat/route.js`, into the select in
`lib/chat.js`, and delete the "does not write mode until the column exists" test.

### Undiagnosed

`e2e-live.test.js > builds a journey` fails with `r.ok === false` while the service was up.
Not investigated — the service went down before it could be reproduced by hand
(`/health` now returns nothing, nothing bound to :8000). The sibling failure,
`returns a grounded answer with citations`, is explained: the corpus is empty, so there
are zero citations to assert on.

---

## Done in session 5

No commits yet — everything below is in the working tree.

- **Diagnosed the `/chat` 500.** PostgREST `PGRST202` on `match_document_chunks` was the
  visible error; `scripts/check_schema.py` showed the six RAG tables are missing too.
  `supabase/rag_schema.sql` has simply never been applied to this project. No code defect
  — `db.py`'s RPC call matches the SQL signature exactly.
- **Cleared Ollama as a suspect.** Server up, both configured models pulled, embedding
  width confirmed at 768. Nothing to host: it is a local server already running.
- **Restructured the docs** into three at root plus the progress file:
  - `README.md` — rewritten, 513 → ~300 lines. Overview, architecture, per-page usage,
    project layout, security, limitations. Setup/run/test/troubleshooting removed in
    favour of pointers.
  - `WORKFLOW.md` — **new.** First-time setup, daily loop, tests, branch/commit
    conventions, pre-deploy checklist, all troubleshooting entries.
  - `RAG_ORCHESTRATION.md` — **new.** Two-process split, env split, module map,
    endpoints, ingestion and answering pipelines, the pgvector function, the three
    grounding guards, threshold and model-sizing measurements, client failure modes.
  - `rag-service/README.md` — **deleted** (`git rm`), content absorbed.
- **Fixed a link the deletion would have broken.** `lib/ragService.js`'s offline message
  pointed at `rag-service/README.md`; it now points at `WORKFLOW.md`. Its tests assert the
  `offline` flag, not the message text, so they were unaffected.

### Stale claims corrected

- **"The Supabase project no longer exists / does not resolve in DNS."** This was the
  previous handoff's headline blocker and it is **no longer true.** The host resolves and
  two tables hold live data. Only `rag_schema.sql` is unapplied.
- **Test counts.** The old file said both "186 passed, 29 files" and "113 passed, 22
  files". 186/29 is correct.
- **`llama3.1:8b`** appeared as the generation model in the README diagram and model
  table. The running config is `llama3.2:3b`; `llama3.1:8b` is only `config.py`'s built-in
  default.

---

## In progress / next steps

1. ~~**Apply the RAG schema.**~~ **Done** — `check_schema.py` reports
   `Schema is fully applied.` as of session 6.
2. **Ingest at least one document.** This is now the highest-value action in the project:
   the corpus is empty, so Grounded mode answers every question with
   `NO_MATERIAL_MESSAGE` and `/journey` has nothing to plan from. Normal mode works
   regardless, but it is ungrounded by design.
   ```bash
   cd rag-service
   .venv/Scripts/python.exe scripts/ingest_file.py path/to/guide.pdf \
       --title "Phonics Guide" --doc-type guide --profiles phonological
   ```
   `docs/` already holds three DAS problem-statement PDFs that could seed the corpus.
3. **Try the mode dropdown in the browser** — `/dashboard` → "Answer mode" →
   *Normal — general knowledge*. Verified at the API layer this session but **not** in a
   signed-in browser.
4. **Re-run `npm test` and commit.** Suggested split:
   ```bash
   git add lib/nlp/align.test.js lib/nlp/g2p.test.js lib/nlp/morphology.test.js \
           lib/nlp/phonemes.test.js lib/nlp/taxonomy.test.js \
           lib/screening/handoff.test.js middleware.test.js
   git commit -m "test: cover the remaining NLP stages, screening handoff and middleware"

   git add rag-service/scripts/check_schema.py .gitignore
   git commit -m "chore(rag): add a schema checker and ignore decorated .env variants"

   git add README.md WORKFLOW.md RAG_ORCHESTRATION.md HANDOFF.md \
           rag-service/README.md lib/ragService.js
   git commit -m "docs: split into README, WORKFLOW and RAG_ORCHESTRATION"

   git add rag-service/app/plain.py rag-service/app/main.py rag-service/app/schemas.py \
           rag-service/tests/test_plain.py rag-service/tests/test_endpoints.py \
           app/api/chat/route.js app/api/chat/route.test.js app/dashboard/ChatAssistant.jsx \
           app/dashboard/page.jsx app/globals.css lib/chat.js supabase/rag_schema.sql
   git commit -m "feat(chat): add a Normal answering mode behind a two-call topic gate"
   ```
   Pushing stays yours — `git push` has been denied in previous sessions.

### Open design question, parked

The user asked for the no-material reply to refer the learner to **a human coach**
("need to check out with our human coach"). Brainstorming started and was parked.

What already exists: `answer_question()` returns `NO_MATERIAL_MESSAGE` without ever
calling the model, so the honest-refusal behaviour is done. What is missing is the
referral itself. Undecided:

- Copy-only reword, or a structured flag (e.g. `needs_human: true`) the UI renders as a
  distinct callout rather than an ordinary chat bubble?
- Is there a real coach contact channel (mailto, booking link) to point at?
- Does it apply to `compose_journey`'s empty-journey note too?
- Should it also fire when the *model* says it lacks material (`generation.py:91`), not
  just when retrieval returns nothing?

### Signed-in browser checks (need real credentials + an ingested corpus)

1. **Offline** — service stopped, sign in → `/dashboard`; ask a question → "assistant
   offline", no crash.
2. **No profile** — fresh account → `/journey` → "Build my journey" → told to run a
   screening first.
3. **Nothing ingested** — service up, corpus empty → the service's note appears and no
   blank journey is saved.
4. **Build** — corpus ingested → steps render in order, each with a `Sources:` line.
5. **Track** — tick a step → the bar moves on `/journey` *and* `/dashboard`; reload → it
   persisted; untick → `completed_at` clears.
6. **Rebuild** — the old journey goes to `status='archived'`, not deleted.
7. **Chat log survives a reload.**
8. **Navigation** — reach the screener, analyser and journey from `/dashboard`, and get
   back from each.

---

## Blockers

**None hard.** The session-5 blocker (`rag_schema.sql` unapplied) is cleared — verified
this session.

Two soft ones:

- **The corpus is empty**, so Grounded mode and `/journey` have nothing to work with. Not
  a defect; step 2 of *Next steps* fixes it.
- **`chat_messages.mode` is not applied**, by choice, so mode badges do not survive a
  reload. The two-line SQL and the three code changes are written out under *Deliberately
  not done* above.

DDL still cannot be applied from the CLI here: no `supabase` CLI, no `psql`, no database
password in `rag-service/.env` (only the service-role key), and PostgREST does not execute
DDL. Anything schema-related has to go through the dashboard SQL Editor.

---

## Decisions and why

- **The topic gate is two model calls, not one.** Measured, not assumed: one call scored
  5/8 and wrote a working quicksort in a dyslexia assistant; two scored 8/8 live for
  +1.5 s. A model asked to be helpful and to police its own scope in the same breath
  picks helpful.
- **"Normal" on screen, `plain` on the wire.** The stored value matches the spec, the
  module name and the SQL check constraint; the label matches what actually reads as the
  opposite of "Grounded" to a learner. `MODES` in `ChatAssistant.jsx` is the one place
  the two are mapped.
- **An unrecognised `mode` is answered, not rejected.** `route.js` normalises it to
  `grounded` — the safe fallback is the one that cites sources, so a stale browser gets a
  good answer rather than an error. The service independently 422s a third value, so no
  other caller can invent one.
- **A broken classifier reply and a broken answer reply resolve differently.** The first
  is "off topic", the second is "I'm not sure". Once the gate has passed, blaming scope
  would misreport what failed.
- **`/journey` is grounded-only.** An uncited learning plan is precisely what guard 3
  exists to prevent, so the mode never reaches it.
- **`llama3.2:3b`, not an 8B model.** Measured on this machine (Intel Iris Xe, ~1 GB
  VRAM): `olmo2` warm **187 s** per answer vs `llama3.2:3b` warm **6.7 s**. Both run 100%
  on CPU — the 3B simply fits. Change it back only on a machine with real VRAM.
- **`SIMILARITY_THRESHOLD` stays 0.5.** Measured, not assumed: on-topic best similarity
  **0.773** (5 of 5 chunks pass), off-topic best **0.302** (0 pass). At 0.3 an off-topic
  reply carried a citation. Recorded in `RAG_ORCHESTRATION.md` so nobody tunes it down
  without knowing the cost.
- **`app/api/chat/route.js` still ignores its `chat_messages` insert result.** Failing the
  request would throw away a good grounded answer over a lost transcript. The choice is
  commented rather than silent.
- **HANDOFF.md kept rather than folded away.** The docs restructure originally deleted it;
  the global instruction to keep a root progress file takes precedence, so it stays and
  the three-doc split sits alongside it.
- **Docs split three ways** because one 513-line README was mixing three audiences:
  someone evaluating the project, someone setting it up, and someone changing the RAG
  internals.

---

## Key file map

- Design spec: `docs/superpowers/specs/2026-07-25-rag-learning-journey-design.md`
- Consolidation plan: `docs/superpowers/plans/2026-07-31-rag-consolidation.md`
- Plan 1 (backend): `docs/superpowers/plans/2026-07-25-rag-backend.md`
- Plan 2 (dashboard+chat): `docs/superpowers/plans/2026-07-26-rag-dashboard-integration.md`
- Plan 3 (journey+progress): `docs/superpowers/plans/2026-07-26-journey-progress-tracking.md`
- Chat mode routing spec: `docs/superpowers/specs/2026-08-03-chat-mode-routing-design.md`
  (its topic-gate section is marked SUPERSEDED — read that part before trusting it)
- Backend code: `rag-service/`, `supabase/rag_schema.sql`, `rag-service/app/plain.py`
- Web integration: `lib/profile.js`, `lib/ragService.js`, `lib/journey.js`,
  `app/api/chat/`, `app/api/journey/`, `app/dashboard/`, `app/journey/`

> `docs/superpowers/` and `.superpowers/` are gitignored, so the plans and ledgers live
> only in your working tree — don't delete them if you want to resume.
