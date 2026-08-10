/**
 * Test doubles for the Supabase client the app talks to.
 *
 * The test plan names three collaborators — AuthService, EmailVerificationService
 * and UserRepository. This project does not own those classes: Supabase Auth is
 * all three at once, reached through `lib/supabase/server.js`. Rather than
 * pretend otherwise, the doubles below are split along the plan's seams and then
 * wired into one object shaped like the Supabase client:
 *
 *   AuthService              -> createFakeSupabase().auth
 *   EmailVerificationService -> createEmailVerificationService()
 *   UserRepository           -> createUserRepository()
 *   SampleRepository /
 *   PredictionRepository     -> createFakeSupabase().from("<table>").insert()
 *
 * Every call is recorded so an integrated test can assert the sequence of
 * messages in the sequence diagrams, not just the final answer.
 */

/** Errors in the shape `friendlyMessage()` in app/login/actions.js reads. */
export const AUTH_ERRORS = {
  invalidEmail: {
    code: "email_address_invalid",
    message: "Unable to validate email address: invalid format",
  },
  invalidCredentials: {
    code: "invalid_credentials",
    message: "Invalid login credentials",
  },
  emailNotConfirmed: {
    code: "email_not_confirmed",
    message: "Email not confirmed",
  },
  weakPassword: {
    code: "weak_password",
    message: "Password should be at least 6 characters",
  },
  rateLimited: {
    code: "over_email_send_rate_limit",
    message: "email rate limit exceeded",
  },
};

/** UserRepository: findUser(email) / save(user), in memory. */
export function createUserRepository(seed = []) {
  const users = new Map();
  const calls = [];
  let nextId = 1;

  for (const user of seed) {
    users.set(user.email, {
      id: user.id ?? `user-${nextId++}`,
      email: user.email,
      password: user.password,
      emailConfirmed: user.emailConfirmed ?? true,
    });
  }

  return {
    calls,
    findUser(email) {
      calls.push(["findUser", email]);
      return users.get(email) ?? null;
    },
    save(user) {
      calls.push(["save", user.email]);
      const stored = { id: `user-${nextId++}`, emailConfirmed: false, ...user };
      users.set(stored.email, stored);
      return stored.id;
    },
    all() {
      return [...users.values()];
    },
  };
}

/**
 * EmailVerificationService: decides whether an address is usable.
 *
 * Deliberately shallow — a syntax check plus an optional deny list. The real
 * service is Supabase's, and duplicating its rules here would only test the
 * duplicate.
 */
export function createEmailVerificationService({ reject = [] } = {}) {
  const calls = [];

  return {
    calls,
    verifyEmail(email) {
      calls.push(email);
      if (typeof email !== "string") return false;
      if (reject.includes(email)) return false;
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    },
  };
}

/**
 * A Supabase-client-shaped facade over the two doubles above plus an in-memory
 * table store.
 *
 * `requireEmailConfirmation` mirrors the Supabase project setting the app has to
 * cope with either way: on, sign-up returns a user and no session; off, it
 * returns a session and the user is already signed in.
 */
export function createFakeSupabase({
  userRepository = createUserRepository(),
  emailVerificationService = createEmailVerificationService(),
  requireEmailConfirmation = true,
  currentUser = null,
  insertError = null,
  // A screening now has to name a student, so the double seeds one owned by
  // whoever is signed in. Pass `students: []` to exercise the unknown-student
  // path.
  students = currentUser
    ? [
        {
          id: "student-1",
          therapist_id: currentUser.id,
          display_name: "Test Student",
          birth_year: null,
        },
      ]
    : [],
} = {}) {
  const tables = { students: [...students] };
  const inserts = [];
  const upserts = [];
  const signedOut = [];

  function recordInsert(table, row) {
    inserts.push({ table, row });
    (tables[table] ??= []).push(row);
    return { data: null, error: insertError };
  }

  // The screening route upserts a derived learner profile alongside the
  // screening insert. Recorded on its own list so a test can tell the two
  // writes apart.
  //
  // `onConflict` is honoured rather than ignored, because the whole point of
  // per-student records is which column that key is. If the double just
  // appended, a per-therapist upsert and a per-student one would look identical
  // in the stored rows, and the regression this feature exists to prevent —
  // screening a second student wiping the first one's profile — would pass
  // either way.
  function recordUpsert(table, row, options = {}) {
    upserts.push({ table, row });
    const rows = (tables[table] ??= []);
    const key = options?.onConflict;
    const clash = key ? rows.findIndex((existing) => existing[key] === row[key]) : -1;
    if (clash >= 0) rows[clash] = row;
    else rows.push(row);
    return { data: null, error: insertError };
  }

  return {
    userRepository,
    emailVerificationService,
    tables,
    inserts,
    upserts,
    signedOut,

    rowsIn(table) {
      return tables[table] ?? [];
    },

    auth: {
      /**
       * Supabase's `signUp` has one behaviour that shapes real code: with email
       * confirmation on, registering an address that already exists SUCCEEDS and
       * silently re-sends the mail. The only tell is an empty `identities`
       * array, which is exactly what actions.js checks for.
       */
      async signUp({ email, password }) {
        if (!emailVerificationService.verifyEmail(email)) {
          return { data: { user: null, session: null }, error: AUTH_ERRORS.invalidEmail };
        }

        if (typeof password !== "string" || password.length < 6) {
          return { data: { user: null, session: null }, error: AUTH_ERRORS.weakPassword };
        }

        const existing = userRepository.findUser(email);
        if (existing) {
          return {
            data: { user: { id: existing.id, email, identities: [] }, session: null },
            error: null,
          };
        }

        const id = userRepository.save({
          email,
          password,
          emailConfirmed: !requireEmailConfirmation,
        });

        return {
          data: {
            user: { id, email, identities: [{ id, provider: "email" }] },
            session: requireEmailConfirmation ? null : { access_token: "test-token", user: { id, email } },
          },
          error: null,
        };
      },

      async signInWithPassword({ email, password }) {
        const user = userRepository.findUser(email);

        if (!user || user.password !== password) {
          return { data: { user: null, session: null }, error: AUTH_ERRORS.invalidCredentials };
        }

        if (!user.emailConfirmed) {
          return { data: { user: null, session: null }, error: AUTH_ERRORS.emailNotConfirmed };
        }

        return {
          data: {
            user: { id: user.id, email: user.email },
            session: { access_token: "test-token", user: { id: user.id, email: user.email } },
          },
          error: null,
        };
      },

      async getUser() {
        return { data: { user: currentUser }, error: null };
      },

      async signOut() {
        signedOut.push(true);
        return { error: null };
      },
    },

    // Writes are recorded; reads are answered from the seeded table. The read
    // half exists because the screening route now resolves a student before it
    // will spend a Gemini call, so the route cannot run without it.
    from(table) {
      const filters = [];
      const builder = {
        insert(row) {
          return Promise.resolve(recordInsert(table, row));
        },
        upsert(row, options) {
          return Promise.resolve(recordUpsert(table, row, options));
        },
        select() {
          return builder;
        },
        eq(column, value) {
          filters.push([column, value]);
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        matches() {
          return (tables[table] ?? []).filter((row) =>
            filters.every(([column, value]) => row[column] === value)
          );
        },
        maybeSingle() {
          return Promise.resolve({ data: builder.matches()[0] ?? null, error: null });
        },
        then(onOk, onErr) {
          return Promise.resolve({ data: builder.matches(), error: null }).then(onOk, onErr);
        },
      };
      return builder;
    },
  };
}
