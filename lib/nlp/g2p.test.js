/**
 * Planned Unit Test — NLP pipeline stage 4b: grapheme-to-phoneme.
 *
 * This module is the crux of the whole phonological-vs-surface claim. You cannot
 * tell "sounds right, looks wrong" from "the sounds themselves broke" without the
 * pronunciation of the *misspelling*, and a misspelling is in no dictionary. So
 * the two paths are tested separately — CMU lookup for real words, the rule
 * engine for everything else — and then the boundary between them, which is
 * where the design actually lives: the rule engine is allowed to be wrong about
 * irregular real words precisely because they never reach it.
 *
 * Assertions are exact phoneme sequences rather than "contains a T". A rule
 * engine that drifts one phoneme is a rule engine that reclassifies a child, so
 * the sequence is the contract, not an approximation of it.
 *
 * No doubles: it runs against the real CMU artefact, as the plan specifies.
 */

import { describe, expect, it } from "vitest";
import {
  pronounce,
  pronounceByRule,
  pronounceFromDictionary,
  pronounceVariants,
} from "./g2p.js";
import { bestPhonemeMatch, phonemeSequenceDistance } from "./phonemes.js";
import { PHONETIC_PLAUSIBILITY_THRESHOLD } from "./taxonomy.js";

describe("pronounceFromDictionary — the CMU path", () => {
  it("returns a stress-free ARPAbet array for a real word and null for a non-word", () => {
    // CMU stores "IH0 N AH1 F" as one stressed string. Everything downstream
    // compares segment by segment, so the split and the stress strip are part of
    // this function's contract, not a caller's problem.
    expect(pronounceFromDictionary("enough")).toEqual(["IH", "N", "AH", "F"]);
    expect(pronounceFromDictionary("ENOUGH")).toEqual(["IH", "N", "AH", "F"]);

    // null, not [], is what tells pronounce() to fall through to the rules.
    expect(pronounceFromDictionary("enuf")).toBeNull();
    expect(pronounceFromDictionary("sret")).toBeNull();
  });

  it("looks up contractions with the apostrophe intact", () => {
    // Tokenisation keeps internal apostrophes ("don't") and the classifier keeps
    // them too, so contractions really do arrive here. CMU keys them with the
    // apostrophe; stripping punctuation for symmetry with the rule engine would
    // silently demote every contraction in the text to a rule-engine guess.
    expect(pronounceFromDictionary("don't")).toEqual(["D", "OW", "N", "T"]);
    expect(pronounceFromDictionary("dont")).toBeNull();
  });
});

describe("pronounceByRule — the rule engine", () => {
  it("pronounces misspellings that no dictionary contains", () => {
    expect(pronounceByRule("enuf")).toEqual(["EH", "N", "AH", "F"]);

    // The point of the sret example: the /t/ of the /str/ cluster is simply not
    // in the output. If the engine ever hallucinated it back, the phonological
    // subtype would lose its only mechanical evidence.
    expect(pronounceByRule("sret")).toEqual(["S", "R", "EH", "T"]);
    expect(pronounceByRule("street")).toEqual(["S", "T", "R", "IY", "T"]);
  });

  it("takes the longest matching grapheme, not the first one declared", () => {
    // "ight" must beat i + ght, and "ought" must beat "ough" + t. Rule ordering
    // is computed by rank rather than trusted from the array's order, so a rule
    // appended at the end of RULES cannot quietly outrank a longer one.
    expect(pronounceByRule("night")).toEqual(["N", "AY", "T"]);
    expect(pronounceByRule("thought")).toEqual(["TH", "AO", "T"]);
  });

  it("fires context-sensitive rules only inside their context", () => {
    // Split-digraph ("magic e"): the same letter is a different vowel depending
    // on what follows it three characters later.
    expect(pronounceByRule("hop")).toEqual(["HH", "AA", "P"]);
    expect(pronounceByRule("hope")).toEqual(["HH", "OW", "P"]);

    // "kn" is silent-k only word-initially; anchoring the left context is what
    // stops "darkness" from losing its /k/.
    expect(pronounceByRule("knot")).toEqual(["N", "AA", "T"]);
    expect(pronounceByRule("darkness")).toEqual(["D", "AA", "R", "K", "N", "AH", "S"]);
  });

  it("reads -ed as a suffix only when a stem precedes it", () => {
    // The guard the source calls out: without a vowel earlier in the word, "bed"
    // and "sed" would parse as stem + past-tense -ed and come out vowel-less,
    // which would make two of the commonest child spellings unpronounceable.
    expect(pronounceByRule("bed")).toEqual(["B", "EH", "D"]);
    expect(pronounceByRule("sed")).toEqual(["S", "EH", "D"]);

    // Where there is a stem, -ed assimilates: /t/ after a voiceless consonant,
    // a full syllable after t/d. "jumpt" for "jumped" is only recognisable as a
    // sound-spelled affix because both sides land on the same phonemes.
    expect(pronounceByRule("jumped")).toEqual(["JH", "AH", "M", "P", "T"]);
    expect(pronounceByRule("jumpt")).toEqual(pronounceByRule("jumped"));
    expect(pronounceByRule("wanted")).toEqual(["W", "AE", "N", "T", "IH", "D"]);
  });

  it("ignores case and anything that is not a letter", () => {
    // Callers hand it raw token text, including fragments of split words and
    // stray punctuation, and a G2P failure must never abort an analysis.
    const expected = ["S", "R", "EH", "T"];
    expect(pronounceByRule("SRET")).toEqual(expected);
    expect(pronounceByRule("s-r-e-t")).toEqual(expected);
    expect(pronounceByRule("  sret  ")).toEqual(expected);
    expect(pronounceByRule("")).toEqual([]);
    expect(pronounceByRule("123")).toEqual([]);
  });
});

describe("pronounceVariants — ambiguous single vowels", () => {
  it("offers the long-vowel reading alongside the base one, base first", () => {
    // "hom" is the documented case: readable with the vowel of hot or of home.
    // Base-first is a contract — callers that want the engine's single best
    // guess take element 0.
    expect(pronounceVariants("hom")).toEqual([
      ["HH", "AA", "M"],
      ["HH", "OW", "M"],
    ]);

    // A spelling with no ambiguous vowel must not be inflated into alternatives;
    // "could this be read as the target" is then a single question.
    expect(pronounceVariants("street")).toEqual([["S", "T", "R", "IY", "T"]]);
    expect(pronounceVariants("enuf")).toHaveLength(4);
  });

  it("collapses to the two extremes past three ambiguous vowels", () => {
    // Four swappable vowels would be sixteen readings, and a set that large will
    // match almost anything — the comparison is a maximum, so every extra
    // reading can only push similarity up. Degrading to all-short / all-long
    // keeps the phonological verdict from being bought with combinatorics.
    const variants = pronounceVariants("catamaran");

    expect(variants).toHaveLength(2);
    expect(variants[0]).toEqual(pronounceByRule("catamaran"));
    expect(variants[1]).toEqual(["K", "EY", "T", "EY", "M", "OW", "R", "EY", "N"]);
  });
});

describe("pronounce — the boundary between dictionary and rules", () => {
  it("prefers CMU wherever the rule engine would disagree, and says which it used", () => {
    // The rule set is deliberately a compact regular subset: it reads "though"
    // as if it rhymed with "enough". That is acceptable *only* because a real
    // word never reaches it, so this pair is the load-bearing check on the
    // routing rather than a complaint about the rules.
    expect(pronounceByRule("though")).toEqual(["TH", "AH", "F"]);
    expect(pronounce("though")).toEqual({ phonemes: ["DH", "OW"], source: "cmu" });

    expect(pronounce("enuf")).toEqual({ phonemes: ["EH", "N", "AH", "F"], source: "rules" });
  });

  it("keeps the commonest homophone pair in English identical", () => {
    // analyze.js gates run-together and neural pairs on pronounce() rather than
    // the rule engine for exactly this reason: by rule, their and there diverge
    // badly and the most frequent real confusion in the corpus would score below
    // every threshold in the pipeline.
    expect(pronounce("their").phonemes).toEqual(pronounce("there").phonemes);
    expect(pronounceByRule("their")).not.toEqual(pronounceByRule("there"));
  });
});

describe("the worked examples the phonological/surface split rests on", () => {
  // Reproduces exactly what classifyError does with a non-word: score every
  // plausible reading of the misspelling against the target's pronunciation and
  // keep the best.
  const soundsLike = (produced, target) =>
    bestPhonemeMatch(pronounceVariants(produced), pronounce(target).phonemes).similarity;

  it("scores enuf as a plausible reading of enough and sret as an implausible reading of street", () => {
    expect(soundsLike("enuf", "enough")).toBeGreaterThanOrEqual(PHONETIC_PLAUSIBILITY_THRESHOLD);
    expect(soundsLike("sret", "street")).toBeLessThan(PHONETIC_PLAUSIBILITY_THRESHOLD);

    // The dropped /t/ is the entire difference: restore it and the same
    // machinery calls the spelling a perfect phonetic match.
    expect(soundsLike("stret", "street")).toBe(1);
  });

  it("does not let variant readings rescue a spelling that lost a phoneme", () => {
    // The variants exist to forgive vowel ambiguity, not consonant deletion. If
    // any reading of "sret" cleared the bar, cluster reduction would be reported
    // as an orthographic slip and the phonological profile would go missing.
    const target = pronounce("street").phonemes;

    for (const reading of pronounceVariants("sret")) {
      expect(phonemeSequenceDistance(reading, target).similarity)
        .toBeLessThan(PHONETIC_PLAUSIBILITY_THRESHOLD);
    }
  });

  it("puts a rule-engine reading on the same scale as a CMU one", () => {
    // The lexicon ranks candidates by comparing a rule-engine reading of the
    // misspelling against CMU pronunciations, so the two paths have to be
    // commensurable. "nite" is three letter-edits from "night" and one from
    // "nice", and only the phonetics separate them.
    expect(pronounceByRule("nite")).toEqual(pronounceFromDictionary("night"));
    expect(soundsLike("nite", "night")).toBe(1);
    expect(soundsLike("nite", "nice")).toBeLessThan(1);
  });
});
