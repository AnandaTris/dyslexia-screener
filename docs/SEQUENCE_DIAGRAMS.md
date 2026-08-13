# Sequence Diagrams — DAS D.I.A.L. (Team 6)

**Written:** 2026-08-13 · **Branch:** `jer`

Five workflows that had no diagram in the Project Meeting 1/2 document. The four original
diagrams (Sign Up, Login, Prediction Service, Find and Download Material) are unchanged and
stay in that document.

Each diagram is drawn from the code as it is on this branch, not from intended design.
Failure branches are included because in this system they are where most of the interesting
behaviour lives — the rollbacks especially.

| # | Workflow | Use case | Entry point |
|---|---|---|---|
| SD5 | Error Pattern Analysis | UC14 | `app/api/analyze-text/route.js` |
| SD6 | Generate Learning Journey | UC15 | `app/api/journey/route.js:44` |
| SD7 | Student Completes a Step | UC20 | `app/api/journey/step/route.js` |
| SD8 | Issue Student Login | UC12 | `app/students/actions.js:101` |
| SD9 | Role-Based Access Enforcement | UC24 / MC1 | `middleware.js` |

---

## SD5 — Error Pattern Analysis (UC14, PS4)

The largest subsystem in the project, and the one with no prior diagram. Note that the
three detection passes are ordered deliberately: boundary claims tokens first, the neural
pass sees errors that produce real words, and the lexicon pass sweeps up what is left.

```mermaid
sequenceDiagram
    autonumber
    actor T as Therapist
    participant UI as /analysis page
    participant API as POST /api/analyze-text
    participant Auth as Supabase Auth
    participant AW as analyzeWriting
    participant TK as tokenize
    participant BD as boundary pass
    participant GEC as neural GEC<br/>(Transformers.js)
    participant LEX as lexicon<br/>(Hunspell + phonetic)
    participant CL as classifyError
    participant P as persistErrorAnalysis
    participant DB as Postgres

    T->>UI: paste sample, optional writer age
    UI->>API: POST {text, writerAge}

    API->>Auth: getUser()
    alt no session
        Auth-->>API: null
        API-->>UI: 401 "You must be signed in"
    else authenticated
        Auth-->>API: user

        API->>API: validate length
        alt < 20 or > 20000 chars
            API-->>UI: 400 with the specific reason
        else valid
            API->>AW: analyzeWriting(text, {writerAge})

            AW->>TK: splitSentences + tokenizeWords
            TK-->>AW: sentences, tokens with offsets

            AW->>BD: findBoundaryErrors(tokens)
            Note over BD: joins tested before splits —<br/>"to gether" must be claimed by the<br/>pass that sees both tokens
            BD-->>AW: errors + consumed token set

            AW->>GEC: correctSentences(sentences)
            alt model unavailable
                GEC-->>AW: {ok: false, reason}
                Note over AW: pipeline continues on<br/>boundary + lexicon only —<br/>a caveat records the gap
            else model ready
                GEC-->>AW: corrected sentences
                AW->>AW: pairsFromCorrection()
                Note over AW: real→real accepted only if<br/>the two sound alike —<br/>non-word→word marked contested
            end

            loop each non-word token not consumed
                AW->>LEX: suggestTargets(word)
                LEX-->>AW: best candidate + score
                Note over AW: contested neural target scored<br/>against the lexicon's — stronger wins<br/>(neural gets +0.05 for context)
            end

            loop each produced/target pair
                AW->>CL: classifyError(produced, target)
                CL-->>AW: category, subtype, confidence, editOps
            end

            AW->>AW: aggregate — category counts,<br/>recurring patterns, repeated words
            AW->>AW: buildProfile()
            alt fewer errors than MIN_ERRORS_FOR_PROFILE
                Note over AW: reports "not enough errors<br/>to describe a pattern"<br/>rather than guessing
            end
            AW->>AW: buildSummary + buildCaveats
            AW-->>API: {ok, errors, profile, summary, caveats, pipeline}

            API->>P: persistErrorAnalysis(...)
            P->>DB: insert error_analyses
            alt insert fails
                DB-->>P: error
                P-->>API: {saved: false}
                Note over P,API: logged and swallowed —<br/>never lose the report<br/>the user is waiting on
            else stored
                DB-->>P: ok
                P-->>API: {saved: true}
            end

            API-->>UI: 200 {text, analysis}
            UI-->>T: categorised errors, profile, caveats
        end
    end
```

---

## SD6 — Generate Learning Journey (UC15)

Crosses the JS → Python boundary. The two rollback branches at the end are the reason this
diagram is worth drawing: both exist to stop a partial write from hiding a journey the
student already had.

```mermaid
sequenceDiagram
    autonumber
    actor T as Therapist
    participant UI as JourneyBoard
    participant API as POST /api/journey
    participant RC as resolveCaller
    participant LS as loadStudent
    participant DB as Postgres (RLS)
    participant RS as callRagService
    participant FA as FastAPI /journey
    participant EM as Embedder (Ollama)
    participant VS as pgvector<br/>match_chunks
    participant GN as Generator (Ollama)

    T->>UI: "Build journey" for a student
    UI->>API: POST {student_id}

    API->>RC: resolveCaller(supabase, student_id)
    RC->>DB: auth.getUser()
    alt no session
        RC-->>API: 401
    else no student_id
        RC-->>API: 400 "Pick a student first."
    else
        RC->>LS: loadStudent(therapistId, studentId)
        LS->>DB: select students where therapist_id AND id
        alt not this therapist's student
            DB-->>LS: null
            RC-->>API: 404 "That student was not found."
        else found
            DB-->>LS: student
            RC-->>API: {user, student}

            API->>DB: select learner_profiles.profile<br/>where student_id
            alt no profile yet
                DB-->>API: null
                API-->>UI: 400 "Run a writing screening<br/>for {name} first"
            else profile present
                DB-->>API: profile

                API->>RS: callRagService("/journey", {profile})
                alt RAG_SERVICE_URL / TOKEN unset
                    RS-->>API: {ok:false, offline:true}
                    API-->>UI: 503 offline
                else request sent
                    RS->>FA: POST /journey (X-Service-Token)
                    FA->>FA: require_service_token (hmac compare)
                    FA->>EM: embed("learning activities for<br/>{primary_label} dyslexia support")
                    EM-->>FA: query embedding
                    FA->>VS: match_chunks(embedding, k, profiles)
                    VS-->>FA: rows with similarity
                    FA->>FA: drop rows below threshold

                    alt no chunks survive
                        FA-->>RS: {steps: [], note}
                        RS-->>API: ok
                        API-->>UI: {journey: null, note}
                        Note over API: no empty journey persisted —<br/>it would leave a permanent<br/>blank board
                    else chunks retrieved
                        FA->>GN: compose_journey(profile, chunks)
                        Note over GN: prompted to use ONLY the<br/>excerpts and list source ids
                        GN-->>FA: {steps:[{title, description, source_ids}]}
                        FA->>FA: _citations_for() maps ids → chunks
                        FA-->>RS: {steps}
                        RS-->>API: {ok:true, data}

                        API->>DB: insert journeys (status active)
                        alt insert fails
                            DB-->>API: error
                            API-->>UI: 500 "apply rag_schema.sql<br/>and students.sql"
                        else parent saved
                            DB-->>API: journey {id, created_at}
                            API->>DB: insert journey_steps<br/>.select(id, ...)
                            alt step insert fails
                                DB-->>API: error
                                API->>DB: delete journeys where id
                                Note over API,DB: roll the parent back, or it<br/>tops the "newest active" query<br/>and hides the real journey
                                API-->>UI: 500 "Could not save the steps."
                            else steps saved
                                DB-->>API: savedSteps (with ids)
                                API->>DB: update journeys set archived<br/>where user_id AND student_id<br/>AND active AND id ≠ new
                                Note over API,DB: scoped to student_id — otherwise<br/>one rebuild archives every<br/>other student's journey
                                API-->>UI: {journey: {...journey, steps}}
                                UI-->>T: rendered board
                            end
                        end
                    end
                end
            end
        end
    end
```

**Measured latency** (Intel Iris Xe, CPU-only inference, recorded in `lib/ragService.js:14-18`):
`/journey` **76 s warm, 121.8 s cold**. The client timeout is 300 s by default and
overridable via `RAG_SERVICE_TIMEOUT_MS`; it was raised from 120 s after firing on a
request that had actually succeeded.

---

## SD7 — Student Completes a Step (UC20)

Short, and the point is what is *absent*: there is no ownership check in the handler. RLS
is the authorisation, and the 404 is a row that did not match.

```mermaid
sequenceDiagram
    autonumber
    actor S as Student
    participant UI as JourneyBoard
    participant MW as middleware
    participant API as PATCH /api/journey/step
    participant DB as Postgres (RLS)

    S->>UI: tick a step done
    UI->>MW: PATCH /api/journey/step {stepId, status}

    MW->>MW: getUser() + roleOf()
    Note over MW: /api/journey/step is one of the<br/>four paths on STUDENT_PATHS
    MW->>API: forward

    API->>DB: auth.getUser()
    alt no session
        API-->>UI: 401
    else authenticated
        API->>API: parse body
        alt malformed JSON
            API-->>UI: 400 "Expected a JSON body."
        else no stepId
            API-->>UI: 400 "A stepId is required."
        else status not in {not_started, in_progress, done}
            API-->>UI: 400 naming the three values
        else valid
            API->>DB: update journey_steps<br/>set status, completed_at<br/>where id = stepId
            Note over API,DB: no ownership filter — RLS exposes<br/>only steps whose parent journey<br/>belongs to auth.uid()

            alt step belongs to another learner
                DB-->>API: no row
                API-->>UI: 404 "That step could not be found."
                Note over DB,API: MC3 defence: a foreign id is<br/>indistinguishable from a<br/>missing one
            else row updated
                DB-->>API: step
                Note over DB: completed_at set when done,<br/>NULLed on any other status
                API-->>UI: 200 {step}
                UI-->>S: progress bar advances
            end
        end
    end
```

---

## SD8 — Issue Student Login (UC12)

The compensating delete at the end is the whole reason this needs a diagram: two different
Supabase clients are used on purpose, and the failure between them leaves an orphan that
would otherwise block every retry forever.

```mermaid
sequenceDiagram
    autonumber
    actor T as Therapist
    participant UI as StudentLoginPanel
    participant SA as createStudentLogin<br/>(server action)
    participant RV as resolveTherapistAndStudent
    participant TC as Therapist's client
    participant AD as Admin client<br/>(service role)
    participant AU as Supabase Auth
    participant DB as students table

    T->>UI: enter student's email
    UI->>SA: createStudentLogin(formData)

    SA->>SA: isValidEmail(email)
    alt invalid shape
        SA-->>UI: "Enter a valid email address."
        Note over SA: checked first so a typo<br/>costs nothing
    else valid
        SA->>RV: resolve(studentId, "issue a login")
        RV->>TC: auth.getUser()
        alt no session
            RV-->>SA: "You must be signed in."
        else role is not therapist
            RV-->>SA: "Only a therapist can issue a login."
            Note over RV: the server action is its own<br/>entry point — a form POST does<br/>not care what middleware thinks
        else
            RV->>TC: loadStudent(therapist_id, student_id)
            TC->>DB: select with login columns
            alt student_accounts.sql not applied
                DB-->>TC: PGRST204 / 42703
                TC-->>RV: {loginsUnavailable: true}
                RV-->>SA: "apply supabase/student_accounts.sql first"
                Note over RV: stops BEFORE creating anything —<br/>otherwise the auth user exists<br/>and the link write fails
            else student loaded
                DB-->>RV: student
                RV-->>SA: {student}

                alt already has a login
                    SA-->>UI: "{name} already has a login."
                else no login yet
                    SA->>AD: createAdminClient()
                    alt SUPABASE_SERVICE_ROLE_KEY missing
                        AD-->>SA: throws
                        SA-->>UI: "Student logins are not set up<br/>on this server."
                    else admin ready
                        SA->>AU: admin.createUser({email, INITIAL_PASSWORD,<br/>email_confirm: true,<br/>app_metadata:{role, student_id}})
                        Note over AU: email_confirm short-circuits the<br/>confirmation mail — no email is<br/>ever sent by this feature

                        alt address already registered
                            AU-->>SA: error
                            SA-->>UI: "That email already has an account."
                        else created
                            AU-->>SA: created.user

                            SA->>TC: update students set auth_user_id,<br/>login_email where id
                            Note over SA,TC: through the THERAPIST's client,<br/>not the admin one — RLS re-proves<br/>ownership at write time

                            alt link write fails
                                TC-->>SA: error
                                SA->>AU: admin.deleteUser(created.user.id)
                                Note over SA,AU: compensating delete — an orphaned<br/>auth user makes every retry fail<br/>with "already registered" forever
                                alt cleanup succeeded
                                    SA-->>UI: "Could not create that login — try again."
                                else cleanup also failed
                                    SA-->>UI: names the address, tells the therapist<br/>to delete it in the dashboard
                                end
                            else linked
                                TC-->>SA: ok
                                SA->>SA: revalidatePath(/students/{id})
                                SA-->>UI: "Login created. {name} signs in as<br/>{email} with the password {INITIAL_PASSWORD}."
                                UI-->>T: credentials shown on screen
                                Note over T: passed on in person —<br/>see MC8 and the SMTP<br/>quota history
                            end
                        end
                    end
                end
            end
        end
    end
```

---

## SD9 — Role-Based Access Enforcement (UC24 / MC1)

Runs on every request that is not a static asset. The API-versus-page split matters: a
redirect answering an API call sends an HTML login page to `res.json()`, which surfaces as
a parser error instead of the real reason.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant MW as middleware
    participant AU as Supabase Auth
    participant R as roleOf()
    participant APP as Route / Page

    B->>MW: any request matching the matcher
    MW->>AU: getUser()
    Note over MW,AU: also refreshes the session<br/>token when needed

    alt anonymous
        AU-->>MW: null
        alt path is /login or /signup
            MW->>APP: allow
        else path is /api/*
            MW-->>B: JSON 401 "Your session expired."
            Note over MW,B: JSON, not a redirect — HTML here<br/>blows up on res.json()
        else any other page
            MW-->>B: 302 → /login
        end
    else authenticated
        AU-->>MW: user
        MW->>R: roleOf(user)
        R->>R: read app_metadata.role
        Note over R: app_metadata only — user_metadata<br/>is user-writable (MC7).<br/>Absent claim ⇒ therapist
        R-->>MW: "student" | "therapist"

        alt on /login or /signup while signed in
            MW-->>B: 302 → /my-journey (student)<br/>or /dashboard (therapist)
            Note over MW: role-aware, so a student does not<br/>bounce /login → /dashboard → /my-journey
        else student
            MW->>MW: allowedForStudent(pathname)
            Note over MW: ALLOWLIST: /my-journey, /account,<br/>/login, /api/journey/step.<br/>New therapist routes are closed<br/>by default
            alt allowed
                MW->>APP: allow
            else disallowed /api/*
                MW-->>B: JSON 403 "That is not available<br/>on a student account."
            else disallowed page
                MW-->>B: 302 → /my-journey
            end
        else therapist
            alt path starts /my-journey
                MW-->>B: 302 → /students
                Note over MW: a therapist has no student record,<br/>so the page would render an error
            else
                MW->>APP: allow
            end
        end
    end
```

All redirect URLs are built with `nextUrl.clone()`, so a forged `Host` header cannot send
the user to an attacker's origin — asserted in `middleware.test.js`.

---

## Consistency notes

- **SD6 and SD7 both rely on `journeys.user_id` holding the *therapist*.** That is why the
  student's read (`loadJourneyForStudent`) filters on `student_id` only: filtering on the
  signed-in student's uid would return `null` every time.
- **SD5 and SD6 write through different persistence contracts.** SD5 swallows a storage
  failure (the report is worth more than the record); SD6 rolls back (a partial journey
  actively hides a good one). Both are deliberate and neither should be "made consistent".
- **SD8 is the only flow that uses the service-role key**, and it hands the write back to
  the therapist's own client as soon as it can.
