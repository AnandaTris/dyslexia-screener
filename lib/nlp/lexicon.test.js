/**
 * Planned Unit Test — NLP pipeline stage 4: the Hunspell matcher.
 *
 * From the test plan: "The T5 model and Hunspell dictionary are local, so these
 * run against the real local artefacts without network mocking."
 *
 * So there are no doubles here. `dictionary-en` and the CMU pronouncing
 * dictionary are npm dependencies on disk, and every assertion below is made
 * against the real ones — a stub would only test the stub's opinion of which
 * words exist, which is the one thing this stage is for.
 */

import { describe, expect, it } from "vitest";
import {
  editDistance,
  isCommonNoun,
  isRealWord,
  scoreCandidate,
  suggestTargets,
} from "./lexicon.js";

describe("isRealWord", () => {
  it("accepts a word in the dictionary and rejects a misspelling", () => {
    expect(isRealWord("friend")).toBe(true);
    expect(isRealWord("frend")).toBe(false);
  });

  it("accepts a capitalised word in either casing", () => {
    expect(isRealWord("Friend")).toBe(true);
  });

  it("rejects input with no letters in it", () => {
    expect(isRealWord("123")).toBe(false);
    expect(isRealWord("")).toBe(false);
  });
});

describe("isCommonNoun", () => {
  it("rejects proper nouns that only exist capitalised", () => {
    // This is what keeps the star name "Enif" out of the candidate list for
    // "enuf" — Hunspell accepts it, but no child meant to write it.
    expect(isCommonNoun("Enif")).toBe(false);
    expect(isCommonNoun("enough")).toBe(true);
  });
});

describe("editDistance", () => {
  it("counts single-character edits", () => {
    expect(editDistance("enuf", "enough")).toBe(3);
    expect(editDistance("cat", "cat")).toBe(0);
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("suggestTargets", () => {
  it("reconstructs an orthographic neighbour", () => {
    const [best] = suggestTargets("frend");

    expect(best.word).toBe("friend");
    expect(best.via).toBe("orthographic");
  });

  it("reconstructs a target the letters alone cannot reach", () => {
    // "enuf" is three letter-edits from "enough" and "wisle" is three from
    // "whistle". Only the phonetic index gets there, which is the whole reason
    // it is consulted on every word rather than as a fallback.
    expect(suggestTargets("enuf")[0]).toMatchObject({ word: "enough", via: "phonetic" });
    expect(suggestTargets("wisle")[0]).toMatchObject({ word: "whistle", via: "phonetic" });
  });

  it("returns candidates best-first and honours maxCandidates", () => {
    const candidates = suggestTargets("brite", { maxCandidates: 3 });

    expect(candidates).toHaveLength(3);
    expect(candidates[0].word).toBe("bright");
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].score).toBeGreaterThanOrEqual(candidates[i].score);
    }
  });

  it("returns nothing for input too short to reconstruct", () => {
    expect(suggestTargets("a")).toEqual([]);
    expect(suggestTargets("")).toEqual([]);
  });
});

describe("scoreCandidate", () => {
  it("prefers the phonetically identical candidate over the orthographically closer one", () => {
    // "nite" is one letter from "nice" and three from "night". Sound has to win,
    // or every phonetic misspelling gets reconstructed as the wrong word.
    expect(scoreCandidate("nite", "night")).toBeGreaterThan(scoreCandidate("nite", "nice"));
  });
});
