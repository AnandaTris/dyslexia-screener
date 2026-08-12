# Test plan → tests

Traceability for the ESC Team 6 test plan. **This directory holds one test per case
in that document, and nothing else**: 12 table rows plus 4 sequence diagrams = 16
tests, of which 15 pass and 1 is skipped because the feature does not exist.

The repository has more tests than these. Suites colocated with their source
(`lib/`, `app/api/`, `app/login/`) cover code no row of the plan reaches — the NLP
pipeline, the verdict rule, the RAG integration.

**One exception to the one-to-one rule.** `tests/integration/it5-student-records.test.js`
is *not* a plan case. It sits here because it is a genuine integration test and there is
nowhere better for it, and because the regression it guards is the most consequential in
the project: before per-student records, screening a second student overwrote the first
student's profile. `npm run test:integration` therefore runs 5 files, not 4.

## Running them

```bash
npm test                  # unit + integration (224 tests) — no services, no database
npm run test:unit         # plan cases 1-12
npm run test:integration  # plan cases 13-16, plus it5
npm run test:watch
npm run test:e2e          # the two live suites — needs a database and running services
npm run test:all          # everything, e2e included
```

`npm test` deliberately **excludes** `e2e-*.test.js`. Those talk to the real Supabase
project and a running RAG service, so they fail on a laptop with neither — and a
permanently red default suite is one nobody reads. Run them explicitly with
`npm run test:e2e`.

```bash
cd rag-service
python3 -m venv .venv                            # once
source .venv/bin/activate                        # Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt        # once
python -m pytest -q                # 53 tests: 52 pass, 1 skipped
```

`tests/unit` mocks each collaborator, as the plan's Mock column specifies.
`tests/integration` wires the real collaborators together and doubles only the
outer boundary — the vision model, the Supabase service, the material repository —
so each test asserts the *sequence* of messages in its diagram and not just the
final answer. The integration strategy is **bottom-up, call-graph**: the leaf
collaborators are faked, everything above them is the real code.

Nothing reaches the network and no API key is needed, so both suites run in about a
second.

## Unit test cases

| # | Use case | Path | Input | Expected output | Test | Status |
|---|---|---|---|---|---|---|
| 1 | UC1 Sign Up | Happy | Valid email, password, mobile | Account created | `tests/unit/uc1-uc6-…` | ✅ mobile ignored — (1) |
| 2 | UC1 Sign Up | Error | Invalid email, password, mobile | Account cannot be created | same | ✅ invalid address only — (2) |
| 3 | UC6 Verify Email | Happy | Valid email | Verification result = true | same | ✅ — (3) |
| 4 | UC6 Verify Email | Error | Invalid email | Verification result = false | same | ✅ — (3) |
| 5 | UC2 Login / UC7 Auth | Happy | Valid email and password | Logs in to account | `tests/unit/uc2-uc7-…` | ✅ |
| 6 | UC2 Login / UC7 Auth | Error | Invalid or empty credentials | Unable to login | same | ✅ empty input |
| 7 | UC3 Predict / UC8 Model | Happy | Image attached | Prediction result | `tests/unit/uc3-uc8-…` | ✅ |
| 8 | UC3 Predict / UC8 Model | Error | No image attached | Alert to attach file | same | ✅ |
| 9 | UC5 Access Material | Happy | Search relevant material | List of available materials | `rag-service/tests/test_uc5_uc9_uc10_…` | ✅ — (4) |
| 10 | UC5 Access Material | Error | Search unrelated material | No material displayed | same | ✅ |
| 11 | UC9 Select Material | Happy | Select specific material | Display specific material | same | ✅ as citation selection |
| 12 | UC10 Download Material | Happy | Press download | Downloaded on device | same | ⏭️ **skipped, not implemented** — (5) |

## Integrated tests

| # | Test | Covered by | Status |
|---|---|---|---|
| 13 | 1 — Sign Up (AuthService → EmailVerificationService → UserRepository) | `tests/integration/it1-signup.test.js` | ✅ |
| 14 | 2 — Login (AuthService → UserRepository → compare passwords) | `tests/integration/it2-login.test.js` | ✅ — (6) |
| 15 | 3 — Prediction Service (→ SampleRepository → DyslexiaModel → PredictionRepository) | `tests/integration/it3-prediction-service.test.js` | ✅ — (7), (8) |
| 16 | 4 — Find and Download Material | `rag-service/tests/test_it4_find_and_download_material.py` | ⚠️ find ✅, download ❌ — (5) |

## Where the plan and the code disagree

Each of these is also flagged at the top of the test file it affects.

**(1) Sign-up does not collect a mobile number.** `app/signup/page.jsx` has email
and password fields only, and `signup()` never reads a `mobile` field. Case 1
submits one and asserts that it is ignored. *To close:* add the field, validate it,
store it in user metadata.

**(2) Case 2's Mock column names two errors** — "email already exists" and "email
is invalid" — and only the invalid-address path is tested, since the plan allots it
one row. The untested path is the more dangerous one: Supabase does not error on a
duplicate address, it succeeds and silently re-sends the confirmation mail, which is
how the project's email quota gets burned. `app/login/actions.js` detects it via an
empty `identities` array.

**(3) There is no EmailVerificationService in this repo.** Supabase Auth sends and
validates the confirmation mail. Cases 3 and 4 test the app's reaction to
verification state: with confirmation off the user is signed straight in, with it on
they are told to check their inbox.

**(4) MaterialService and MaterialRepository are the RAG service.** There is no
material feature in the Next.js app. `rag-service/app/db.py` is the repository
(`documents`, `document_chunks`); `retrieve()` and the citation builders in
`app/generation.py` are the service. Material is found by **similarity to a query**
filtered by learner profile — there is no `findById(id)` — and what comes back is
the matching **chunks** of a document, each carrying its `document_id`.

**(5) Download does not exist.** Ingestion extracts text, chunks it and stores
embeddings; the uploaded file is discarded. There is nothing to send to a device and
no download endpoint. *To close:* store the original file (Supabase Storage), add a
lookup by id to `Db`, add `GET /materials/{id}/file`.

**(6) Passwords are not compared by this application.** It holds no password
hashes, by design — Supabase Auth stores the credential and compares it. So "compare
Passwords" happens inside the AuthService double; what case 14 asserts is that the
repository was consulted and the stored password admitted the user.

**(7) There is no separate SampleRepository.** The screening route writes **one**
row to `screenings` after the model returns, holding the transcription and the
prediction together, so no `sampleId` is issued before the model call. Saving the
sample first would be better — a model failure currently loses the upload entirely.

**(8) ~~A screening carries no `studentRef`.~~ Closed.** A screening now carries
`student_id`, and `learner_profiles` is keyed on it, so results group per student.
Covered by `tests/integration/it5-student-records.test.js` and the four per-student
cases in `tests/unit/uc3-uc8-…`. The schema behind it lives in
`supabase/students.sql`.

## Not covered, deliberately

This directory is scoped to the plan's 16 cases. Anything outside them was kept out
of `tests/` to preserve the one-to-one mapping — but several gaps listed here have
since been closed by colocated suites elsewhere in the repo:

- ✅ **`lib/screening/verdict.js`** — now covered directly by
  `lib/screening/verdict.test.js`: the score threshold and the guard that holds a
  verdict at "unlikely" when a young writer's only indicators are letter reversals.
- ✅ **`lib/nlp/` (PS4)** — `analyze`, `classify`, `gec`, `lexicon` and `tokenize`
  now have colocated suites. The remaining six modules (`g2p`, `phonemes`,
  `morphology`, `align`, `taxonomy`, `persist`) are still exercised only through
  those five.
- ✅ **The error-analysis route** — `app/api/analyze-text/route.test.js`.
- ✅ **Auth server actions** — `app/login/actions.test.js`, beyond what cases 1-6
  require.

Still open, and worth knowing about before the final report, whose rubric asks for
boundary cases, negative cases, and both frontend and backend unit testing:

- **Frontend components** — `PasswordField`, `ErrorAnalysis`, `JourneyBoard` and
  `AddStudentForm` have no tests. A rendering bug in `ErrorAnalysis` is
  indistinguishable from a wrong analysis. This is the largest remaining gap, and it
  is blocked on a decision rather than on effort: `vitest.config.mjs` deliberately
  sets `environment: "node"` with the reasoning that "a jsdom global would only hide
  an accidental browser dependency". Component tests need `jsdom` plus
  `@testing-library/react`, neither of which is installed, and reversing that
  documented choice should be deliberate.
- ✅ **`middleware.js`** — now covered directly by `middleware.test.js`: anonymous
  requests redirected, API routes answered with JSON 401, and redirects built from
  `nextUrl.clone()` so a forged `Host` header cannot send the user off-site.
- **Error paths on the screening route** — oversized upload, unsupported file type,
  unparseable model response, repository failure. The anonymous caller and the
  missing/foreign `student_id` paths *are* now covered.

## Not in the plan at all

- **UC4 is missing from the document.** The tables jump UC3 → UC5.
- **The error pattern analyser has no test case.** `/api/analyze-text` and
  `lib/nlp/` are PS4, the largest subsystem in the project.
