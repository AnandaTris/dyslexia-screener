# Developer Workflow

How to set the project up, run it, test it, and get unstuck. For what the system *is*,
see [`README.md`](README.md); for how the learning assistant works internally, see
[`RAG_ORCHESTRATION.md`](RAG_ORCHESTRATION.md).

Two processes make up the app:

| Process | Port | Needed for |
|---|---|---|
| Next.js web app | 3000 | Everything — screener, analyser, dashboard, auth |
| `rag-service` (FastAPI) | 8000 | Chat and journey answers only |

The web app runs fine on its own. Without the Python service the assistant reports that
it is offline and every other page still works.

---

## First-time setup

Five steps, in order. Skip step 4 and your first analysis pays for a model download
inside its own request timeout.

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

There are **two** env files and the split is deliberate — see
[`RAG_ORCHESTRATION.md`](RAG_ORCHESTRATION.md#the-env-split) for why.

```bash
cp .env.example .env                      # root: read by Next.js
cp rag-service/.env.example rag-service/.env   # read by the Python service only
```

Root `.env` — exactly the set the Next.js code reads:

```
GEMINI_API_KEY=your_key_here
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
RAG_SERVICE_URL=http://localhost:8000
RAG_SERVICE_TOKEN=a_long_random_string
RAG_SERVICE_TIMEOUT_MS=300000
```

`rag-service/.env` — and nothing else reads these:

```
SERVICE_TOKEN=a_long_random_string        # must equal RAG_SERVICE_TOKEN above
SUPABASE_URL=https://yourproject.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OLLAMA_HOST=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text
GENERATION_MODEL=llama3.2:3b
RETRIEVAL_K=6
SIMILARITY_THRESHOLD=0.5
```

**Keep `SUPABASE_SERVICE_ROLE_KEY` out of the root `.env`.** It bypasses row-level
security entirely. The point of the two-process split is that the web app cannot bypass
RLS even if it is compromised, and loading that key into the Next.js process throws the
protection away for no benefit.

`config.py` reads `.env` relative to the **working directory**, so uvicorn must be
started from `rag-service/`. `npm run dev:rag` already does this.

#### The service token

`RAG_SERVICE_TOKEN` / `SERVICE_TOKEN` is a shared secret that proves a request to the
Python service came from your Next.js server and not from anything else on the machine.
The service has no login of its own, listens on port 8000, and holds the service-role
key — so without the check, anything that could reach that port could write to the
document corpus through `/ingest`. Every endpoint except `/health` requires it, sent as
the `X-Service-Token` header (`lib/ragService.js`) and compared in `app/main.py` with
`hmac.compare_digest`, which is timing-safe. It fails closed: an unset token rejects
*every* request rather than waving them through, which is why a missing
`rag-service/.env` gives 401s rather than an unprotected service.

It carries no user identity. It says "the trusted web app sent this", not "this is a
particular therapist's student" — which learner a request concerns is Supabase auth and
RLS in the Next.js layer, using the anon key.

**You invent it. No vendor issues it.** Any long random string works:

```bash
openssl rand -hex 32
```

Paste the same output into both files. The only requirement is that the two agree *on
the machine running them* — a stray trailing space is enough to break it, and the 401 it
causes surfaces in the UI as "the learning assistant is offline".

**Each machine can hold its own.** Nothing persists the token — it is only ever compared
in-flight, never stored in Supabase or written into the corpus — so a second laptop can
use a completely different one, and rotating means editing two lines and restarting
uvicorn. No re-ingestion, no migration. The `SUPABASE_*` values sitting next to it are
the opposite case: they identify a real project, are issued by Supabase, and must be
identical everywhere.

### 3. Database

Supabase dashboard → **SQL Editor** → **New query**, run these **in order**. All four are
safe to re-run.

| # | File | Creates |
|---|---|---|
| 1 | `supabase/schema.sql` | `screenings` (PS1) |
| 2 | `supabase/error_analyses.sql` | `error_analyses` (PS4) |
| 3 | `supabase/rag_schema.sql` | pgvector, the six RAG tables, RLS, and `match_document_chunks` (PS3) |
| 4 | `supabase/students.sql` | `students`, `student_id` on three tables, the backfill, and the `learner_profiles` re-key |

**4 must come last.** It re-parents tables that 1 and 3 create, and it backfills whatever
rows already exist, so running it against a project that has not had the others applied
will do the wrong thing.

Unlike the others, **4 runs inside a transaction** — if any statement fails, the whole
migration rolls back and the database is untouched. It ends with a verification query;
expect `students` ≥ 1 and both `*_without_student` columns to be `0`.

It contains the one irreversible change in the project: `learner_profiles`'s primary key
moves from `user_id` to `student_id`. That is what allows a therapist to hold more than
one profile. Going back means restoring from a Supabase backup.

Then confirm they actually landed:

```bash
cd rag-service
python scripts/check_schema.py
```

That runs inside the `rag-service` virtualenv, so it needs
[step 5](#5-the-learning-assistant-optional) done first — do that one now if you are
working straight down this list, or come back here afterwards.

It prints every table with its row count and exercises the `match_document_chunks`
function — names and counts only, never a key, so the output is safe to paste into an
issue. It resolves the project hostname first, so an unreachable project is reported as
unreachable instead of looking like a missing schema.

You want `Schema is fully applied, per-student records included.` Anything else and the
RAG endpoints will 500, or the screener will reject every upload because `student_id` has
nowhere to go. The output names which SQL file fixes each missing piece.

### 4. Warm the NLP model

```bash
npm run warm:nlp
```

Downloads ~70 MB of quantised weights, caches them, then smoke-tests the whole pipeline
and prints the errors it found. The cache lives in
`node_modules/@huggingface/transformers/.cache`, so **a fresh `npm ci` wipes it** and you
need to re-run this.

### 5. The learning assistant (optional)

Only needed for chat and journey to answer.

Both models run locally through Ollama, so install it first. On macOS the Homebrew
formula does **not** start on its own; the `.app` from ollama.com does.

```bash
# macOS
brew install ollama
brew services start ollama          # or run `ollama serve` in its own terminal

# Windows and Linux: installer from https://ollama.com

ollama pull nomic-embed-text
ollama pull llama3.2:3b       # or llama3.1:8b if you have 6-8 GB of VRAM
```

**Whatever you pull must match `GENERATION_MODEL` in `rag-service/.env`.** `config.py`
defaults to `llama3.1:8b`, so pulling the 3b model and leaving that line unset asks
Ollama for weights you do not have, and every answer fails.

Then the Python environment. Activating the virtualenv is what makes `python` mean the
one in `.venv`, and every Python command in this file assumes you have:

```bash
cd rag-service
python -m venv .venv

source .venv/bin/activate     # macOS, Linux
.venv\Scripts\activate        # Windows

python -m pip install -r requirements.txt
```

`npm run dev:rag` finds the right interpreter on its own and needs no activation —
`scripts/venv-python.mjs` resolves `.venv/bin/python` or `.venv\Scripts\python.exe`
depending on the platform.

Then give it something to be grounded in — with an empty corpus the assistant truthfully
answers that it has no material:

```bash
python scripts/ingest_file.py ./phonics.pdf \
    --title "Phonics Guide" --doc-type guide --profiles phonological
```

**Size the model to your hardware before anything else.** `ollama ps` reports whether
the model landed on GPU or CPU; a 7B–8B model on an integrated GPU silently falls back to
100% CPU and answers take minutes rather than seconds. The measurements are in
[`RAG_ORCHESTRATION.md`](RAG_ORCHESTRATION.md#sizing-the-model-to-the-machine).

---

## Daily loop

```bash
npm run dev:all      # both processes, colour-prefixed [web] and [rag]
```

That is `concurrently -k -n web,rag`, so one Ctrl-C stops both and the `[rag]` prefix on
a traceback tells you which process it came from. To run them separately:

```bash
npm run dev          # Next.js only, port 3000
npm run dev:rag      # uvicorn --reload from rag-service/, port 8000
```

Ollama normally runs as a background service and does not need starting by hand — the
exception is a Homebrew install, which stays stopped until `brew services start ollama`.
Confirm it is answering with `curl http://127.0.0.1:11434/api/tags`.

Create an account at `/signup`; login lands on `/dashboard`.

Other scripts:

```bash
npm run build        # production build
npm start            # serve the production build
npm run lint
```

---

## Tests

```bash
npm test                 # unit + integration — no services, no database
npm run test:unit        # tests/unit only
npm run test:integration # tests/integration only
npm run test:watch
npm run test:e2e         # the live suites — needs the database and both services
npm run test:all         # everything
```

```bash
cd rag-service
source .venv/bin/activate     # Windows: .venv\Scripts\activate
python -m pytest -q
```

Last verified run (2026-08-07): **224 passed across 32 files** (JS, ~9 s), **13 passed**
(e2e, against the real project), and **52 passed, 1 skipped** (Python, <1 s). The skip is
the material-download feature that does not exist — `tests/README.md` note 5.

`npm test` deliberately **excludes** `e2e-*.test.js`. Those talk to the real Supabase
project and a running RAG service, so they fail on a machine with neither, and a
permanently red default suite is one nobody reads.

`npm run test:e2e` needs `E2E_SERVICE_TOKEN` set to the same value as `SERVICE_TOKEN` in
`rag-service/.env`. Without it every authenticated call returns 401 and the failures look
like broken code.

Apart from the e2e suites, nothing reaches the network and no API key is needed. The vision model, the Supabase
client and the RAG service are all doubled at the boundary, which is why both suites
finish in seconds.

Two conventions live side by side, and `vitest.config.mjs` picks up both so neither can
go quietly unrun:

- **Colocated** `*.test.js` beside the code it covers — `lib/`, `app/api/`, `app/login/`.
- **`tests/`** — one test per case in the team's test plan. The learning-material use
  cases live with the code they test, in `rag-service/tests/`.

Shared doubles are in `tests/support/`: `supabase.js` (auth surface + write log),
`queryBuilder.js` (the chained read/write builder the journey routes lean on),
`model.js` (vision model), `redirect.js` (captures redirects server actions throw).

**[`tests/README.md`](tests/README.md)** maps every case in the test plan to the test
covering it, and states which rows have no implementation behind them yet.

---

## Branching and commits

`master` is the main branch; feature work happens on a branch (currently `jer`) and
merges back.

Commit messages follow Conventional Commits, as the existing history does:

```
feat(journey): archive the previous journey instead of deleting it
fix(web): report a RAG timeout as a timeout, not as an offline service
docs: document model sizing, the timeout, and the threshold measurements
test: cover auth server actions and the error-analysis route
```

Scope is optional; `feat`, `fix`, `docs`, `test`, `chore` and `refactor` all appear in
the log. Do not add co-author trailers.

Before committing, run both suites. `docs/superpowers/` and `.superpowers/` are
gitignored, so plans and ledgers live only in your working tree — don't delete them if
you want to resume that work.

---

## Pre-deploy checklist

`npm run dev` on localhost is one thing; exposing it is another.

- [ ] **Bind the Python service to `127.0.0.1`** (uvicorn's default). Running it with
      `--host 0.0.0.0` puts a service-role key behind nothing but a static bearer token.
- [ ] **Rotate `RAG_SERVICE_TOKEN` / `SERVICE_TOKEN`** off whatever is in your `.env`
      now, and make it long and random.
- [ ] **Upgrade Next.js.** 14.2.35 carries 21 open advisories, several runtime-reachable
      and relevant to this app's use of Server Actions and middleware. Fix is ≥ 15.5.21.
- [ ] **Add rate limiting** to `/api/chat` and `/api/journey` — each triggers a local
      CPU-bound LLM, so any signed-in user can saturate the machine.
- [ ] **Cap the chat question length.** `/api/analyze-text` caps at 20,000 chars;
      `/api/chat` accepts any string.
- [ ] **Add security headers.** `next.config.mjs` defines no `headers()`, so there is no
      CSP, `frame-ancestors`, HSTS, `X-Content-Type-Options` or `Referrer-Policy`.
- [ ] **Stop returning raw `err.message`** to the client from `app/api/analyze/route.js`.
- [ ] **Enforce HTTPS.** The session cookie's protections assume it.
- [ ] `npm audit` — read the triage in [`README.md`](README.md#dependencies) rather than
      the raw count.
- [ ] `npm run build` clean, both test suites green.

---

## Troubleshooting

### The assistant

**"The learning assistant is offline."** The Next.js app could not reach the Python
service. Check uvicorn is running on the port in `RAG_SERVICE_URL`, and that
`RAG_SERVICE_TOKEN` and `SERVICE_TOKEN` are identical — a mismatch returns 401, which the
UI also surfaces as an error.

**"The learning assistant took too long to answer."** A *different* message from the
offline one, and it means the service is running and the model is working — just slower
than the timeout. Run `ollama ps`: if the processor column reads `100% CPU`, the model
does not fit your GPU and you want a smaller `GENERATION_MODEL`. Raising
`RAG_SERVICE_TIMEOUT_MS` stops the error but does not make the wait bearable.

**The assistant says it has no source material.** The corpus is empty, or nothing cleared
the similarity threshold. Ingest a document with `scripts/ingest_file.py`. Lowering
`SIMILARITY_THRESHOLD` also works but read
[the measurements](RAG_ORCHESTRATION.md#why-the-threshold-is-05) first — dropping it to
`0.3` in testing was enough to make an off-topic reply carry a citation.

**"Run a writing screening first."** The journey is built from a derived profile and
there is no screening on this account yet. Run one at `/`.

### The database

**`PGRST202: Could not find the function public.match_document_chunks(...)`, or every RAG
call fails on Supabase.** `supabase/rag_schema.sql` has not been applied to this project.
The error names only the function because that is the first thing retrieval touches — the
six tables are almost certainly missing too. Run `scripts/check_schema.py` to see the
whole picture, then apply the file in the SQL Editor. The other likely cause is a missing
`rag-service/.env`, leaving the service running with empty settings; the checker tells the
two apart.

**`PGRST205: Could not find the table 'public.<name>'.`** Same cause, different first
casualty — a schema file has not been applied. Check which one owns that table in the
[step 3 table](#3-database).

**Everything Supabase fails with `getaddrinfo failed` / `DNS name does not exist`.** The
project itself is gone, not misconfigured. A *paused* free-tier project still answers DNS;
a hostname that does not resolve at all has been deleted or renamed. Confirm with
`nslookup <your-ref>.supabase.co`, then get the current URL from the dashboard and update
**both** files — `NEXT_PUBLIC_SUPABASE_URL` in the root `.env` and `SUPABASE_URL` in
`rag-service/.env`. Sign-in and the screener break too, not just the assistant, because
they all point at the same project.

### The NLP pipeline

**First analysis hangs or times out.** The model was not warmed. Run `npm run warm:nlp`.

**Report says "the contextual correction model was unavailable".** The weights could not
be fetched. The analysis still ran on the lexicon and phonology layers, but homophone
errors (their/there, to/too) were not detected. Check your network and re-run
`npm run warm:nlp`.

### Tooling

**`command not found: ollama`.** Not installed on this machine — see
[step 5](#5-the-learning-assistant-optional). Everything except chat and journey still
works without it.

**Ollama is installed but nothing answers on port 11434.** On macOS, `brew install
ollama` does not start anything; run `brew services start ollama`, or `ollama serve` in
its own terminal.

**`npm run dev:all` starts `[web]` but `[rag]` exits immediately.** The `rag-service`
virtualenv is missing or was built for another OS — a `.venv` copied from a Windows
machine has `Scripts/`, not `bin/`, and none of its paths resolve here. The error names
the paths it looked for. Delete `.venv` and rebuild it per
[step 5](#5-the-learning-assistant-optional); it is gitignored and holds nothing you
wrote.

**`ollama list` prints `Error: timed out waiting for server to start`.** Usually the
server is running fine and the CLI is racing an instance that already exists. Check over
HTTP instead — `curl http://127.0.0.1:11434/api/tags` — and trust that answer.

**Build fails with `The "path" argument must be of type string`.** A package that reads
its own data files got bundled by webpack. Add it to
`experimental.serverComponentsExternalPackages` in `next.config.mjs`.

### Auth

**"Too many confirmation emails have been sent."** Supabase's free-tier email quota. Wait
about an hour, or sign in with an account you already created.

**Signup succeeds but login says email not confirmed.** Either confirm via the emailed
link, or turn off email confirmation in Supabase → Authentication → Providers → Email.
