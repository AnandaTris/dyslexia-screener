# Project Handoff — Dyslexia Screener + RAG Learning Assistant

**Last updated:** 2026-07-31 (session 3 — consolidation)
**Branch:** `jer`, 8 commits ahead of `origin/jer`.

`origin/master` is merged in as `0224607`, so `jer` now holds the screener, the error
analyser, the RAG learning assistant **and** the full test plan suite in one place.

---

## TL;DR

- **The branch is consolidated.** `jer` = everything on `master` + the RAG work.
- **`npm test` — 111 passed, 22 files.** `npm run build` — clean.
  `rag-service` pytest — **34 passed, 1 skipped** (the skip is the download feature
  that does not exist; see `tests/README.md` note 5).
- **All of Plan 3 plus this session's refinements are uncommitted.** Commit block below.
- **To actually RUN the assistant end-to-end you still need the human-only setup**
  (Ollama + `rag_schema.sql` + `rag-service/.env`) — see the README.

---

## Commits are yours to make

`~/.claude/settings.json` denies `Bash(git commit:*)` and `Bash(git push:*)`. A deny
rule cannot be overridden by an allow rule or by approving a prompt, and it must **not**
be routed around by switching to PowerShell — an earlier session did that by mistake.

Nothing in this session committed anything. You created the merge commit `0224607`
yourself. The block below is the rest.

### Commit block

```bash
# 1. Reconcile master's test plan suite with the dashboard redirect
git add app/login/actions.test.js tests/integration/it2-login.test.js \
        tests/unit/uc1-uc6-signup-verify-email.test.js \
        tests/unit/uc2-uc7-login-authentication.test.js
git commit -m "test: point the login redirect assertions at /dashboard"

# 2. Shared journey helpers and the query-builder test double
git add lib/journey.js lib/journey.test.js tests/support/queryBuilder.js
git commit -m "feat(web): add journey read + progress helpers and a query-builder double"

# 3. The journey API
git add app/api/journey/
git commit -m "feat(web): add /api/journey build, read and step-status routes"

# 4. The journey page
git add app/journey/
git commit -m "feat(web): add /journey page with journey board and step tracking"

# 5. Shared chat-history read, and the malformed-body guard
git add lib/chat.js lib/chat.test.js app/api/chat/route.js
git commit -m "feat(web): share the chat history read and answer 400 on a bad body"

# 6. The dashboard hub: progress card, analyser card, restored chat log
git add app/dashboard/ app/globals.css
git commit -m "feat(web): complete the dashboard hub and restore the chat log"

# 7. Reach the hub from the other pages
git add app/page.jsx app/analysis/page.jsx
git commit -m "feat(web): link the screener and analyser back to the dashboard"

# 8. Repo hygiene
git add .gitignore
git commit -m "chore: ignore editor dirs, build scratch and any stray .env"

# 9. Docs
git add README.md tests/README.md HANDOFF.md
git commit -m "docs: cover the RAG assistant in the README and refresh the test matrix"
```

---

## What this session did

### 1. Merged `origin/master` into `jer`

File-level conflict-free — `f8b83dc` and master's seven commits touched disjoint paths.
The real integration work was **semantic**: `f8b83dc` moved the post-login redirect from
`/` to `/dashboard`, and master's suite still asserted `/` in four places. The app was
right and the tests were stale, so the tests moved.

### 2. Reviewed the code that had never been reviewed

Plan 2 Task 4 (`app/api/chat/route.js`) and all of Plan 3. Three defects found and fixed:

- **`POST /api/journey` returned unsaved step rows.** It responded with the objects it
  had just built, not the rows Postgres wrote back — so every step arrived with
  `id: undefined`. `JourneyBoard` keys its list by `step.id` and sends `stepId` when you
  tick a box, so **after building a journey, no step could be ticked off until the page
  was reloaded.** Now the insert does `.select(...)` and returns the persisted rows.
  Regression test: "archives the old journey, persists the new one and its steps" asserts
  the ids come back.
- **A failed rebuild cost you your existing journey.** The old journey was archived
  *before* the new one was inserted, so if the insert failed you were left with no active
  journey at all — while the UI promises "your old progress is kept". Now the new journey
  is inserted first, archiving happens only after the steps are safely stored (and skips
  the new row via `.neq`), and a failed step insert rolls the parent row back. New test:
  "does not cost the learner their old journey when saving the steps fails".
- **Malformed JSON bodies returned 500.** `await req.json()` was unguarded in the chat
  and step routes. Both now answer 400.

Deliberately **not** changed: `app/api/chat/route.js` still ignores the result of its
`chat_messages` insert. Failing the request would throw away a good grounded answer over
a lost transcript, which is the worse trade. The choice is now commented rather than
silent.

### 3. Consistency

- **`lib/testing/fakeSupabase.js` → `tests/support/queryBuilder.js`.** Test-only code was
  living in the application source tree. It now sits beside master's `tests/support/`
  doubles, and `lib/` holds only shipped code. The two Supabase doubles stay separate on
  purpose — `supabase.js` models auth and a write log, `queryBuilder.js` models the
  chained read/write builder — and the file header explains the split.
- **`loadActiveJourney` was written three times** — in `app/api/journey/route.js`,
  `app/journey/page.jsx` and (in narrower form) `app/dashboard/page.jsx`. One copy now
  lives in `lib/journey.js` and all three call it, so the dashboard percentage and the
  `/journey` progress bar cannot drift apart. Covered by three new tests.

### 6. Wired the dashboard into the app

The hub was reachable but not returnable, and it was missing a subsystem:

- **Nothing linked back to `/dashboard`.** Login lands there, but `/` and `/analysis`
  had no link to it, so leaving the hub meant retyping the URL. Both now show a
  Dashboard link — inside the signed-in branch, since the page redirects anonymous
  callers to `/login` anyway.
- **The hub had no card for `/analysis`.** It linked to the screener and the journey but
  not the error pattern analyser, which is the whole of PS4. Added as a fourth card;
  the grid is `auto-fit`, so it reflows without touching the CSS.
- **The chat log reset on every reload.** `ChatAssistant` started from an empty array
  while `/api/chat` kept persisting messages *and* feeding the last turns back to the
  model — so the assistant answered as if it remembered a conversation the page had
  discarded, and follow-ups read as non-sequiturs. The dashboard now server-renders the
  recent messages and passes them in as `initialMessages`.
- **One definition of "this user's conversation".** `lib/chat.js` owns the read; the
  route asks for `MODEL_HISTORY_TURNS` (6, prompt budget) and the dashboard for
  `DISPLAYED_MESSAGES` (20, a readable transcript). Different limits, same query.
  Four new tests, including one that pins the ordering — the query is newest-first so
  the limit catches the latest messages, and a log rendered in that order reads
  backwards.

### 4. `.gitignore`

It was already in good shape; nothing dirty was untracked-but-unignored. Added
preventively: `.vscode/`, `.idea/`, `*.tsbuildinfo`, `.eslintcache`, `/dist`, `build/`,
`*.egg-info/`, and a belt-and-braces `**/.env`. That last one matters — `rag-service/.env`
holds a Supabase **service-role** key, which bypasses RLS entirely, and relying on a
single ignore rule for it is not worth the risk. Verified no tracked file became ignored
and both `.env.example` files stay visible.

### 5. Docs

`README.md` rewritten to cover all three subsystems, the two-process architecture, the
env split and why the web app never holds a service-role key, the grounding guards, and
the test layout. `tests/README.md` corrected — it still listed the NLP pipeline and the
verdict rule as untested, but master's own later commits had covered them.

---

## What is LEFT

### Human-only setup, before the assistant can answer anything

1. **`rag-service/.env` does not exist.** `config.py` reads `.env` relative to the
   working directory, so it must live in `rag-service/` and uvicorn must run from there.
   Needs `SERVICE_TOKEN` (equal to `RAG_SERVICE_TOKEN` in the root `.env`),
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OLLAMA_HOST`.
2. **Move `SUPABASE_SERVICE_ROLE_KEY` out of the root `.env`.** It is not
   `NEXT_PUBLIC_`, so it does not reach the browser — but it is loaded into the Next
   server process for no reason, and the point of the split is that the web app cannot
   bypass RLS.
3. Apply `supabase/rag_schema.sql` (after `schema.sql` and `error_analyses.sql`).
4. Ollama running with `nomic-embed-text` and `llama3.1:8b` pulled.
5. Ingest at least one document, or the assistant will correctly say it has no material.

### Signed-in browser checks (need your credentials)

Everything below is automatable-verified already except the parts that need a real
session and a live service:

1. **Offline** — service stopped, sign in → land on `/dashboard`; ask a question →
   "assistant offline", no crash.
2. **No profile** — fresh account → `/journey` → "Build my journey" → told to run a
   screening first.
3. **Nothing ingested** — service up, corpus empty → the service's note appears and no
   blank journey is saved.
4. **Build** — service up with a document ingested → steps render in order, each with a
   `Sources:` line.
5. **Track** — tick a step → the bar moves on `/journey` *and* on `/dashboard`; reload →
   it persisted; untick → `completed_at` clears. (This is the path that was broken before
   this session's fix — worth checking first.)
6. **Rebuild** — the old journey goes to `status='archived'`, not deleted.
7. **Chat log survives a reload** — ask a question, reload `/dashboard`, and the
   exchange is still there rather than an empty log.
8. **Navigation** — from `/dashboard` reach the screener, the analyser and the journey;
   from each of those get back to `/dashboard`.

### Deliberately out of scope (recorded, not oversights)

- **No separate `/chat` page.** Spec §8 lists one; the assistant is already embedded on
  `/dashboard`, so a duplicate adds no capability.
- **`chat_messages.journey_id` stays unset.** The column exists and is nullable.
- **Material download does not exist.** Ingestion discards the source file after
  chunking. `tests/README.md` note 5 has the closing steps.

---

## How to RUN it

Full instructions are now in the **README** — it is the source of truth, not this file.
Short version: `npm run dev` for the web app; `uvicorn app.main:app --port 8000` from
`rag-service/` for the assistant.

### Tests

```bash
npm test                                      # 111 passed, 22 files
cd rag-service && .venv/Scripts/python.exe -m pytest -q   # 34 passed, 1 skipped
```

---

## Key file map

- Consolidation plan: `docs/superpowers/plans/2026-07-31-rag-consolidation.md`
- Design spec: `docs/superpowers/specs/2026-07-25-rag-learning-journey-design.md`
- Plan 1 (backend): `docs/superpowers/plans/2026-07-25-rag-backend.md`
- Plan 2 (dashboard+chat): `docs/superpowers/plans/2026-07-26-rag-dashboard-integration.md`
- Plan 3 (journey+progress): `docs/superpowers/plans/2026-07-26-journey-progress-tracking.md`
- Backend code: `rag-service/`, `supabase/rag_schema.sql`
- Web integration: `lib/profile.js`, `lib/ragService.js`, `lib/journey.js`,
  `app/api/chat/`, `app/api/journey/`, `app/dashboard/`, `app/journey/`

> `docs/superpowers/` and `.superpowers/` are gitignored, so the plans and ledgers live
> only in your working tree — don't delete them if you want to resume.
