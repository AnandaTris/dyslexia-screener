// Test-only stand-in for the supabase-js *query builder*.
//
// This is the second Supabase double in this directory, and the split is
// deliberate. `supabase.js` models the auth surface and a write log — signUp,
// signInWithPassword, insert, upsert — which is what the auth and screening
// suites need. It cannot answer a read. This one models the opposite half: the
// chained read/write builder the journey routes lean on.
//
// Every builder returned by .from() is thenable, so `await` works after any
// chain depth (.select().eq().order().limit(), .update().eq().select().single(),
// …) without the test having to predict the exact call sequence.
//
// `data` maps a lookup key to the {data, error} the chain should resolve to.
// Keys are tried most specific first: "table.op" then "table". A function value
// receives the recorded chain state, so a test can vary the answer by filter.
export function fakeSupabase({ user = null, data = {} } = {}) {
  const writes = [];

  const make = (table) => {
    const state = { table, op: "select", filters: [], rows: null, patch: null, columns: null };

    const settle = () => {
      const entry = data[`${table}.${state.op}`] ?? data[table];
      const value = typeof entry === "function" ? entry(state) : entry;
      return value ?? { data: null, error: null };
    };

    const api = {
      // Recorded so a test can answer differently per column list — which is how
      // "these columns don't exist yet" is modelled.
      select: (columns = null) => {
        state.columns = columns;
        return api;
      },
      eq: (column, value) => {
        state.filters.push([column, value]);
        return api;
      },
      neq: (column, value) => {
        state.filters.push([column, value, "neq"]);
        return api;
      },
      in: (column, values) => {
        state.filters.push([column, values, "in"]);
        return api;
      },
      order: () => api,
      limit: () => api,
      maybeSingle: () => api,
      single: () => api,
      // Writes push `state` by reference so filters chained afterwards
      // (.update({...}).eq("id", x)) are visible to assertions.
      insert: (rows) => {
        state.op = "insert";
        state.rows = rows;
        writes.push(state);
        return api;
      },
      update: (patch) => {
        state.op = "update";
        state.patch = patch;
        writes.push(state);
        return api;
      },
      upsert: (rows) => {
        state.op = "upsert";
        state.rows = rows;
        writes.push(state);
        return api;
      },
      delete: () => {
        state.op = "delete";
        writes.push(state);
        return api;
      },
      then: (onOk, onErr) => Promise.resolve(settle()).then(onOk, onErr),
    };

    return api;
  };

  return {
    _writes: writes,
    writesTo: (table, op) =>
      writes.filter((w) => w.table === table && (!op || w.op === op)),
    auth: { getUser: async () => ({ data: { user } }) },
    from: make,
  };
}
