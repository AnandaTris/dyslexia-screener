/**
 * Planned Unit Test — NLP pipeline stage 4: the phoneme metric.
 *
 * This module is where "still sounds like the target" is decided, and that one
 * number is what routes an error to phonological rather than orthographic. So
 * the tests here pin the *shape* of the scale rather than a catalogue of pairs:
 * identity is free, the metric is symmetric, nothing outside the table costs
 * more than losing the phoneme, and featurally near confusions rank below far
 * ones. Those four properties are what every caller assumes, and a table edit
 * that quietly broke one of them would reroute errors without failing anything.
 *
 * The sequence-level tests are stated against PHONETIC_PLAUSIBILITY_THRESHOLD
 * rather than hard-coded numbers, because the contract is "which side of the
 * line does this land on", not "what exactly does it score".
 */

import { describe, expect, it } from "vitest";
import {
  IS_CONSONANT,
  IS_VOWEL,
  bestPhonemeMatch,
  normalisePhonemes,
  phonemeDistance,
  phonemeSequenceDistance,
} from "./phonemes.js";
import { PHONETIC_PLAUSIBILITY_THRESHOLD } from "./taxonomy.js";

const VOWELS = ["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"];
const CONSONANTS = [
  "P", "B", "T", "D", "K", "G", "CH", "JH", "F", "V", "TH", "DH",
  "S", "Z", "SH", "ZH", "HH", "M", "N", "NG", "L", "R", "W", "Y",
];
const INVENTORY = [...VOWELS, ...CONSONANTS];

/**
 * Every unordered pair including the reflexive ones. The properties below hold
 * over the whole table, so stating them exhaustively is both cheaper to read
 * and stricter than picking examples — and a failure names the offending pair.
 */
function everyPair(from = INVENTORY) {
  const pairs = [];
  for (let i = 0; i < from.length; i++) {
    for (let j = i; j < from.length; j++) pairs.push([from[i], from[j]]);
  }
  return pairs;
}

describe("phonemeDistance", () => {
  it("costs nothing for a phoneme against itself and nothing else", () => {
    expect(INVENTORY.filter((p) => phonemeDistance(p, p) !== 0)).toEqual([]);

    // Two different sounds scoring zero would be invisible to the aligner: a
    // genuine substitution error would reach the classifier as a perfect match
    // and be counted as evidence that phoneme processing is intact.
    const falseZeros = everyPair().filter(([a, b]) => a !== b && phonemeDistance(a, b) === 0);
    expect(falseZeros).toEqual([]);
  });

  it("is symmetric at both the phoneme and the sequence level", () => {
    const asymmetric = everyPair().filter(([a, b]) => phonemeDistance(a, b) !== phonemeDistance(b, a));
    expect(asymmetric).toEqual([]);

    // The branches most likely to be written one-way are the ones that escape
    // the two feature tables: the cross-category syllabic rule and the
    // fall-through for a token that is in neither table.
    expect(phonemeDistance("ER", "R")).toBe(phonemeDistance("R", "ER"));
    expect(phonemeDistance("T", "QQ")).toBe(phonemeDistance("QQ", "T"));

    // analyze.js asks "do these two spellings sound the same?" with no
    // canonical argument order, so the sequence metric has to agree either way.
    const target = ["S", "T", "R", "IY", "T"];
    const produced = ["S", "R", "EH", "T"];
    expect(phonemeSequenceDistance(target, produced).distance).toBe(
      phonemeSequenceDistance(produced, target).distance,
    );
  });

  it("never charges more for a substitution than for dropping the phoneme", () => {
    // Insertion and deletion cost exactly 1 in the aligner. A substitution
    // priced above that would make delete-then-insert the cheaper explanation
    // of a swapped sound, and would push similarity below zero.
    const outOfRange = everyPair().filter(([a, b]) => {
      const cost = phonemeDistance(a, b);
      return !(cost >= 0 && cost <= 1);
    });
    expect(outOfRange).toEqual([]);
  });

  it("ranks consonant confusions by how many articulatory features moved", () => {
    // Voicing is the one contrast typical spellers slip on too, so every
    // voiced/voiceless counterpart is priced identically and cheaply.
    for (const [a, b] of [["P", "B"], ["T", "D"], ["K", "G"], ["F", "V"], ["TH", "DH"], ["S", "Z"], ["SH", "ZH"], ["CH", "JH"]]) {
      expect(phonemeDistance(a, b)).toBe(0.15);
    }

    // /t/ measured against, in order: itself voiced, a stop at another place,
    // a fricative at the same place, an unrelated consonant, and a vowel.
    const ladder = [["T", "D"], ["T", "K"], ["T", "S"], ["T", "M"], ["T", "IY"]];
    const costs = ladder.map(([a, b]) => phonemeDistance(a, b));
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i]).toBeGreaterThan(costs[i - 1]);
    }
    // A vowel written where a consonant belongs is the one full-price error.
    expect(costs.at(-1)).toBe(1);

    // Stops and affricates share a closure, so /t/ -> /ch/ has to sit below a
    // manner change that shares nothing but place.
    expect(phonemeDistance("T", "CH")).toBeLessThan(phonemeDistance("T", "S"));
  });

  it("keeps vowel confusions cheap, with unstressed reduction cheapest of all", () => {
    // Any two of these can surface as the same reduced vowel in an unstressed
    // syllable, so confusing them says nothing about phoneme processing.
    const reductions = everyPair(["AH", "IH", "ER", "UH"]).filter(([a, b]) => a !== b);
    for (const [a, b] of reductions) expect(phonemeDistance(a, b)).toBe(0.08);

    const vowelPairs = everyPair(VOWELS).filter(([a, b]) => a !== b);
    const cheapest = Math.min(...vowelPairs.map(([a, b]) => phonemeDistance(a, b)));
    expect(cheapest).toBe(0.08);

    // Height and backness are graded, so near neighbours must beat far ones.
    expect(phonemeDistance("IY", "IH")).toBeLessThan(phonemeDistance("IY", "UW"));
    expect(phonemeDistance("EH", "AE")).toBeLessThan(phonemeDistance("IY", "AA"));

    // English spells one vowel a dozen ways, so even the worst vowel mismatch
    // has to stay clear of the price of a lost phoneme — otherwise a spelling
    // like "definate" would be scored as if a sound had gone missing.
    const worst = Math.max(...vowelPairs.map(([a, b]) => phonemeDistance(a, b)));
    expect(worst).toBeLessThanOrEqual(0.65);
    expect(worst).toBeLessThan(phonemeDistance("IY", "T"));
  });

  it("does not charge a lost phoneme for a syllabic /r/ written without its vowel", () => {
    // "betr" for "better" writes exactly the sounds of the target; ER and R are
    // one segment here, so the pair has to stay on the plausible side of the
    // line rather than being reported as a dropped phoneme.
    const result = phonemeSequenceDistance(["B", "EH", "T", "R"], ["B", "EH", "T", "ER"]);
    expect(result.similarity).toBeGreaterThanOrEqual(PHONETIC_PLAUSIBILITY_THRESHOLD);
    expect(result.ops).toEqual([{ op: "sub", from: "R", to: "ER" }]);

    // The exception is deliberately narrow: any other vowel/consonant pairing
    // is still a category error at full price.
    expect(phonemeDistance("AH", "R")).toBe(1);
  });
});

describe("IS_VOWEL / IS_CONSONANT", () => {
  it("partition the full ARPAbet inventory with no gaps or overlap", () => {
    // classify.js counts dropped consonants as everything that is `!IS_VOWEL`,
    // so a vowel missing from the table would be tallied as a consonant and
    // turn a vowel omission into a reported cluster reduction.
    expect(VOWELS.filter((p) => !IS_VOWEL(p) || IS_CONSONANT(p))).toEqual([]);
    expect(CONSONANTS.filter((p) => !IS_CONSONANT(p) || IS_VOWEL(p))).toEqual([]);
    expect(INVENTORY).toHaveLength(39);

    // Membership is tested with Object.hasOwn rather than `in`, so inherited
    // keys cannot masquerade as phonemes.
    expect(IS_VOWEL("constructor")).toBe(false);
    expect(IS_CONSONANT("toString")).toBe(false);

    // Stress has to be stripped before a lookup; this is why every entry point
    // into the metric runs normalisePhonemes first.
    expect(IS_VOWEL("IY1")).toBe(false);
  });
});

describe("phonemeSequenceDistance", () => {
  it("treats the stressed CMU string and the bare array as the same pronunciation", () => {
    const friend = ["F", "R", "EH", "N", "D"];
    const perfect = { distance: 0, similarity: 1, ops: [] };

    expect(phonemeSequenceDistance(friend, friend)).toEqual(perfect);
    // Lexicon lookups hand over raw CMU entries ("F R EH1 N D") while the
    // rule-based path produces arrays; both have to compare as identical.
    expect(phonemeSequenceDistance("F R EH1 N D", friend)).toEqual(perfect);
    expect(normalisePhonemes("  F R EH1 N D  ")).toEqual(friend);
  });

  it("puts a dropped phoneme below the plausibility line and a substituted one above it", () => {
    const street = ["S", "T", "R", "IY", "T"];

    // Substitutions are feature-scaled, so a wrong vowel or a voicing slip is
    // absorbed by the rest of the word and the spelling still "sounds right".
    expect(phonemeSequenceDistance(["S", "T", "R", "IH", "T"], street).similarity)
      .toBeGreaterThanOrEqual(PHONETIC_PLAUSIBILITY_THRESHOLD);
    expect(phonemeSequenceDistance(["S", "T", "R", "IY", "D"], street).similarity)
      .toBeGreaterThanOrEqual(PHONETIC_PLAUSIBILITY_THRESHOLD);

    // Losing /r/ costs a full unit and takes the pair below the line. This is
    // the whole phonological/orthographic split: "sret" lost a sound, "frend"
    // only spelled one differently.
    expect(phonemeSequenceDistance(["S", "T", "IY", "T"], street).similarity)
      .toBeLessThan(PHONETIC_PLAUSIBILITY_THRESHOLD);
  });

  it("orients the edit script from the produced word to the target", () => {
    const street = ["S", "T", "R", "IY", "T"];

    // classify.js reads "ins" as "present in the target, absent from what was
    // written" and looks the missing phoneme up under `to`. Flipping either
    // would turn a cluster reduction into a phoneme substitution.
    expect(phonemeSequenceDistance(["S", "T", "IY", "T"], street).ops)
      .toEqual([{ op: "ins", to: "R" }]);
    expect(phonemeSequenceDistance(street, ["S", "T", "IY", "T"]).ops)
      .toEqual([{ op: "del", from: "R" }]);

    // A substitution names both sides, and aligned matches are left out so the
    // script contains only what actually differs.
    expect(phonemeSequenceDistance(["S", "T", "R", "IH", "T"], street).ops)
      .toEqual([{ op: "sub", from: "IH", to: "IY" }]);
  });

  it("scores an empty pronunciation against a real one as no match at all", () => {
    // g2p can hand back nothing for a string with no pronounceable letters, and
    // that must read as zero evidence rather than a vacuous perfect match.
    const empty = phonemeSequenceDistance([], ["S", "T", "R", "IY", "T"]);
    expect(empty.similarity).toBe(0);
    expect(empty.distance).toBe(5);
  });
});

describe("bestPhonemeMatch", () => {
  it("takes the best reading of a spelling, not the first one", () => {
    const street = ["S", "T", "R", "IY", "T"];
    // The two plausible readings of "sret": <e> as /eh/ and as /iy/. Only the
    // second gets the vowel right, so asking whether the spelling *could* be
    // read as the target has to mean a maximum over readings.
    const best = bestPhonemeMatch([["S", "R", "EH", "T"], ["S", "R", "IY", "T"]], street);

    expect(best.variant).toEqual(["S", "R", "IY", "T"]);
    expect(best.similarity).toBe(
      phonemeSequenceDistance(["S", "R", "IY", "T"], street).similarity,
    );
    expect(best.similarity).toBeGreaterThan(
      phonemeSequenceDistance(["S", "R", "EH", "T"], street).similarity,
    );
  });

  it("reports no match when there are no readings to try", () => {
    // Callers compare the result against a threshold with >=, so defaulting to
    // a high similarity here would flip every unpronounceable string to
    // "sounds like the target" instead of leaving it to the phonological path.
    expect(bestPhonemeMatch([], ["S", "T", "R", "IY", "T"]).similarity).toBe(0);
  });
});
