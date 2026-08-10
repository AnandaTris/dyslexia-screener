/**
 * Planned Unit Test — NLP pipeline: character and token alignment.
 *
 * Alignment is the stage every later stage reads. classify.js decides "visual /
 * transposition" purely from the shape of `ops`, and analyze.js uses
 * `op.sourceIndex` to point a neural correction back at a real token, so an
 * off-by-one here does not crash — it quietly attributes an error to the wrong
 * letter or the wrong word. These tests therefore pin the *indices* as hard as
 * they pin the operation names.
 *
 * The transposition cases carry the most weight: an adjacent swap costing one
 * operation instead of two is the only thing separating this from plain
 * Levenshtein, and it is the whole reason the visual-error branch can fire.
 */

import { describe, expect, it } from "vitest";
import { characterAlignment, tokenAlignment } from "./align.js";

/**
 * Rebuilds `target` by walking the edit script over `source`.
 *
 * Asserting on individual ops proves each one is individually plausible; only a
 * replay proves they are mutually consistent, because a single drifting `at`
 * makes the script stop describing the pair it came from.
 */
function replay(source, ops) {
  let out = "";
  let cursor = 0;

  for (const op of ops) {
    out += source.slice(cursor, op.at);
    cursor = op.at;
    if (op.op === "substitute") {
      out += op.to;
      cursor += 1;
    } else if (op.op === "transpose") {
      out += op.to;
      cursor += 2;
    } else if (op.op === "delete") {
      cursor += 1;
    } else {
      // An insertion sits *before* the source character at `at`, so the cursor
      // does not advance — the character it precedes is still to be copied.
      out += op.to;
    }
  }

  return out + source.slice(cursor);
}

describe("characterAlignment", () => {
  it("charges an adjacent swap one operation instead of two substitutions", () => {
    // Plain Levenshtein scores every one of these 2, as two independent
    // substitutions, and classify.js would then see no transposition at all.
    expect(characterAlignment("gril", "girl")).toEqual({
      distance: 1,
      ops: [{ op: "transpose", from: "ri", to: "ir", at: 1 }],
    });

    // At the very start of the word, where the swap has no preceding match to
    // anchor it — the i > 1 / j > 1 guard in the DP is one off-by-one away from
    // refusing to consider this cell at all.
    expect(characterAlignment("hte", "the")).toEqual({
      distance: 1,
      ops: [{ op: "transpose", from: "ht", to: "th", at: 0 }],
    });

    // And spanning the whole string, where the swap is the entire alignment.
    expect(characterAlignment("ab", "ba")).toEqual({
      distance: 1,
      ops: [{ op: "transpose", from: "ab", to: "ba", at: 0 }],
    });
  });

  it("refuses to call a non-adjacent swap a transposition", () => {
    // "saw"/"was" reads like a reversal but the moved letters are two apart, so
    // it is genuinely two substitutions. Reporting a transpose here would let
    // the visual branch of the classifier claim a swap that never happened.
    expect(characterAlignment("saw", "was")).toEqual({
      distance: 2,
      ops: [
        { op: "substitute", from: "s", to: "w", at: 0 },
        { op: "substitute", from: "w", to: "s", at: 2 },
      ],
    });
  });

  it("indexes substitutions at the first and last character", () => {
    expect(characterAlignment("bog", "dog").ops).toEqual([
      { op: "substitute", from: "b", to: "d", at: 0 },
    ]);
    expect(characterAlignment("cat", "car").ops).toEqual([
      { op: "substitute", from: "t", to: "r", at: 2 },
    ]);
  });

  it("indexes an insertion by the source position it precedes, including past the end", () => {
    // Appending is the boundary that has no source character to point at: `at`
    // has to be source.length, not the last valid index.
    expect(characterAlignment("cat", "cats").ops).toEqual([{ op: "insert", to: "s", at: 3 }]);
    expect(characterAlignment("at", "cat").ops).toEqual([{ op: "insert", to: "c", at: 0 }]);
  });

  it("indexes a deletion by the character it removes, at either end", () => {
    expect(characterAlignment("cats", "cat").ops).toEqual([{ op: "delete", from: "s", at: 3 }]);
    expect(characterAlignment("cat", "at").ops).toEqual([{ op: "delete", from: "c", at: 0 }]);
  });

  it("emits nothing at all for characters that already agree", () => {
    // classify.js counts `ops` to decide whether a swap explains the *whole*
    // error, so unchanged characters must not appear as ops of any kind.
    expect(characterAlignment("same", "same")).toEqual({ distance: 0, ops: [] });
    expect(characterAlignment("", "")).toEqual({ distance: 0, ops: [] });
  });

  it("degenerates to a pure insert or pure delete script against an empty string", () => {
    expect(characterAlignment("", "abc")).toEqual({
      distance: 3,
      ops: [
        { op: "insert", to: "a", at: 0 },
        { op: "insert", to: "b", at: 0 },
        { op: "insert", to: "c", at: 0 },
      ],
    });
    // Deletions keep climbing because `at` names a position in the *source*,
    // which is not consumed as the script is applied.
    expect(characterAlignment("abc", "").ops).toEqual([
      { op: "delete", from: "a", at: 0 },
      { op: "delete", from: "b", at: 1 },
      { op: "delete", from: "c", at: 2 },
    ]);
  });

  it("produces a script that replays back into the target, one unit of distance per op", () => {
    const pairs = [
      ["gril", "girl"],
      ["freind", "friend"],
      ["becuase", "because"],
      // Mixes an insertion and a substitution that land on the same `at`, so the
      // relative order of the two ops is load-bearing, not incidental.
      ["enuf", "enough"],
      ["walkt", "walked"],
      ["sret", "street"],
      ["saw", "was"],
      ["cat", "cats"],
      ["abc", ""],
      ["", "abc"],
    ];

    for (const [source, target] of pairs) {
      const { distance, ops } = characterAlignment(source, target);

      expect(replay(source, ops)).toBe(target);
      // Every operation this model emits costs exactly 1, so a mismatch means
      // the traceback dropped an op or the transpose was double-charged.
      expect(ops).toHaveLength(distance);
    }
  });

  it("coerces non-string input rather than throwing", () => {
    // classify.js hands over whatever the token layer produced; a null target
    // reaching the DP as `undefined.length` would take the whole report down.
    expect(characterAlignment(12, 13).ops).toEqual([
      { op: "substitute", from: "2", to: "3", at: 1 },
    ]);
  });
});

describe("tokenAlignment", () => {
  it("keeps sourceIndex pointing at the writer's token when the corrector adds a word", () => {
    // This is the failure analyze.js cannot survive: it looks the token up with
    // sentenceTokens[op.sourceIndex], so if an insertion earlier in the sentence
    // shifted the index, the misspelling would be reported against the wrong
    // word and highlighted at the wrong offsets.
    const ops = tokenAlignment(["a", "sand", "castel"], ["a", "big", "sand", "castle"]);

    expect(ops).toEqual([
      { op: "equal", sourceIndex: 0, targetIndex: 0, from: "a", to: "a" },
      { op: "insert", sourceIndex: null, targetIndex: 1, to: "big" },
      { op: "equal", sourceIndex: 1, targetIndex: 2, from: "sand", to: "sand" },
      { op: "replace", sourceIndex: 2, targetIndex: 3, from: "castel", to: "castle" },
    ]);
  });

  it("lets source and target indices drift apart across a deleted token", () => {
    const ops = tokenAlignment(["the", "big", "dog"], ["the", "dog"]);

    expect(ops).toEqual([
      { op: "equal", sourceIndex: 0, targetIndex: 0, from: "the", to: "the" },
      { op: "delete", sourceIndex: 1, targetIndex: null, from: "big" },
      // The surviving token is source 2 but target 1; collapsing these two into
      // one counter is the classic off-by-one at this level.
      { op: "equal", sourceIndex: 2, targetIndex: 1, from: "dog", to: "dog" },
    ]);
  });

  it("aligns a mid-sentence correction without disturbing its neighbours", () => {
    const ops = tokenAlignment(["i", "went", "to", "teh", "shop"], ["i", "went", "to", "the", "shop"]);

    expect(ops.filter((op) => op.op !== "equal")).toEqual([
      { op: "replace", sourceIndex: 3, targetIndex: 3, from: "teh", to: "the" },
    ]);
  });

  it("handles an empty side without inventing an op", () => {
    expect(tokenAlignment([], [])).toEqual([]);
    expect(tokenAlignment([], ["hello"])).toEqual([
      { op: "insert", sourceIndex: null, targetIndex: 0, to: "hello" },
    ]);
    expect(tokenAlignment(["hello"], [])).toEqual([
      { op: "delete", sourceIndex: 0, targetIndex: null, from: "hello" },
    ]);
  });
});
