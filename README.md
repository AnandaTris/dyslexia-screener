# DAS D.I.A.L. — Screener, Error Pattern Analyzer, Learning Assistant

A Next.js app for the DAS Individualised AI-Based Learning System, with a separate Python
service for the retrieval-augmented learning assistant. It covers three of the problem
statements:

- **PS1 — Learning Screening Engine.** Reads a photo of handwriting and flags
  surface-level indicators associated with dyslexia (Gemini vision).
- **PS4 — Error Pattern Analyzer.** Runs an NLP pipeline over the writing, categorises
  every spelling error as phonological / orthographic / morphological / visual, and
  describes which error *pattern* the sample fits. Analyses file against a learner, so the
  student page and the dashboard chart how that pattern moves across samples.
- **PS3 — Adaptive learning, in part.** A grounded chat assistant and a step-by-step
  **learning journey**, both built from the learner's derived profile and drawn only from
  resources you have uploaded. Every answer and every step cites its source.

> **This is a screening aid, not a diagnostic tool.** Dyslexia and its profiles can only
> be identified through a full psychoeducational assessment by a qualified professional.
> The app states this in the UI, in the model prompt, and in every generated report.

### The other docs

| Doc | For |
|---|---|
| **[`WORKFLOW.md`](WORKFLOW.md)** | Setup, running, tests, commits, troubleshooting |
| **[`RAG_ORCHESTRATION.md`](RAG_ORCHESTRATION.md)** | How the learning assistant works internally |
| **[`docs/NLP_ARCHITECTURE.md`](docs/NLP_ARCHITECTURE.md)** | The full PS4 pipeline write-up |
| **[`tests/README.md`](tests/README.md)** | Test plan → test traceability, and the gaps |

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

**The web app never holds a service-role key.** It talks to Supabase with the public anon
key, so row-level security is what protects a learner's data. Only the Python service
holds the service-role key, and only it writes the document corpus — which is why the RAG
tables are RLS deny-all: your public anon key cannot poison the corpus.

**Nothing is sent to a third party** by the assistant. Both the embedding model and the
generation model run locally through Ollama. Gemini is used for PS1 vision only.

## Quick start

```bash
npm install
cp .env.example .env                            # root: read by Next.js
cp rag-service/.env.example rag-service/.env    # read by the Python service only
npm run warm:nlp               # one-time, ~1 min: downloads and caches the NLP model
npm run dev:all
```

Fill in **both** env files before starting; they deliberately hold different keys. One
value in them is yours to invent rather than to look up — the service token that lets the
web app talk to the Python service. Generate it with `openssl rand -hex 32` and write the
same string into `RAG_SERVICE_TOKEN` (root) and `SERVICE_TOKEN` (`rag-service/`). It only
has to match between those two files on the machine running them, so every machine can
hold its own. [What it is for](WORKFLOW.md#the-service-token).

Apply the database schema and open <http://localhost:3000>. The chat and journey pages
will say the assistant is offline until you also run the Python service — everything else
works. **Full instructions: [`WORKFLOW.md`](WORKFLOW.md).**

To use the assistant you also need Ollama running, the Python environment built, and a
corpus ingested. A starter corpus ships in
[`rag-service/corpus/`](rag-service/corpus); load it once:

```bash
# macOS: brew install ollama && brew services start ollama
# Windows, Linux: installer from https://ollama.com
ollama pull nomic-embed-text
ollama pull llama3.2:3b        # must match GENERATION_MODEL in rag-service/.env — see below

cd rag-service
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt

python scripts/ingest_file.py corpus/understanding-your-results.txt \
    --title "Understanding your screening results" --doc-type guide
python scripts/ingest_file.py corpus/surface-pattern.txt \
    --title "The surface pattern" --doc-type guide --profiles surface
# ...and the phonological and visual-spatial files, tagged to match
```

> **Set `GENERATION_MODEL` explicitly.** `rag-service/app/config.py` defaults to
> `llama3.1:8b`. Pulling `llama3.2:3b` and leaving that line unset asks Ollama for weights
> the machine does not have, and *every* answer fails — while the screener and analyser keep
> working, so it reads as "the assistant is broken" rather than a config error. Whatever you
> pull, write the same string into `rag-service/.env`. Sizing guidance and the
> `ollama ps` check are in [`WORKFLOW.md`](WORKFLOW.md#5-the-learning-assistant-optional).

Ingestion is **not idempotent** — running it twice duplicates the document and skews
retrieval. Delete the `documents` row before re-ingesting a revised file.

---

## Using it

**`/students` — your caseload.** Add a student with a name and, optionally, a year of
birth. Each student keeps their own screening history, derived profile and learning
journey. `/students/[id]` is that student's page.

A student is identified by which URL you are on, not by a hidden "current student"
selector. That is deliberate: filing a screening against the wrong child is the worst
mistake this app can make, and a cookie-held selection goes stale in a second tab.

The student page also carries that learner's **error trend** across every writing sample
filed against them — one sentence of finding, then the two charts behind it. See
[*Error trends across samples*](#error-trends-across-samples-ps4-dashboard).

The year of birth is used only to prefill the writer's age on the screener, which drives
the under-seven reversal guard described below.

**`/` — the screener (PS1).** Pick the student, then drag in a photo or a PDF of handwriting. Gemini transcribes
it and screens it for visible indicators (reversals, spacing, letter sizing). A PDF may
run to several pages; all of them are read. Uploads are capped at 8 MB, because the file
is base64-encoded into the API request and the whole request has to stay under the
inline-data limit.

The result is not the model's own label. Gemini supplies an evidence-strength score
and a list of concrete indicators, and `lib/screening/verdict.js` applies the visible
decision rule. The UI reports one of three outcomes: **further assessment
recommended**, **indicators found — continue screening**, or **no clear indicators
found in this sample**. The compatibility verdict stored in the database still uses
`likely` / `unlikely`; a score of 55 is its assessment threshold, while explicit
under-seven, reversal-only evidence is held below that recommendation. A model score
without any indicators is treated as zero. This is a transparent rule over
LLM-extracted features, not a trained or clinically validated classifier.

**`/analysis` — the error pattern analyser (PS4).** Paste the student's writing exactly as
they wrote it, mistakes and all. Runs the local NLP pipeline and reports the error
profile. The first run loads the grammar-correction model, so give it a moment.

**`/dashboard` — the hub.** Where login lands. Links to the screener, the analyser and the
journey, shows the profile derived from your latest screening, and embeds the chat
assistant. The chat log is server-rendered from your stored messages, so it survives a
reload and matches the history the assistant is actually given. Every other page carries a
Dashboard link back.

It also carries the **caseload roll-up**: one row per student with a sparkline of their
error density and a direction pill. Learners whose error density is rising sort to the
top, because the point of a caseload view is to surface who to look at next.

**`/journey` — the learning journey (PS3).** Builds an ordered set of steps from your
derived profile and the uploaded resources, each step citing where it came from. Tick a
step off and the progress bar moves on both this page and the dashboard card. Rebuilding
archives the old journey rather than deleting it, so past progress survives.

The optional **writer's age** field is used only to judge whether reversal-only
evidence is developmentally expected (common under about seven). It is passed to the
screening model and to the verdict rule. If the field is blank, the selected student's
year of birth is used when available; otherwise the model is told not to infer age from
the handwriting, filename, or document itself.

### What the error analysis gives you

- A **profile**: phonological, surface/orthographic, morphological, visual, or mixed —
  with a confidence score and a breakdown of the evidence.
- **Where to focus teaching**, tied to that profile.
- **Every error found**, with what was written, what was meant, its category, and whether
  the misspelling still sounds like the target word.
- **Recurring patterns** (e.g. `missing "g"`, seen 4 times) and words misspelled more than
  once or spelled inconsistently.
- **Caveats** that fire automatically for short samples, transcribed text, high reversal
  counts, or uncertain reconstructions.

If a sample has fewer than four analysable errors, no profile is claimed at all.

### Error trends across samples (PS4 dashboard)

One analysis describes one sample. The PS4 deliverable asks what is happening *across*
samples, which is a different question and needs its own arithmetic — that lives in
`lib/trends.js`, as pure functions over stored rows, so the claims it makes are testable
without a database.

Two measurements, deliberately kept apart:

- **Volume — errors per 100 words, never a raw count.** A 300-word sample with 15 errors is
  cleaner writing than a 60-word sample with 10, and the raw counts say the opposite. Drawn
  as a line chart.
- **Mix — each category's *share* of that sample's errors.** PS4 asks which kind of error
  dominates and whether that is shifting; a share answers it at any sample length. Drawn as
  a stacked band.

A falling error rate and a shifting mix are different findings, and merging them into one
"score" would hide the useful half. Shares are taken against the *categorised* errors
summed from `category_counts`, not against `error_count` — the two disagree, because
`error_count` includes errors that carry no category, and a share against the larger number
could never reach 100% even when one category accounts for everything.

**Three samples are required before any direction is named.** Two points always make a
line, and that line always slopes somewhere; calling a direction from it would manufacture
a finding out of ordinary between-sample variation — the same mistake the analyser already
refuses to make when it withholds a profile below four errors. Below three samples the
charts still draw; only the claim is withheld. A share must also move more than 8 points,
and the rate more than 1.5 per 100 words, before the movement is called anything but flat.

The headline sentence describes **the writing, never the writer**, and avoids the language
of improvement or deterioration: "error density fell from 12.4 to 8.1 per 100 words" is an
observation about samples; "getting better" is a claim about a child that one page of text
cannot support. The wording is built in `lib/trends.js` rather than in the component, so it
can be tested.

Charts are hand-rolled SVG — no charting dependency. The queries select only the lifted
columns (`TREND_COLUMNS`), never the `result` blob that holds the full analysis, so drawing
a dozen-point chart does not move megabytes.

> Analyses recorded before `supabase/error_analyses_student.sql` was applied have no
> `student_id` and are deliberately **not** backfilled — nothing in an old row identifies
> which learner wrote it, and guessing would put one child's errors on another child's
> trend line. Those rows simply do not appear in any trend.

---

## The learning assistant

Full detail: **[`RAG_ORCHESTRATION.md`](RAG_ORCHESTRATION.md)**

The screening produces indicators; `lib/profile.js` turns those into a **dyslexia
profile** with a `phonological` / `surface` / `visual_spatial` emphasis, stored in
`learner_profiles`. That profile is what personalises both the chat and the journey —
retrieval is filtered by it, so a learner with a phonological emphasis is shown
phonological material first.

A question is embedded locally, matched against the ingested corpus by cosine similarity
in pgvector, and only chunks above the similarity threshold are handed to the local LLM
with an instruction to use nothing else. Three guards stop it inventing a source: **no
chunks means no model call at all**, citations are **resolved against the retrieved chunks
rather than trusted**, and an empty journey is never saved. The threshold that guard 1
rests on was measured, not guessed — the numbers are in the orchestration doc.

**The assistant is only as good as what you ingest.** It cannot answer beyond the uploaded
corpus, by design. That is a feature for safety and a limit on usefulness.

### The starter corpus

[`rag-service/corpus/`](rag-service/corpus) holds four learner-facing guides, and every
claim in them is derived from this repo's own `lib/nlp/taxonomy.js` and `lib/profile.js`
rather than from a model's general knowledge — so the assistant's answers stay consistent
with what the analyser tells the same user, and each claim can be checked against a file.

| File | Tagged for | Reaches |
|---|---|---|
| `understanding-your-results.txt` | *(untagged)* | every learner |
| `phonological-pattern.txt` | `phonological` | phonological emphasis |
| `surface-pattern.txt` | `surface` | surface emphasis |
| `visual-spatial-pattern.txt` | `visual_spatial` | visual-spatial emphasis |

An untagged document is eligible for everyone — `match_document_chunks` admits any
document whose `target_profiles` is empty. That is deliberately how the general material
stays reachable no matter which emphasis a learner has.

Tags must match what `lib/profile.js` actually emits (`phonological`, `surface`,
`visual_spatial`). `taxonomy.js` also names `visual` and `morphological`, but the profile
deriver never returns those, so a document tagged with one would match no learner — and it
would fail **silently**, retrieving nothing with no error anywhere. Morphology content
therefore lives in the untagged file.

## How the NLP works (short version)

Full write-up: **[`docs/NLP_ARCHITECTURE.md`](docs/NLP_ARCHITECTURE.md)**

The hard question is not "is this word misspelled" but "*why*". Two misspellings that look
equally wrong come from opposite places:

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
only see words that do not exist, so it is structurally blind to `their` for `there`. The
seq2seq model reads the sentence and catches those. Conversely the model paraphrases, so
its proposals are filtered and re-scored against the lexicon's own.

### The open-source models

| | |
|---|---|
| Grammar correction | [`Xenova/t5-base-grammar-correction`](https://huggingface.co/Xenova/t5-base-grammar-correction) |
| Base | `vennify/t5-base-grammar-correction` — T5-base, Apache-2.0, trained on JFLEG |
| Runtime | `@huggingface/transformers` (Transformers.js), ONNX, `q8` quantisation |
| Embeddings (RAG) | `nomic-embed-text`, 768-dim, via Ollama |
| Generation (RAG) | `llama3.2:3b`, via Ollama — see the orchestration doc on sizing |
| Where they run | Locally. **Nothing is sent to a third party.** |

We tested `Xenova/grammar-synthesis-small` first and rejected it — it hallucinates. Given
`The dof ran to the bark and the dall was reb.` it returns *"The dog was killed by a car
wreck."* In a diagnostic tool an invented rewrite becomes an invented error in a child's
report, so faithfulness beat model size.

Other open-source components: `nspell` + `dictionary-en` (Hunspell, MIT/BSD),
`cmu-pronouncing-dictionary` (ISC).

### Optional NLP configuration

| Variable | Default | Purpose |
|---|---|---|
| `NLP_GEC` | on | Set to `off` to disable the neural layer entirely |
| `NLP_GEC_MODEL` | `Xenova/t5-base-grammar-correction` | Checkpoint to load |
| `NLP_GEC_PREFIX` | `grammar: ` | Task prefix; set empty for grammar-synthesis models |
| `NLP_GEC_DTYPE` | `q8` | ONNX quantisation |

With `NLP_GEC=off` the app still runs on its lexicon and phonology layers, and says so in
the report.

---

## Project layout

```
app/
  page.jsx                     PS1 screener: photo/PDF upload, verdict
  analysis/page.jsx            PS4 analyser: text input, error report
  dashboard/page.jsx           post-login hub: screener, journey, profile, assistant,
                               caseload error-trend roll-up
  dashboard/ChatAssistant.jsx  client chat UI with citations and offline state
  students/page.jsx            caseload list + add-student form
  students/[id]/page.jsx       one student: profile, screenings, journey, error trend
  students/actions.js          createStudent server action
  journey/page.jsx             redirects to /students
  journey/JourneyBoard.jsx     build, tick off steps, progress bar (per student)
  layout.jsx                   fonts, metadata
  globals.css                  design system (exercise-book motif)
  login/, signup/              auth pages and server actions
  components/
    PasswordField.jsx          password input with show/hide toggle
    ErrorAnalysis.jsx          renders the PS4 report
    ErrorTrend.jsx             per-student trend: headline, charts, direction pill
    TrendCharts.jsx            hand-rolled SVG: MixBand, RateLine, Sparkline
  api/
    analyze/route.js           PS1: photo/PDF → Gemini → screening → profile upsert
    analyze-text/route.js      PS4: text → error analysis
    chat/route.js              PS3: auth → profile + history → service → persist
    journey/route.js           PS3: GET the active journey, POST to build a new one
    journey/step/route.js      PS3: PATCH a step's status

lib/
  students.js                  therapist-scoped student reads + age from birth year
  profile.js                   screening indicators → dyslexia profile emphasis
  ragService.js                server-only client for the Python service
  journey.js                   active-journey read + completion maths
  chat.js                      recent-message read + the two history limits
  trends.js                    stored analyses → per-student and caseload trends
  rateLimit.js                 in-process fixed-window limiter for the LLM endpoints
  screening/verdict.js         PS1 decision rule (score threshold + age guard)
  nlp/                         PS4 pipeline — see docs/NLP_ARCHITECTURE.md
    analyze, tokenize, gec, lexicon, g2p, phonemes,
    morphology, align, classify, taxonomy, persist
  supabase/                    browser + server Supabase clients

rag-service/                   Python FastAPI service (PS3) — see RAG_ORCHESTRATION.md
  app/
    main.py                    /health, /ingest, /chat, /journey
    config.py                  settings, read from rag-service/.env
    chunking.py                document → overlapping chunks
    embeddings.py              Ollama embedding client
    db.py                      Supabase adapter + pgvector search
    ingest.py                  ingestion pipeline
    retrieval.py               profile-filtered similarity search
    generation.py              grounded generation + citation resolution
  corpus/                      starter corpus, derived from lib/nlp/taxonomy.js
  scripts/ingest_file.py       CLI to load a .txt/.pdf source
  scripts/check_schema.py      reports which parts of rag_schema.sql are live
  tests/                       pytest suite

tests/
  README.md                    test plan → test traceability, and the gaps
  unit/                        one thing under test, its collaborators mocked
  integration/                 real collaborators, only the boundary doubled
  support/                     shared doubles (Supabase, query builder, model, redirect)

fuzz/
  properties.fuzz.js           fast-check robustness properties (six pure targets)

middleware.js                  session refresh + auth redirects
scripts/run-fuzz.mjs           duration/run-count CLI and exact failure replay
scripts/warm-nlp.mjs           model warm-up and smoke test
scripts/venv-python.mjs        resolves the rag-service venv interpreter per OS
vitest.config.mjs              test runner configuration
vitest.fuzz.config.mjs         isolated single-worker configuration for long fuzz runs
supabase/*.sql                 database schema — six files, applied in a fixed order;
                               the table is in WORKFLOW.md, "Database"
docs/NLP_ARCHITECTURE.md       full PS4 write-up
docs/PROJECT_BRIEF.md          course handout + problem statements
```

---

## Fuzzing and robustness testing

The robustness fuzzer uses `fast-check` against six pure seams where malformed or unusual
input can silently corrupt a screening result: token offsets and statistics, character edit
scripts, token edit scripts, the phoneme distance metric, the screening verdict rule, and
stored trend aggregation. It never calls Gemini, Supabase, Ollama, or the network, so a long
campaign cannot spend quota or alter student data.

```bash
npm run fuzz:smoke                       # 500 generated cases per target
npm run fuzz                            # one-minute wall-clock campaign
npm run fuzz -- --duration 10m          # custom wall-clock budget
npm run fuzz:24h                         # rubric target: 24 hours total
npm run fuzz -- --target token-alignment --runs 10000
```

A duration is a total budget and is divided evenly across the selected targets. Failing
properties print a copy-paste replay command containing the target, seed and shrink path:

```bash
npm run fuzz -- --target character-alignment --seed 123 --path "0:1:2"
```

The fuzz suite has its own Vitest configuration and is not picked up by `npm test`. For a
long unattended run, redirect output into the ignored `fuzz-results/` directory so the seed
and counterexample survive a closed terminal.

---

## Security

This app holds children's writing samples and an educator's account, so the trust model is
worth stating explicitly rather than leaving implied.

### What protects the data

**Row-level security is the boundary, not the app code.** Every table — `screenings`,
`error_analyses`, `learner_profiles`, `journeys`, `journey_steps`, `chat_messages` — has
RLS enabled with an `auth.uid() = user_id` policy. The web app only ever holds the public
anon key, so a bug in a route handler cannot read another educator's rows; Postgres
refuses. `journey_steps` is policed through its parent journey, which is why
`PATCH /api/journey/step` does no ownership check of its own: a step id belonging to
someone else matches no row and comes back as a 404.

**The service-role key is isolated.** It bypasses RLS entirely and lives only in
`rag-service/.env`. It is never loaded into the Next.js process. The two RAG store tables
(`documents`, `document_chunks`) have RLS on with *no* policies at all — deny-all — so only
the Python service can read or write the corpus, and the anon key cannot poison it.

**Defence in depth on auth.** `middleware.js` is the single gate, but every API route
independently re-checks `getUser()` rather than trusting it. Middleware redirects are built
from `request.nextUrl.clone()`, so a forged `Host` header cannot turn the login redirect
into an off-site one. API routes under `/api/` get a JSON 401 instead of an HTML login
page, so a client calling `res.json()` sees the real reason.

**Other verified properties.** No secret has ever been committed — `.env` and
`rag-service/.env` have never been tracked, and no key-shaped string exists in any tracked
file. All database access goes through Supabase's query builder, so there is no
string-concatenated SQL anywhere. There is no `dangerouslySetInnerHTML`, `innerHTML` or
`eval` in the codebase, so React's escaping is intact. The service token is compared with
`hmac.compare_digest` (timing-safe) and fails closed when unset.

**Input is bounded at every entry point.** Uploads are whitelisted by type and capped at
8 MB, `/api/analyze-text` caps a sample at 20,000 characters, and `/api/chat` caps a
question at 2,000 — a question is not a writing sample, and the cap is what stops an
unbounded string being forwarded to the model and stored.

**The two expensive endpoints are rate-limited.** `lib/rateLimit.js` allows `/api/chat`
10 calls per minute and `/api/journey` 5 per five minutes, keyed per user. Both hand work
to a local CPU-bound model that occupies the machine for tens of seconds, so the budget
that matters is how often an account may *start* one, not how many bytes it sends. The
limiter is in-process and in-memory on purpose: what it protects is one machine's CPU, and
the app runs as a single Next.js server beside a single uvicorn worker.

**Security headers are set** in `next.config.mjs` for every path: a Content-Security-Policy,
`X-Frame-Options: DENY` and `frame-ancestors` (the authenticated dashboard is no longer
framable), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
so a student id in a path never leaves in a `Referer`, and `Permissions-Policy` denying
camera, microphone and geolocation. HSTS is added outside dev only.

**Errors are not echoed back.** `/api/analyze` no longer returns `err.message` or raw model
output to the client; unexpected throws are logged server-side and answered generically.

### Known gaps

Recorded honestly — these are real and currently unmitigated. The
[pre-deploy checklist](WORKFLOW.md#pre-deploy-checklist) tracks them as actions.

| Gap | Impact |
|---|---|
| **Account enumeration on signup** | Signing up an existing address is answered with "that email is already registered". Deliberate — it saves the free-tier email quota — but it is an existence oracle. |
| **Upload MIME type is client-supplied** | `/api/analyze` trusts `upload.type` with no magic-byte check. Impact is limited: the bytes are forwarded to Gemini, not parsed locally. |
| **Rate limit counters are per-instance** | `lib/rateLimit.js` holds a `Map` in one process. Counters reset on restart (acceptable — a restart also clears the work the limit protects), but behind more than one instance the real limit is the per-instance one times the instance count. That is the point at which it needs shared state (Redis) rather than a Map. |

### Dependencies

**Next has been upgraded to 15.5.x**, which closes the 21 advisories that previously
mattered most here — DoS and SSRF in Server Actions, unauthenticated disclosure of internal
Server Function endpoints, and cache-poisonable middleware redirects. This app uses Server
Actions for auth and relies on middleware for its auth boundary, so those were reachable.

`npm audit` now reports 12 vulnerabilities (1 critical, 8 high, 3 moderate). Triaged:

- **`vitest` (critical) and `@vitest/mocker`/`vite`/`esbuild`/`vite-node` are dev-only.**
  The critical requires the Vitest **UI server** to be listening; this project never runs
  `vitest --ui`, and none of it ships. Fixed by vitest 4.x, a major upgrade.
- **`next` and `postcss` (high)** now want `next@16`, another major. Nothing in the
  remaining Next advisories is in the class the 15.x upgrade closed; re-triage before
  taking a second major.
- **`sharp`/`libvips`, `adm-zip`, `onnxruntime-node`, `@huggingface/transformers` (high)
  have no fix available.** They arrive under the local NLP model and are not on the
  user-upload path — screening images are base64-encoded straight to Gemini and never
  handed to sharp; the zip and runtime paths are reached only when loading model weights.
- **`nanoid` (high) is fixable in place** — `npm audit fix`, no major required.

Run `npm audit` before any deployment; do not treat the raw count as the risk.

---

## Known limitations

Stated plainly because they matter for interpreting output:

- **Reversal-heavy writing** (`dof` for `dog`) is only recoverable from context, and the
  correction model is inconsistent on it. This is the weakest area.
- **Dialect and non-rhotic spellings** are read literally — `pak` is a phonetically correct
  spelling of `pack`, not `park`.
- **One sample is one data point.** A profile describes a single writing sample, not a
  person. Several samples across occasions are needed before a pattern is real.
- **The assistant is only as good as what you ingest.** It cannot answer beyond the
  uploaded corpus, by design. The starter corpus is deliberately narrow — it explains the
  screener's own error categories and the practice that suits each pattern, and nothing
  else. Ask it something outside that and it will correctly say it has no material.
- **Answers are slow on CPU-only hardware.** Grounded answers feed the retrieved excerpts
  into the local model, so they cost far more than an ungrounded one: measured 16–20 s
  warm, 118 s on the first call after Ollama starts. `/journey` measured 72–122 s. The
  client budget is 300 s (`DEFAULT_TIMEOUT_MS`), raised from 120 s after a live run timed
  out at 120.3 s on a request that had actually succeeded. There is no streaming, so the
  UI is silent for the whole wait.
- **The assistant is not per-student.** Screenings, profiles and journeys belong to a
  student, but the chat panel on `/dashboard` is still therapist-level — one conversation
  for the whole caseload, not one per student.

## Still to do

- Deleting or archiving a student — there is deliberately no delete UI, because removing a
  student cascades away their screenings and journey
- Per-student chat. `error_analyses` now carries a `student_id`, so the analyser files
  against a learner the way screenings do, but the chat panel is still therapist-level
- Material **download** — ingestion discards the source file after chunking, so there is
  nothing to serve back (see `tests/README.md`, note 5)
- Frontend component tests (`PasswordField`, `ErrorAnalysis`, `ErrorTrend`, `TrendCharts` —
  the trend arithmetic in `lib/trends.js` is covered, the SVG that draws it is not). The `fast-check` robustness
  fuzzer is implemented under `fuzz/` and can run as a bounded smoke test or a 24-hour campaign.
  A live end-to-end harness already exists — `e2e-live.test.js` drives the real
  `lib/ragService.js` against a running service and covers the grounded answer, the
  journey, and the bad-token / unreachable / timeout / missing-config paths (6 tests). It
  needs `E2E_SERVICE_TOKEN` set, or every authenticated call returns 401. What is still
  missing is *browser* E2E
- PDF export of a report for referral to an assessor
- **Security work.** The five items previously listed here — the Next upgrade, rate limiting
  the two LLM endpoints, capping the chat question length, security headers, and raw
  `err.message` reaching the client — have all landed. What remains is in
  *Security → Known gaps*: magic-byte checking on uploads, the signup existence oracle
  (deliberate), and the shared-state rewrite `lib/rateLimit.js` needs if this ever runs as
  more than one instance. The
  [pre-deploy checklist](WORKFLOW.md#pre-deploy-checklist) tracks them.
