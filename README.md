# DAS D.I.A.L. — Screener, Error Pattern Analyzer, Learning Assistant

A Next.js app for the DAS Individualised AI-Based Learning System, with a separate
Python service for the retrieval-augmented learning assistant. It covers three of the
problem statements:

- **PS1 — Learning Screening Engine.** Reads a photo of handwriting and flags
  surface-level indicators associated with dyslexia (Gemini vision).
- **PS4 — Error Pattern Analyzer.** Runs an NLP pipeline over the writing, categorises
  every spelling error as phonological / orthographic / morphological / visual, and
  describes which error *pattern* the sample fits.
- **PS3 — Adaptive learning, in part.** A grounded chat assistant and a step-by-step
  **learning journey**, both built from the learner's derived profile and drawn only
  from resources you have uploaded. Every answer and every step cites its source.

> **This is a screening aid, not a diagnostic tool.** Dyslexia and its profiles can only
> be identified through a full psychoeducational assessment by a qualified professional.
> The app states this in the UI, in the model prompt, and in every generated report.

---

## How it fits together

Two processes. The web app runs on its own and is fully usable without the second one —
the assistant simply reports that it is offline.

```
┌──────────────────────────────┐          ┌──────────────────────────────┐
│  Next.js app   (port 3000)   │          │  rag-service   (port 8000)   │
│                              │          │  FastAPI, Python             │
│  /           screener   PS1  │   HTTP   │                              │
│  /analysis   analyser   PS4  │ ───────► │  /ingest    chunk + embed    │
│  /dashboard  hub + chat      │  X-Service-Token                        │
│  /journey    cited steps     │          │  /chat      grounded answer  │
│                              │          │  /journey   cited steps      │
│  local NLP (Transformers.js) │          │  Ollama (local LLM)          │
│  Gemini vision (PS1 only)    │          │  Supabase pgvector           │
└──────────────────────────────┘          └──────────────────────────────┘
              │                                          │
              └───────────────► Supabase ◄───────────────┘
                    anon key                service-role key
                    (RLS enforced)          (RAG store only)
```

**The web app never holds a service-role key.** It talks to Supabase with the public
anon key, so row-level security is what protects a learner's data. Only the Python
service holds the service-role key, and only it writes the document corpus — which is
why the RAG tables are RLS deny-all: your public anon key cannot poison the corpus.

---

## Quick start

The screener and the analyser need only the web app:

```bash
npm install
cp .env.example .env           # then fill in your keys
npm run warm:nlp               # one-time, ~1 min: downloads and caches the NLP model
npm run dev
```

Apply the database schema (below) and open <http://localhost:3000>. The chat and
journey pages will say the assistant is offline until you also run the Python service —
everything else works.

### 1. Dependencies

```bash
npm install
```

### 2. Environment variables

There are **two** env files, and the split is deliberate.

**Root `.env`** — read by the Next.js server:

```
GEMINI_API_KEY=your_key_here
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
RAG_SERVICE_URL=http://localhost:8000
RAG_SERVICE_TOKEN=a_long_random_string
```

**`rag-service/.env`** — read by the Python service, and by nothing else:

```
SERVICE_TOKEN=a_long_random_string        # must equal RAG_SERVICE_TOKEN above
SUPABASE_URL=https://yourproject.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OLLAMA_HOST=http://localhost:11434
```

`GEMINI_API_KEY` is server-only and never reaches the browser. The two `NEXT_PUBLIC_`
Supabase values are public by design — RLS protects the data, not secrecy of the anon
key.

`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security entirely. **Keep it out of the
root `.env`.** Putting it there loads it into the Next.js server process for no reason,
and the whole point of the two-process split is that the web app cannot bypass RLS even
if it is compromised. `rag-service/app/config.py` reads `.env` relative to the working
directory, so run uvicorn *from* `rag-service/` and it picks up the right file.

Optional Python tuning, with defaults: `EMBEDDING_MODEL` (`nomic-embed-text`),
`GENERATION_MODEL` (`llama3.1:8b`), `RETRIEVAL_K` (`6`), `SIMILARITY_THRESHOLD` (`0.5`).

### 3. Database

In the Supabase dashboard → **SQL Editor** → **New query**, run the files in order:

1. `supabase/schema.sql` — the `screenings` table (PS1)
2. `supabase/error_analyses.sql` — the `error_analyses` table (PS4)
3. `supabase/rag_schema.sql` — pgvector, the six RAG tables, RLS, and the
   `match_document_chunks` cosine-similarity function (PS3)

All of them enable row-level security so a user can only ever read their own rows. The
RAG document store goes further and is deny-all to the anon key.

### 4. Warm the NLP model

```bash
npm run warm:nlp
```

Downloads ~70 MB of quantised model weights, caches them, then smoke-tests the whole
pipeline and prints the errors it found. **Run this before your first analysis** —
without it, the first request pays for the download inside its own timeout.

The cache lives in `node_modules/@huggingface/transformers/.cache`, so a fresh
`npm ci` wipes it and you need to re-run this.

### 5. Run

```bash
npm run dev          # development
npm run build        # production build
npm start            # serve the production build
```

Create an account at `/signup`. Login lands you on `/dashboard`.

### 6. The learning assistant (optional second process)

Only needed for the chat and the journey to actually answer. Full instructions in
[`rag-service/README.md`](rag-service/README.md); the short version:

```bash
# once: install Ollama from https://ollama.com, then
ollama pull nomic-embed-text
ollama pull llama3.1:8b

cd rag-service
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # macOS/Linux: .venv/bin/python
cp .env.example .env          # then fill it in, per the split above

.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
```

Then give it something to be grounded in — with an empty corpus the assistant
truthfully answers that it has no material:

```bash
.venv/Scripts/python.exe scripts/ingest_file.py ./phonics.pdf \
    --title "Phonics Guide" --doc-type guide --profiles phonological
```

---

## Using it

**`/` — the screener (PS1).** Drag in a photo or a PDF of handwriting. Gemini
transcribes it and screens it for visible indicators (reversals, spacing, letter
sizing). A PDF may run to several pages; all of them are read. Uploads are capped at
8 MB, because the file is base64-encoded into the API request and the whole request
has to stay under the inline-data limit.

The verdict is not the model's own label. Gemini supplies the evidence — an
evidence-strength score and a list of indicators — and `lib/screening/verdict.js`
decides from it: `likely` needs a score of 55 or more, unless every indicator found is
a letter reversal and the writer is under seven, in which case the verdict is held at
`unlikely` and the reason is shown. Both thresholds are exported constants. This is a
transparent rule over LLM-extracted features, not a trained classifier.

**`/analysis` — the error pattern analyser (PS4).** Paste the student's writing exactly
as they wrote it, mistakes and all. Runs the local NLP pipeline and reports the error
profile. The first run loads the grammar-correction model, so give it a moment.

**`/dashboard` — the hub.** Where login lands. Links to the screener, the analyser and
the journey, shows the profile derived from your latest screening, and embeds the chat
assistant. The chat log is server-rendered from your stored messages, so it survives a
reload and matches the history the assistant is actually given. Every other page carries
a Dashboard link back.

**`/journey` — the learning journey (PS3).** Builds an ordered set of steps from your
derived profile and the uploaded resources, each step citing where it came from. Tick a
step off and the progress bar moves on both this page and the dashboard card.
Rebuilding archives the old journey rather than deleting it, so past progress survives.

The optional **writer's age** field is used only to judge whether letter reversals are
developmentally expected (common under about seven). It is passed to the screening
model and to the verdict rule.

### What the error analysis gives you

- A **profile**: phonological, surface/orthographic, morphological, visual, or mixed —
  with a confidence score and a breakdown of the evidence.
- **Where to focus teaching**, tied to that profile.
- **Every error found**, with what was written, what was meant, its category, and
  whether the misspelling still sounds like the target word.
- **Recurring patterns** (e.g. `missing "g"`, seen 4 times) and words misspelled more
  than once or spelled inconsistently.
- **Caveats** that fire automatically for short samples, transcribed text, high reversal
  counts, or uncertain reconstructions.

If a sample has fewer than four analysable errors, no profile is claimed at all.

---

## How the learning assistant works

The screening produces indicators; `lib/profile.js` turns those into a **dyslexia
profile** with a `phonological` / `surface` / `visual_spatial` emphasis, stored in
`learner_profiles`. That profile is what personalises both the chat and the journey —
retrieval is filtered by it, so a learner with a phonological emphasis is shown
phonological material first.

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
                          llama3.1:8b — "use ONLY these excerpts"
                                                ▼
                          {answer, citations} ─► rendered with a Sources: line
```

**Nothing is sent to a third party.** Both the embedding model and the generation model
run locally through Ollama. Gemini is used for PS1 vision only.

### Why it will not invent a source

Three guards, in order of how much they matter:

1. **No chunks, no model call.** If retrieval comes back empty, `compose_journey` and
   `answer_question` return a fixed "I don't have material on that" message without ever
   prompting the LLM. An empty corpus cannot produce a confident answer.
2. **Citations are resolved, not trusted.** The model returns `source_ids`; the service
   looks each one up in the chunks that were actually retrieved and drops any it cannot
   find. A hallucinated citation never reaches the UI.
3. **An empty journey is never saved.** If the service returns no steps, the route hands
   back the note and persists nothing, so a learner is never left with a blank board.

The failure mode this leaves is an unhelpful answer, not a confident wrong one. That is
the right way round for a tool used on children.

---

## How the NLP works (short version)

Full write-up: **[`docs/NLP_ARCHITECTURE.md`](docs/NLP_ARCHITECTURE.md)**

The hard question is not "is this word misspelled" but "*why*". Two misspellings that
look equally wrong come from opposite places:

| Written | Intended | Sounds like the target? | Category |
|---|---|---|---|
| `enuf` | enough | yes | Orthographic — sound processing intact, stored word form missing |
| `sret` | street | no, the /t/ is gone | Phonological — the sounds themselves broke |

That split is the dual-route distinction between a phonological and a surface profile.
Reproducing it mechanically needs the *pronunciation of a misspelling*, which is in no
dictionary, so the pipeline includes its own grapheme-to-phoneme rule engine.

```
text
  ├─ tokenise ─────────── sentences (context) + word tokens (offsets)
  ├─ word-boundary pass ─ "alot" → "a lot", "to gether" → "together"
  ├─ neural pass ──────── T5 grammar correction → intended wording
  ├─ lexicon pass ─────── Hunspell + phonetic search → intended word
  ├─ classify ─────────── phonology + morphology + edit alignment
  └─ aggregate ────────── rates, recurring patterns, profile
```

The **neural** and **lexicon** layers are complementary, not redundant. A dictionary can
only see words that do not exist, so it is structurally blind to `their` for `there`.
The seq2seq model reads the sentence and catches those. Conversely the model
paraphrases, so its proposals are filtered and re-scored against the lexicon's own.

### The open-source models

| | |
|---|---|
| Grammar correction | [`Xenova/t5-base-grammar-correction`](https://huggingface.co/Xenova/t5-base-grammar-correction) |
| Base | `vennify/t5-base-grammar-correction` — T5-base, Apache-2.0, trained on JFLEG |
| Runtime | `@huggingface/transformers` (Transformers.js), ONNX, `q8` quantisation |
| Embeddings (RAG) | `nomic-embed-text`, 768-dim, via Ollama |
| Generation (RAG) | `llama3.1:8b`, via Ollama |
| Where they run | Locally. **Nothing is sent to a third party.** |

We tested `Xenova/grammar-synthesis-small` first and rejected it — it hallucinates.
Given `The dof ran to the bark and the dall was reb.` it returns *"The dog was killed by
a car wreck."* In a diagnostic tool an invented rewrite becomes an invented error in a
child's report, so faithfulness beat model size.

Other open-source components: `nspell` + `dictionary-en` (Hunspell, MIT/BSD),
`cmu-pronouncing-dictionary` (ISC).

### Optional NLP configuration

| Variable | Default | Purpose |
|---|---|---|
| `NLP_GEC` | on | Set to `off` to disable the neural layer entirely |
| `NLP_GEC_MODEL` | `Xenova/t5-base-grammar-correction` | Checkpoint to load |
| `NLP_GEC_PREFIX` | `grammar: ` | Task prefix; set empty for grammar-synthesis models |
| `NLP_GEC_DTYPE` | `q8` | ONNX quantisation |

With `NLP_GEC=off` the app still runs on its lexicon and phonology layers, and says so
in the report.

---

## Tests

```bash
npm test                 # the whole JS suite
npm run test:unit        # tests/unit only
npm run test:integration # tests/integration only
npm run test:watch
```

```bash
cd rag-service
.venv/Scripts/python.exe -m pytest -q     # macOS/Linux: .venv/bin/python
```

Nothing reaches the network and no API key is needed — the vision model, the Supabase
service and the RAG service are all doubled at the boundary — so both suites run in
seconds.

Two conventions live side by side, and `vitest.config.mjs` picks up both so neither can
go quietly unrun:

- **Colocated** `*.test.js` beside the code it covers — `lib/`, `app/api/`, `app/login/`.
- **`tests/`** — one test per case in the team's test plan: sign-up and email
  confirmation, login and authentication, the screening route, and the integrated
  sequences. The learning-material use cases live with the code they test, in
  `rag-service/tests/`.

**[`tests/README.md`](tests/README.md)** maps every case in the test plan to the test
that covers it, states which rows have no implementation behind them yet (a mobile
number on sign-up, downloading a material file, a `studentRef` on a screening), and
lists what the suite deliberately does not cover.

Test doubles live in `tests/support/`: `supabase.js` models the auth surface and a write
log, `queryBuilder.js` models the chained read/write query builder the journey routes
lean on, `model.js` doubles the vision model, and `redirect.js` captures the redirects
server actions throw.

---

## Project layout

```
app/
  page.jsx                     PS1 screener: photo/PDF upload, verdict
  analysis/page.jsx            PS4 analyser: text input, error report
  dashboard/page.jsx           post-login hub: screener, journey, profile, assistant
  dashboard/ChatAssistant.jsx  client chat UI with citations and offline state
  journey/page.jsx             PS3 journey, server-rendered first paint
  journey/JourneyBoard.jsx     build, tick off steps, progress bar
  layout.jsx                   fonts, metadata
  globals.css                  design system (exercise-book motif)
  login/, signup/              auth pages and server actions
  components/
    PasswordField.jsx          password input with show/hide toggle
    ErrorAnalysis.jsx          renders the PS4 report
  api/
    analyze/route.js           PS1: photo/PDF → Gemini → screening → profile upsert
    analyze-text/route.js      PS4: text → error analysis
    chat/route.js              PS3: auth → profile + history → service → persist
    journey/route.js           PS3: GET the active journey, POST to build a new one
    journey/step/route.js      PS3: PATCH a step's status

lib/
  profile.js                   screening indicators → dyslexia profile emphasis
  ragService.js                server-only client for the Python service
  journey.js                   active-journey read + completion maths
  chat.js                      recent-message read + the two history limits
  screening/verdict.js         PS1 decision rule (score threshold + age guard)
  nlp/                         PS4 pipeline — see docs/NLP_ARCHITECTURE.md
    analyze, tokenize, gec, lexicon, g2p, phonemes,
    morphology, align, classify, taxonomy, persist
  supabase/                    browser + server Supabase clients

rag-service/                   Python FastAPI service (PS3)
  app/
    main.py                    /ingest, /chat, /journey
    config.py                  settings, read from rag-service/.env
    chunking.py                document → overlapping chunks
    embeddings.py              Ollama embedding client
    db.py                      Supabase adapter + pgvector search
    ingest.py                  ingestion pipeline
    retrieval.py               profile-filtered similarity search
    generation.py              grounded generation + citation resolution
  scripts/ingest_file.py       CLI to load a .txt/.pdf source
  tests/                       pytest suite

tests/
  README.md                    test plan → test traceability, and the gaps
  unit/                        one thing under test, its collaborators mocked
  integration/                 real collaborators, only the boundary doubled
  support/                     shared doubles (Supabase, query builder, model, redirect)

middleware.js                  session refresh + auth redirects
scripts/warm-nlp.mjs           model warm-up and smoke test
vitest.config.mjs              test runner configuration
supabase/*.sql                 database schema (screenings, error_analyses, RAG)
docs/NLP_ARCHITECTURE.md       full PS4 write-up
docs/PROJECT_BRIEF.md          course handout + problem statements
```

---

## Troubleshooting

**First analysis hangs or times out.** The model was not warmed. Run `npm run warm:nlp`.

**Report says "the contextual correction model was unavailable".** The weights could not
be fetched. The analysis still ran on the lexicon and phonology layers, but homophone
errors (their/there, to/too) were not detected. Check your network and re-run
`npm run warm:nlp`.

**"The learning assistant is offline."** The Next.js app could not reach the Python
service. Check that uvicorn is running on the port in `RAG_SERVICE_URL`, and that
`RAG_SERVICE_TOKEN` and `SERVICE_TOKEN` are identical — a mismatch returns 401, which
the UI also surfaces as an error.

**The assistant says it has no source material.** The corpus is empty, or nothing
cleared the similarity threshold. Ingest a document with `scripts/ingest_file.py`, or
lower `SIMILARITY_THRESHOLD`.

**"Run a writing screening first."** The journey is built from a derived profile, and
there is no screening on this account yet. Run one at `/`.

**The Python service starts but every call fails on Supabase.** Either `rag_schema.sql`
has not been applied, or `rag-service/.env` is missing and the service is running with
empty settings. It reads `.env` relative to the working directory — run uvicorn from
`rag-service/`.

**Build fails with `The "path" argument must be of type string`.** A package that reads
its own data files got bundled by webpack. Add it to
`experimental.serverComponentsExternalPackages` in `next.config.mjs`.

**"Too many confirmation emails have been sent."** Supabase's free-tier email quota.
Wait about an hour, or sign in with an account you already created.

**Signup succeeds but login says email not confirmed.** Either confirm via the emailed
link, or turn off email confirmation in Supabase → Authentication → Providers → Email.

---

## Known limitations

Stated plainly because they matter for interpreting output:

- **Reversal-heavy writing** (`dof` for `dog`) is only recoverable from context, and the
  correction model is inconsistent on it. This is the weakest area.
- **Dialect and non-rhotic spellings** are read literally — `pak` is a phonetically
  correct spelling of `pack`, not `park`.
- **One sample is one data point.** A profile describes a single writing sample, not a
  person. Several samples across occasions are needed before a pattern is real.
- **The assistant is only as good as what you ingest.** It cannot answer beyond the
  uploaded corpus, by design. That is a feature for safety and a limit on usefulness.
- **A screening carries no student reference.** Results attach to the signed-in
  educator, not to an identified learner, so they cannot yet be grouped per student.

---

## Still to do

- Per-student records, so screenings and journeys group by learner rather than by the
  signed-in educator
- Dashboard aggregating error trends across samples per learner (PS4 deliverable)
- Material **download** — ingestion discards the source file after chunking, so there is
  nothing to serve back (see `tests/README.md`, note 5)
- Frontend component tests (`PasswordField`, `ErrorAnalysis`), E2E (Cypress) and a
  fuzzer (`fast-check`)
- PDF export of a report for referral to an assessor
