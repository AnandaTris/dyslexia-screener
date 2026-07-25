# DAS D.I.A.L. — Writing Sample Screener + Error Pattern Analyzer

A Next.js app for the DAS Individualised AI-Based Learning System. It covers two of
our three problem statements:

- **PS1 — Learning Screening Engine.** Reads a photo of handwriting and flags
  surface-level indicators associated with dyslexia (Gemini vision).
- **PS4 — Error Pattern Analyzer.** Runs an NLP pipeline over the writing, categorises
  every spelling error as phonological / orthographic / morphological / visual, and
  describes which error *pattern* the sample fits.

> **This is a screening aid, not a diagnostic tool.** Dyslexia and its profiles can only
> be identified through a full psychoeducational assessment by a qualified professional.
> The app states this in the UI, in the model prompt, and in every generated report.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill in your keys
npm run warm:nlp               # one-time, ~1 min: downloads and caches the NLP model
npm run dev
```

Then apply the database schema (below) and open <http://localhost:3000>.

### 1. Dependencies

```bash
npm install
```

### 2. Environment variables

Create `.env.local` in the project root (copy `.env.example`):

```
GEMINI_API_KEY=your_key_here
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
```

`GEMINI_API_KEY` is server-only and never reaches the browser. The two Supabase values
are public by design — row-level security is what protects the data, not secrecy of the
anon key.

### 3. Database

In the Supabase dashboard → **SQL Editor** → **New query**, run both files in order:

1. `supabase/schema.sql` — the `screenings` table (PS1)
2. `supabase/error_analyses.sql` — the `error_analyses` table (PS4)

Both enable row-level security so a user can only ever read their own rows.

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

Create an account at `/signup`, then screen a sample at `/` or analyse typed text at `/analysis`.

---

## Using it

The app has two pages, one per problem statement.

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

### The open-source model

| | |
|---|---|
| Model | [`Xenova/t5-base-grammar-correction`](https://huggingface.co/Xenova/t5-base-grammar-correction) |
| Base | `vennify/t5-base-grammar-correction` — T5-base, Apache-2.0, trained on JFLEG |
| Runtime | `@huggingface/transformers` (Transformers.js), ONNX, `q8` quantisation |
| Where it runs | Locally, in the Node process. **Nothing is sent to a third party.** |

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

## Project layout

```
app/
  page.jsx                     PS1 screener: photo/PDF upload, verdict
  analysis/page.jsx            PS4 analyser: text input, error report
  layout.jsx                   fonts, metadata
  globals.css                  design system (exercise-book motif)
  login/page.jsx               sign in
  login/actions.js             server actions: login, signup, signout
  signup/page.jsx              create account
  components/
    PasswordField.jsx          password input with show/hide toggle
    ErrorAnalysis.jsx          renders the PS4 report
  api/
    analyze/route.js           PS1: photo/PDF → Gemini → screening
    analyze-text/route.js      PS4: text → error analysis

lib/
  screening/
    verdict.js                 PS1 decision rule (score threshold + age guard)

  nlp/
    analyze.js                 pipeline orchestrator
    tokenize.js                sentence + word tokenisation with offsets
    gec.js                     neural grammar correction (Transformers.js)
    lexicon.js                 Hunspell + phonetic target reconstruction
    g2p.js                     grapheme-to-phoneme (CMU + rule engine)
    phonemes.js                ARPAbet features + weighted phoneme distance
    morphology.js              stem/affix decomposition, junction rules
    align.js                   Damerau-Levenshtein character + token alignment
    classify.js                one error pair → taxonomy category
    taxonomy.js                categories, profiles, weights, thresholds
    persist.js                 storage helper
  supabase/                    browser + server Supabase clients

middleware.js                  session refresh + auth redirects
scripts/warm-nlp.mjs           model warm-up and smoke test
supabase/*.sql                 database schema
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

---

## Still to do

- Dashboard aggregating error trends across samples per learner (PS4 deliverable)
- Unit + integration tests (Jest), E2E (Cypress), and a fuzzer (`fast-check`)
- PS3 — Adaptive Learning Activity Generator, fed by the profile this subsystem produces
- PDF export of a report for referral to an assessor
