# Test Plan — DAS D.I.A.L. (Team 6)

**Written:** 2026-08-13 · **Branch:** `jer`

Cases are in table form, as the rubric requires (`docs/PROJECT_BRIEF.md:137-142`), and every
row names a test that exists. Cases 1–16 are the original plan, kept at their numbers.
Cases 17 onward are new and cover the work built since: student accounts, the error pattern
analyser (PS4), and the learning journey (PS3).

Traceability to use cases is in [`USE_CASES.md`](USE_CASES.md); to workflows in
[`SEQUENCE_DIAGRAMS.md`](SEQUENCE_DIAGRAMS.md).

---

## 1. Measured status

Both suites were executed on **2026-08-13** on this branch. These are run results, not estimates.

| Suite | Command | Result | Wall clock |
|---|---|---|---|
| JS unit + integration | `npm test` | **36 files, 279 tests, 279 passed** | 6.02 s |
| Python RAG service | `.venv/Scripts/python.exe -m pytest -q` | **53 tests, 52 passed, 1 skipped** | 0.30 s |
| JS end-to-end | `npm run test:e2e` | **not executed** — needs a live database and running services | — |

> `tests/README.md:20` still cites 224 JS tests. That figure is stale; the measured count
> today is 279.

The one skipped Python test is case 12 (UC10 Download Material), skipped because the
feature does not exist. It is a deliberate marker, not a broken test.

---

## 2. Tools

| Layer | Tool | Why |
|---|---|---|
| JS unit + integration | **Vitest 2.1.9** | Native ESM, no transpile step for a Next.js 14 codebase. |
| Python unit + endpoint | **pytest 9** + `fastapi.testclient` | Exercises the real FastAPI app without a network listener. |
| JS end-to-end | **Vitest against live Supabase** | `e2e-*.test.js`, excluded from `npm test` by design. |
| System / UI | **Cypress** — *not yet installed* | Encouraged by the rubric. See §8. |
| Robustness | **fast-check** (JS) + **Hypothesis** (Python) — *not yet installed* | Required by the final presentation. See §7. |

`vitest.config.mjs` sets `environment: "node"` deliberately — a jsdom global would hide an
accidental browser dependency in server code. The consequence is that React components
cannot currently be unit-tested; that trade-off is revisited in §8.

### Running them

```bash
npm test                  # unit + integration, no services, no database   (279 tests)
npm run test:unit         # plan cases 1-12
npm run test:integration  # plan cases 13-16, plus it5
npm run test:e2e          # live suites — database and RAG service required
npm run test:all          # everything

cd rag-service && .venv/Scripts/python.exe -m pytest -q    # 53 tests
```

`npm test` excludes `e2e-*.test.js` on purpose: those talk to the real Supabase project and
a running RAG service, so they fail on a laptop with neither, and a permanently red default
suite is one nobody reads.

---

## 3. Strategy

**Unit.** Each collaborator is mocked. `tests/unit/` holds the plan's cases; colocated
`*.test.js` files sit beside the module they cover.

**Integration — bottom-up, call graph.** The leaf collaborators are faked (the vision model,
the Supabase service, the material repository); everything above them is the real code. Each
integration test asserts the **sequence of messages** in its sequence diagram, not just the
final answer. Nothing reaches the network, so both suites run in about a second.

**End-to-end.** Real Supabase project, real signed-in sessions, real HTTP to the RAG service.

**Robustness.** Property-based fuzzing of the pure functions in the pipeline — planned, §7.

---

## 4. Unit test cases

### Cases 1–12 — the original plan

Unchanged. Divergences between the plan and the code are documented at `tests/README.md:75-122`.

| # | Use case | Path | Input | Expected output | Test file | Status |
|---|---|---|---|---|---|---|
| 1 | UC1 Sign Up | Happy | Valid email, password, mobile | Account created | `tests/unit/uc1-uc6-…` | ✅ mobile ignored — no such field exists |
| 2 | UC1 Sign Up | Error | Invalid email | Account cannot be created | same | ✅ |
| 3 | UC6 Verify Email | Happy | Valid email | Verification = true, user signed straight in | same | ✅ |
| 4 | UC6 Verify Email | Error | Unverified | User must confirm before signing in | same | ✅ |
| 5 | UC2 / UC7 Login | Happy | Valid credentials | Logged in | `tests/unit/uc2-uc7-…` | ✅ |
| 6 | UC2 / UC7 Login | Error | Empty input | Unable to log in, asks for valid input | same | ✅ |
| 7 | UC3 / UC8 Predict | Happy | Image attached | Prediction returned | `tests/unit/uc3-uc8-…` | ✅ |
| 8 | UC3 / UC8 Predict | Error | No image | Caller alerted to attach a file | same | ✅ |
| 9 | UC5 Access Material | Happy | Relevant query | List of materials | `rag-service/tests/test_uc5_uc9_uc10_…` | ✅ |
| 10 | UC5 Access Material | Error | Unrelated query | No material displayed | same | ✅ |
| 11 | UC9 Select Material | Happy | Select an item | That item displayed | same | ✅ as citation selection |
| 12 | UC10 Download Material | Happy | Press download | File on device | same | ⏭️ **skipped — not implemented** |

### Cases 17–31 — screening, verdict and handoff (PS1)

| # | Use case | Path | Input | Expected output | Test file | Status |
|---|---|---|---|---|---|---|
| 17 | UC22 Decide Verdict | **Boundary** | Score exactly 55 (`LIKELY_SCORE_THRESHOLD`) | `likely` | `lib/screening/verdict.test.js` | ✅ |
| 18 | UC22 Decide Verdict | **Boundary** | Score 54 | `unlikely` | same | ✅ |
| 19 | UC22 Decide Verdict | **Negative** | Score ≥ 55, writer age 6, every indicator a reversal | Held at `unlikely` **with a reason string** | same | ✅ |
| 20 | UC3 Screen | Error | No `student_id` in the form | 400 **before** the model is called | `tests/unit/uc3-uc8-…` | ✅ |
| 21 | UC3 Screen / MC2 | **Negative** | `student_id` of another therapist's student | 404 **before** model quota is spent | same | ✅ |
| 22 | UC3 Screen | Happy | Valid sample + student | Screening and derived profile stored against that student | same | ✅ |
| 23 | UC3 Screen | **Boundary** | No typed age, student has `birth_year` | Age falls back to year of birth | same | ✅ |
| 24 | UC23 Derive Profile | Happy | Indicator list | Weighted profile with a `primary_label` | `lib/profile.test.js` | ✅ |
| 25 | UC4 Handoff | Happy | Sample text | Handed over verbatim **once**, then erased | `lib/screening/handoff.test.js` | ✅ |
| 26 | UC4 Handoff | **Negative** | Empty sample | Refused, nothing written | same | ✅ |
| 27 | UC4 Handoff | **Robustness** | sessionStorage throws (private browsing) | Reports failure rather than throwing | same | ✅ |
| 28 | UC4 Handoff | **Robustness** | No storage at all (SSR) | Inert, returns null | same | ✅ |
| 29 | UC4 Handoff | **Negative** | Unparseable stored entry | Cleared **before** parsing, so it cannot wedge future visits | same | ✅ |
| 30 | UC4 Handoff | **Negative** | Entry of the wrong shape | Ignored | same | ✅ |
| 31 | UC4 Handoff | **Boundary** | Writer age 0, negative, or non-numeric | Only a usable age returned; null otherwise | same | ✅ |

### Cases 32–43 — error pattern analyser (PS4)

| # | Use case | Path | Input | Expected output | Test file | Status |
|---|---|---|---|---|---|---|
| 32 | UC14 Analyse | Happy | Valid sample | Analysis returned and stored | `app/api/analyze-text/route.test.js` | ✅ |
| 33 | UC14 Analyse | **Negative** | No sample submitted | Documented error, **nothing stored** | same | ✅ |
| 34 | UC14 Pipeline | Happy | Two words run together | Segmentation error found | `lib/nlp/analyze.test.js` | ✅ |
| 35 | UC14 Pipeline | Happy | One word split in two | Segmentation error found | same | ✅ |
| 36 | UC14 Pipeline | **Boundary** | A misspelling a single word explains better | **Not** split — single-word reconstruction wins | same | ✅ |
| 37 | UC14 Pipeline | Happy | Sample with mixed errors | Errors tagged and rolled into a profile | same | ✅ |
| 38 | UC14 Pipeline | Happy | Recurring letter substitutions | Cross-sample patterns reported | same | ✅ |
| 39 | UC14 Pipeline | **Boundary** | Fewer errors than `MIN_ERRORS_FOR_PROFILE` | Claims **no** profile rather than guessing | same | ✅ |
| 40 | UC14 Pipeline | **Degradation** | Neural (T5) layer unavailable | Analysis continues; caveat says the contextual layer did not run | same | ✅ |
| 41 | UC14 Pipeline | **Boundary** | Reversal-heavy sample, young writer | Caveat warns reversals are developmentally normal | same | ✅ |
| 42 | UC14 Pipeline | **Negative** | No readable words | Refused with `ok: false` | same | ✅ |
| 43 | UC14 Support | Unit | Token alignment, g2p, phonemes, morphology, taxonomy, tokenize, lexicon, classify, gec | **91 assertions across 9 modules** | `lib/nlp/{align,g2p,phonemes,morphology,taxonomy,tokenize,lexicon,classify,gec}.test.js` | ✅ |

### Cases 44–67 — caseload and student accounts

| # | Use case | Path | Input | Expected output | Test file | Status |
|---|---|---|---|---|---|---|
| 44 | UC11 Add Student | **Negative** | Blank name | Rejected | `app/students/actions.test.js` | ✅ |
| 45 | UC11 Add Student | **Boundary** | Birth year outside 1900–2100 | Rejected with a sentence, not a Postgres error | same | ✅ |
| 46 | UC11 Add Student | **Boundary** | Non-numeric birth year | Rejected | same | ✅ |
| 47 | UC11 Add Student | Happy | Name with whitespace, blank year | Name trimmed, year stored as null | same | ✅ |
| 48 | UC11 Add Student | Error | Insert fails | Reported instead of redirecting | same | ✅ |
| 49 | UC12 Issue Login | **Negative** | Malformed email | Rejected **before** touching the admin API | same | ✅ |
| 50 | UC12 / MC1 | **Negative** | Caller is a student account | Refused — the server action checks independently of middleware | same | ✅ |
| 51 | UC12 / MC2 | **Negative** | Another therapist's student | 404 | same | ✅ |
| 52 | UC12 Issue Login | **Negative** | Student already has a login | Refused; no second account | same | ✅ |
| 53 | UC12 Issue Login | Happy | Valid email | Account created with the student claim, initial password, **and no email sent** | same | ✅ |
| 54 | UC12 Issue Login | Error | Address already registered | Reported in plain words | same | ✅ |
| 55 | UC12 Issue Login | **Rollback** | Link write fails after auth user created | **Orphaned auth user deleted** | same | ✅ |
| 56 | UC12 Issue Login | **Rollback** | Link write fails *and* cleanup fails | Names the address for manual removal | same | ✅ |
| 57 | UC12 Issue Login | Error | Service-role key not configured | Says so; no stack trace | same | ✅ |
| 58 | UC12 / UC13 | Error | `student_accounts.sql` not applied | Refuses **without touching the admin API** | same | ✅ |
| 59 | UC13 Reset Password | Happy | Valid student with a login | Password back to the initial one | same | ✅ |
| 60 | UC13 Reset Password | **Negative** | Student has no login yet | Refused | same | ✅ |
| 61 | UC13 Reset Password | Error | Reset fails | Reported without claiming success | same | ✅ |
| 62 | UC16 Load Student | **Boundary** | Missing id | Null **without querying** | `lib/students.test.js` | ✅ |
| 63 | UC16 / MC2 | **Negative** | Row belongs to another therapist | Null → 404 at the route | same | ✅ |
| 64 | UC16 Load Student | **Degradation** | Login columns absent (migration unapplied) | Student still returned so the page renders instead of 404ing | same | ✅ |
| 65 | UC16 Load Student | **Negative** | An ordinary (non-schema) error | Does **not** retry | same | ✅ |
| 66 | UC16 Caseload | **Boundary** | No students | Empty caseload reported **without** flagging the schema | same | ✅ |
| 67 | UC16 Age | **Boundary** | Birth year in the future | Rejected rather than reporting a negative age | same | ✅ |

### Cases 68–96 — journey, chat and access control

| # | Use case | Path | Input | Expected output | Test file | Status |
|---|---|---|---|---|---|---|
| 68 | UC15 Journey | **Negative** | Student has no derived profile | 400 **naming the student** | `app/api/journey/route.test.js` | ✅ |
| 69 | UC15 Journey | Error | RAG service down | 503 with `offline` flag | same | ✅ |
| 70 | UC15 Journey | **Boundary** | No material ingested | Service note returned; **nothing persisted** | same | ✅ |
| 71 | UC15 Journey | Happy | Profile + material | Old journey archived, new one and steps persisted | same | ✅ |
| 72 | UC15 Journey | **Rollback** | Step insert fails | Student does **not** lose their old journey | same | ✅ |
| 73 | UC15 Journey | **Negative** | — | Profile looked up **by student, not by therapist** | same | ✅ |
| 74 | UC20 Step | **Negative** | Status the database would reject | 400 | `app/api/journey/step/route.test.js` | ✅ |
| 75 | UC20 / **MC3** | **Negative** | Step id belonging to another learner | **404 — RLS returns no row** | same | ✅ |
| 76 | UC20 Step | Happy | Status `done` | Marked done, `completed_at` stamped | same | ✅ |
| 77 | UC20 Step | **Boundary** | Step reopened | `completed_at` **cleared**, not left stale | same | ✅ |
| 78 | UC19 Progress | **Boundary** | No steps / all steps done | 0% / 100%, whole numbers | `lib/journey.test.js` | ✅ |
| 79 | UC19 Progress | **Negative** | No student id | Null, rather than another student's journey | same | ✅ |
| 80 | UC17 Chat | **Negative** | Not signed in | 401 | `app/api/chat/route.test.js` | ✅ |
| 81 | UC17 Chat | **Negative** | Blank question | 400 | same | ✅ |
| 82 | UC17 / **MC6** | **Negative** | Unrecognised `mode` value | **Normalised to `grounded`**, never answered ungrounded | same | ✅ |
| 83 | UC17 Chat | Happy | Valid question | Grounded answer; both messages persisted | same | ✅ |
| 84 | UC15/UC17 Client | Error | Service unconfigured | `offline: true` | `lib/ragService.test.js` | ✅ |
| 85 | UC15/UC17 Client | **Boundary** | Request exceeds the budget | Reported as a **timeout, not offline** | same | ✅ |
| 86 | UC15/UC17 Client | **Boundary** | `RAG_SERVICE_TIMEOUT_MS` set | Honoured | same | ✅ |
| 87 | UC21 Change Password | **Boundary** | 5 characters (`MIN_PASSWORD_LENGTH` is 6) | Rejected | `app/account/actions.test.js` | ✅ |
| 88 | UC21 Change Password | **Negative** | Confirmation differs | Rejected | same | ✅ |
| 89 | UC21 Change Password | **Negative** | New password equals `INITIAL_PASSWORD` | Rejected | same | ✅ |
| 90 | UC24 Access | **Negative** | Anonymous page request | Never reaches a page rendering screening data | `middleware.test.js` | ✅ |
| 91 | UC24 Access | **Negative** | Anonymous `/api/*` request | **Parseable JSON 401**, not an HTML login page | same | ✅ |
| 92 | **MC1** | **Negative** | Student hits a therapist API route | **JSON 403**, not a redirect | same | ✅ |
| 93 | **MC1** | **Negative** | Student hits any therapist page | Redirected to their journey | same | ✅ |
| 94 | UC24 Access | Happy | Student signs in | Lands on their journey, **not** the dashboard | same | ✅ |
| 95 | UC24 Access | Happy | Therapist visits `/my-journey` | Sent to the caseload | same | ✅ |
| 96 | **MC7** | **Negative** | `app_metadata` claim unrecognised, null user, or non-object | Treated as therapist; survives without throwing | `lib/roles.test.js` | ✅ |

### Coverage without individual case numbers

The numbered cases above are representative, not exhaustive — several files hold more
assertions than they have rows here (`app/students/actions.test.js` alone runs 23, and
`lib/students.test.js` 17). These areas have no numbered row at all:

| Area | File(s) | Tests |
|---|---|---|
| Auth server actions | `app/login/actions.test.js` | 5 |
| Admin client construction | `lib/supabase/admin.test.js` | 4 |
| Chat history window | `lib/chat.test.js` | 4 |
| Student auth constants | `lib/studentAuth.test.js` | 6 |

### Python service unit cases

| File | Tests | Covers |
|---|---|---|
| `test_plain.py` | 15 | UC17 plain mode — no retrieval, no embedding call |
| `test_endpoints.py` | 8 | Route wiring, 422 on an invalid mode (MC6) |
| `test_generation.py` | 8 | UC9 citation mapping, journey composition |
| `test_chunking.py` | 5 | Chunk boundaries |
| `test_db.py` | 4 | Repository calls |
| `test_uc5_uc9_uc10_learning_material.py` | 4 | Plan cases 9–12 |
| `test_embeddings.py` / `test_retrieval.py` | 2 / 2 | Embedding batch, similarity threshold filter |
| `test_ingest.py` | 2 | UC18 |
| `test_auth.py` / `test_health.py` | 1 / 1 | Service token, liveness |
| `test_it4_find_and_download_material.py` | 1 | Plan case 16 |

---

## 5. Integration test cases

Strategy: **bottom-up, call graph**. Each case asserts the message sequence in its diagram.

### Cases 13–16 — the original plan

| # | Test | Sequence asserted | File | Status |
|---|---|---|---|---|
| 13 | Sign Up | AuthService → EmailVerificationService → UserRepository | `tests/integration/it1-signup.test.js` | ✅ 3 tests |
| 14 | Login | AuthService → UserRepository → compare passwords | `tests/integration/it2-login.test.js` | ✅ 4 tests — this app holds no hashes; Supabase compares them |
| 15 | Prediction Service | → SampleRepository → DyslexiaModel → PredictionRepository | `tests/integration/it3-prediction-service.test.js` | ✅ 3 tests — there is no separate SampleRepository; one `screenings` row is written after the model returns |
| 16 | Find and Download Material | Retrieval → citation → download | `rag-service/tests/test_it4_find_and_download_material.py` | ⚠️ find ✅, **download ❌ not implemented** |

### Cases 97–105 — new

| # | Use case | Path | Sequence asserted | File | Status |
|---|---|---|---|---|---|
| 97 | UC14 | Happy | Route → `analyzeWriting` (all three passes) → classify → profile → persist → displayed | `tests/integration/it4-analyse-writing-sample.test.js` | ✅ |
| 98 | UC14 | **Negative** | No sample → nothing analysed, nothing stored | same | ✅ |
| 99 | UC14 | **Degradation** | T5 stage fails → analysis degrades **and says so** | same | ✅ |
| 100 | UC3 / UC23 | **Regression** | Screening a second student does **not** overwrite the first student's profile | `tests/integration/it5-student-records.test.js` | ✅ |
| 101 | UC3 / UC23 | Happy | Re-screening the same student replaces **that student's** profile only | same | ✅ |
| 102 | UC3 | Happy | Each screening filed against the student it was run for | same | ✅ |
| 103 | **MC2** | **Negative** | Another therapist's student refused **before spending model quota** | same | ✅ |
| 104 | UC3 | **Boundary** | Writer's age taken from the student record when none is typed | same | ✅ |
| 105 | UC1 / **MC8** | **Negative** | An already-registered address does not create a second account | `tests/integration/it1-signup.test.js` | ✅ |

Case 100 guards the most consequential regression in the project: before per-student
records, screening a second student overwrote the first student's profile.

---

## 6. End-to-end test cases

**Status: written, not executed.** These need a live Supabase project and running services.
They were not run on 2026-08-13, so no pass/fail is claimed for them here.

| # | Use case | Scenario | File | Requires |
|---|---|---|---|---|
| 106 | Schema | `students` table, login columns, and every screening backfilled onto a student | `e2e-students.test.js` | Database |
| 107 | UC11/UC3/UC15 | Create a student, screen them, build a journey, read it all back | same | Database |
| 108 | UC11 | Deleting a student cascades their records away | same | Database |
| 109 | UC24 | A student session carries the student role | `e2e-student-access.test.js` | Database ⚠️ **writes a real auth user** |
| 110 | UC19 | Student reads their own record, journey and steps | same | Database |
| 111 | UC20 | Student ticks a step done | same | Database |
| 112 | **MC3** | Student sees **no** screenings, **no** profiles, **no** chat messages | same | Database |
| 113 | **MC3** | Student sees **no other student's record** | same | Database |
| 114 | **MC3** | Student **cannot rewrite a step's title** — only its status | same | Database |
| 115 | UC20 | Therapist path still works after the column grant | same | Database |
| 116 | UC17 | Grounded answer with citations across the JS→Python boundary | `e2e-live.test.js` | Ollama + RAG service |
| 117 | UC15 | Journey built end to end | same | Ollama + RAG service |
| 118 | Security | A bad service token is reported as an **error, not as offline** | same | RAG service |
| 119 | Resilience | An unreachable service — and absent configuration — are both reported as **offline** | same | — |
| 120 | Resilience | A blown time budget is reported as a **timeout, not offline** | same | — |

Cases 112–114 are the only tests that prove RLS actually holds, because they use a **real
signed-in student session**. `e2e-students.test.js:13-15` uses the service-role key and
bypasses policies entirely, so it cannot prove this.

⚠️ `e2e-student-access.test.js` writes a real auth user and student row to the live project.
Ask before running it.

---

## 7. Robustness testing (fuzzing)

**Status: not built.** `package.json` devDependencies contains `concurrently` and `vitest`
only — `fast-check` is not installed and no fuzzer exists. The rubric requires one capable
of running ~24 hours by the final presentation (`docs/PROJECT_BRIEF.md:221-231`). This is
the plan, not a claim.

### Targets

Chosen because they are pure, deterministic, and parse untrusted input.

| # | Target | Property to hold | Generator |
|---|---|---|---|
| F1 | `analyzeWriting` (`lib/nlp/analyze.js`) | Never throws; `ok` is always boolean; error offsets always fall inside the sample | Arbitrary Unicode, 20–20,000 chars, mixed scripts, zero-width joiners, emoji |
| F2 | `decideVerdict` (`lib/screening/verdict.js`) | Verdict is always one of two values; score always an integer 0–100 | Arbitrary/absent `likelihoodScore`, malformed indicator arrays, `NaN`, `Infinity` |
| F3 | `normaliseScore` | Output always integer 0–100 | Non-finite, negative, `1e308`, strings, objects |
| F4 | `takeHandoff` (`lib/screening/handoff.js`) | Never throws; always clears storage first | Arbitrary sessionStorage payloads including valid JSON of wrong shape |
| F5 | `roleOf` (`lib/roles.js`) | Returns exactly `student` or `therapist` | Arbitrary user objects, null prototypes, nested `app_metadata` |
| F6 | `normaliseMode` (`app/api/chat/route.js`) | Never returns anything but `grounded` or `plain` | Arbitrary values (**MC6**) |
| F7 | `tokenizeWords` / `splitSentences` | Offsets are monotonic and within bounds | Arbitrary text, no sentence terminators, only terminators |
| F8 | `chunk_text` (`rag-service/app/chunking.py`) | Chunks reassemble to cover the input; none exceeds the size limit | Hypothesis text strategies |

### Approach

`fast-check` for F1–F7, `Hypothesis` for F8. Short runs (1,000 cases) in CI; a long-running
harness with a fixed seed corpus and a failure log for the 24-hour run. Any counterexample
gets minimised by the framework and committed as a regression unit test in the table above.

---

## 8. Known gaps

Stated plainly, because the final rubric grades frontend unit testing and system testing
explicitly.

| Gap | Detail | Blocked on |
|---|---|---|
| **Frontend components have no tests** | `PasswordField`, `ErrorAnalysis`, `JourneyBoard`, `AddStudentForm`, `ChatAssistant`, `StudentLoginPanel`. A rendering bug in `ErrorAnalysis` is indistinguishable from a wrong analysis. | A decision, not effort: `vitest.config.mjs` sets `environment: "node"` deliberately. Component tests need `jsdom` + `@testing-library/react`, neither installed. Reversing a documented choice should be deliberate. |
| **No system/UI test tool** | Cypress is encouraged by the rubric and not installed. | Scheduling. |
| **No fuzzer** | §7. | Scheduling. |
| **No rate limiting** (MC4) | A signed-in therapist can call the vision model without limit. Only anonymous callers are stopped. | Design decision needed. |
| **E2E never executed** | Cases 106–120 have never been run. | A live database, and permission to write to it. |
| **UC10 Download Material** | Not implemented at all. To close: store the original file in Supabase Storage, add a lookup by id to `Db`, add `GET /materials/{id}/file`. | Product decision — is it in scope? |
| **MIME type is trusted** (MC5) | Type checked from `upload.type`, not magic bytes. | Low priority — the file is never executed or stored. |

---

## 9. Timeline

Anchored to **2026-08-13**. Meeting dates must be confirmed against the course schedule —
they are not recorded in `docs/PROJECT_BRIEF.md`.

| Week from 2026-08-13 | Work | Exit criterion |
|---|---|---|
| **Week 1** | Execute cases 106–120 against the live project. Record real results. | E2E status column filled with measured outcomes, not "not executed". |
| **Week 1** | Decide the jsdom question. If yes, install `jsdom` + `@testing-library/react` and amend `vitest.config.mjs` with the reasoning. | Decision recorded in `HANDOFF.md`. |
| **Week 2** | Frontend unit tests for `ErrorAnalysis` and `JourneyBoard` first — they render the two AI outputs. | Both components covered, including empty and error states. |
| **Week 2** | Install `fast-check`. Implement F2, F3, F5, F6 (the cheap pure functions). | 1,000-case runs green in CI. |
| **Week 3** | Implement F1, F4, F7 and Hypothesis F8. | Counterexamples minimised and committed as regression tests. |
| **Week 3** | Install Cypress. Script the two highest-value journeys: therapist screens a student end to end; student signs in and ticks a step. | Both green against a local dev server. |
| **Week 4** | 24-hour fuzz run with a seed corpus. Address MC4 rate limiting if the run surfaces cost exposure. | Failure log reviewed; findings in the report's testing-challenges section. |
| **Before final** | Refresh every measured number in this document. | No stale counts — the `224` incident above is the precedent. |

---

## Traceability matrix

| Use case | Unit | Integration | E2E |
|---|---|---|---|
| UC1 Sign Up | 1, 2 | 13, 105 | — |
| UC2 Login | 5, 6 | 14 | — |
| UC3 Screen Writing Sample | 7, 8, 20–23 | 15, 102, 104 | 107 |
| UC4 Hand Off to Analyser | 25–31 | — | — |
| UC5 Retrieve Material | 9, 10 | 16 | 116 |
| UC6 Verify Email | 3, 4 | 13 | — |
| UC7 Authenticate | 5, 6 | 14 | 109 |
| UC8 Call Vision Model | 7, 8 | 15 | — |
| UC9 Select / Cite Material | 11 | 16 | 116 |
| UC10 Download Material | 12 ⏭️ | 16 ❌ | — |
| UC11 Add Student | 44–48 | — | 107, 108 |
| UC12 Issue Student Login | 49–58 | — | 109 |
| UC13 Reset Student Password | 59–61 | — | — |
| UC14 Analyse Error Patterns | 32–43 | 97–99 | — |
| UC15 Generate Learning Journey | 68–73, 84–86 | — | 107, 117 |
| UC16 View Caseload | 62–67 | — | — |
| UC17 Ask Learning Assistant | 80–83 | — | 116 |
| UC18 Ingest Corpus Material | `test_ingest.py` | — | — |
| UC19 View My Journey | 78, 79 | — | 110 |
| UC20 Update Step Progress | 74–77 | — | 111, 115 |
| UC21 Change Own Password | 87–89 | — | — |
| UC22 Decide Verdict | 17–19 | 15 | — |
| UC23 Derive Learner Profile | 24 | 100, 101 | — |
| UC24 Enforce Role-Based Access | 90–96 | — | 109 |
| **MC1** Student escalation | 50, 92, 93 | — | 112 |
| **MC2** Cross-therapist read | 21, 51, 63 | 103 | — |
| **MC3** Cross-student read | 75 | — | 112–114 |
| **MC4** Anonymous quota burn | 90, 91 | — | — |
| **MC5** Hostile upload | — ⚠️ **gap** | — | — |
| **MC6** Mode tampering | 82, `test_endpoints.py` | — | — |
| **MC7** Self-promotion | 96 | — | 109 |
| **MC8** Email quota / enumeration | — | 105 | — |

Two misuse cases have thin coverage: **MC5** has no test for the 8 MB ceiling or the type
allowlist, and **MC4** has none for an authenticated caller because no limit exists to test.
Both are listed in §8.
