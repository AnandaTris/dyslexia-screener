/**
 * Unit tests — handoff.js (screener → analyser sample handover)
 *
 * The two contracts worth protecting here are the ones the module's own header
 * promises and the two pages depend on:
 *
 *   1. A handover is read exactly once and erased, so the analyser never
 *      silently re-fills with a previous child's writing.
 *   2. Nothing about a missing, hostile or hand-edited sessionStorage may
 *      throw, because both call sites treat the handover as best-effort and
 *      navigate either way.
 *
 * The doubles in tests/support/ model Supabase and redirects; none of them
 * model Web Storage, so the fake below is local to this file.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stashHandoff, takeHandoff } from "./handoff.js";

/**
 * The narrowest slice of sessionStorage the module touches. `throws` names the
 * methods that should fail, which is how a browser with site data blocked or a
 * zero quota behaves — it hands over a storage object that rejects every call.
 */
function fakeSessionStorage({ throws = [] } = {}) {
  const entries = new Map();
  const refuseIfListed = (method) => {
    if (throws.includes(method)) throw new Error(`${method} is not allowed`);
  };
  return {
    entries,
    getItem(key) {
      refuseIfListed("getItem");
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      refuseIfListed("setItem");
      entries.set(key, String(value));
    },
    removeItem(key) {
      refuseIfListed("removeItem");
      entries.delete(key);
    },
  };
}

let storage;

beforeEach(() => {
  storage = fakeSessionStorage();
  globalThis.window = { sessionStorage: storage };
});

afterEach(() => {
  delete globalThis.window;
});

/**
 * Plants a raw string under the module's own key. The key is private to
 * handoff.js, so it is discovered through a real stash rather than duplicated
 * here — a renamed key should not need this file edited to keep passing.
 */
function seedRaw(raw) {
  stashHandoff({ text: "discovering the key" });
  const [key] = [...storage.entries.keys()];
  storage.entries.set(key, raw);
}

describe("the screener → analyser handover", () => {
  it("hands the sample over once, verbatim, and then erases it", () => {
    // The analyser drops this straight into a textarea the educator proofreads
    // against the original handwriting, so line breaks and edge whitespace have
    // to survive: reformatting the transcription changes what is being checked.
    const transcription = "  the kat sat\non teh mat  ";

    expect(stashHandoff({ text: transcription, writerAge: 8 })).toBe(true);
    expect(takeHandoff()).toEqual({ text: transcription, writerAge: 8 });

    // A second visit to the analyser must start empty. This is the whole reason
    // the payload is not a query string, so it is the one behaviour that would
    // leak one child's writing into another child's session if it regressed.
    expect(takeHandoff()).toBeNull();
    expect(storage.entries.size).toBe(0);
  });

  it("refuses a sample with nothing in it and writes nothing at all", () => {
    // The screener calls this with `result?.transcription`, so an absent or
    // whitespace-only transcription arrives here in the normal course of
    // things; a stored blank would put the analyser into its "filled in from
    // the screening you just ran" state with an empty box.
    expect(stashHandoff({ text: undefined })).toBe(false);
    expect(stashHandoff({ text: "   \n  " })).toBe(false);
    expect(stashHandoff()).toBe(false);

    expect(storage.entries.size).toBe(0);
  });

  it("reports failure rather than throwing when storage itself is hostile", () => {
    // Safari private browsing hands back a sessionStorage with a zero quota
    // that throws on write. The click handler pushes to /analysis right after
    // this call, so a throw would strand the educator on the screener.
    globalThis.window = { sessionStorage: fakeSessionStorage({ throws: ["setItem"] }) };
    expect(stashHandoff({ text: "a real sample" })).toBe(false);

    globalThis.window = { sessionStorage: fakeSessionStorage({ throws: ["getItem"] }) };
    expect(takeHandoff()).toBeNull();
  });

  it("is inert when there is no storage to reach", () => {
    // Both call sites live in client components that Next still renders on the
    // server, and a browser with site data blocked throws on the property
    // access itself rather than returning null.
    delete globalThis.window;
    expect(stashHandoff({ text: "a real sample" })).toBe(false);
    expect(takeHandoff()).toBeNull();

    globalThis.window = {
      get sessionStorage() {
        throw new Error("access to storage is denied");
      },
    };
    expect(stashHandoff({ text: "a real sample" })).toBe(false);
    expect(takeHandoff()).toBeNull();
  });

  it("clears an unparseable entry before parsing it", () => {
    seedRaw("{ this is not json");

    expect(takeHandoff()).toBeNull();
    // Ordering, not just the null: removing after a successful parse would
    // leave the bad entry in place and break every later visit to the analyser
    // in this tab, with no way for the educator to clear it.
    expect(storage.entries.size).toBe(0);
    expect(takeHandoff()).toBeNull();
  });

  it("ignores an entry that is not the shape it wrote", () => {
    // sessionStorage is editable from devtools and outlives a deploy, so an
    // entry can be well-formed JSON and still be nothing like a handover.
    const notHandovers = [
      JSON.stringify({ writerAge: 9 }),
      JSON.stringify({ text: 42 }),
      JSON.stringify({ text: "   " }),
      JSON.stringify(null),
      JSON.stringify("just a bare string"),
    ];

    for (const raw of notHandovers) {
      seedRaw(raw);
      expect(takeHandoff(), `should reject ${raw}`).toBeNull();
    }
  });

  it("hands back only a usable writer age, and null for everything else", () => {
    // The analyser does `if (writerAge !== null) setWriterAge(String(...))`, so
    // any value that survives as a non-age lands as literal text in the age
    // field and is then sent on to the next analysis.
    stashHandoff({ text: "a real sample" });
    expect(takeHandoff().writerAge).toBeNull();

    // The screener computes the age with Number(), so an unparseable entry in
    // the age box reaches this module as NaN.
    stashHandoff({ text: "a real sample", writerAge: Number("nine") });
    expect(takeHandoff().writerAge).toBeNull();

    stashHandoff({ text: "a real sample", writerAge: 0 });
    expect(takeHandoff().writerAge).toBeNull();

    stashHandoff({ text: "a real sample", writerAge: 7 });
    expect(takeHandoff().writerAge).toBe(7);
  });
});
