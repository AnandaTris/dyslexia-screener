// Classifies one (produced, target) pair into the error taxonomy.
//
// The decision order is deliberate:
//   1. Both words real            -> homophone or word-choice, decided by sound.
//   2. Root intact, ending broken -> morphological, whatever the sounds do.
//   3. Explained purely by a swap
//      or a mirror-letter pair    -> visual.
//   4. Everything else            -> phonological or orthographic, split on
//                                    whether the misspelling still sounds like
//                                    the target.
//
// Step 4 is the load-bearing one. Every earlier step exists to stop a
// structurally explainable error from being scored as evidence about phoneme
// processing when it is really about something else.

import { characterAlignment } from "./align.js";
import { pronounce, pronounceVariants } from "./g2p.js";
import { isRealWord } from "./lexicon.js";
import { analyseMorphology } from "./morphology.js";
import { bestPhonemeMatch, IS_VOWEL } from "./phonemes.js";
import {
  ERROR_CATEGORIES,
  PHONETIC_PLAUSIBILITY_THRESHOLD,
  isMirrorPair,
} from "./taxonomy.js";

const VOWEL_LETTERS = new Set(["a", "e", "i", "o", "u", "y"]);

function describeSubtype(category, subtype) {
  return ERROR_CATEGORIES[category]?.subtypes?.[subtype] ?? null;
}

/** Which phonological subtype the phoneme-level edit script points at. */
function phonologicalSubtype(phonemeOps, producedPhonemes, targetPhonemes) {
  const deletions = phonemeOps.filter((o) => o.op === "ins"); // present in target, absent in produced
  const droppedVowels = deletions.filter((o) => IS_VOWEL(o.to));
  const droppedConsonants = deletions.filter((o) => !IS_VOWEL(o.to));

  if (targetPhonemes.length - producedPhonemes.length >= 2 && droppedVowels.length >= 1) {
    return "syllable_omission";
  }
  if (droppedConsonants.length >= 1 && droppedVowels.length === 0) {
    return "cluster_reduction";
  }
  if (droppedVowels.length >= 1) return "vowel_omission";
  return "phoneme_substitution";
}

/** Which orthographic subtype the letter-level edit script points at. */
function orthographicSubtype(charOps, produced, target) {
  const inserted = charOps.filter((o) => o.op === "insert").map((o) => o.to);
  const deleted = charOps.filter((o) => o.op === "delete").map((o) => o.from);
  const substituted = charOps.filter((o) => o.op === "substitute");

  // A letter present in the target but contributing no sound.
  if (inserted.length && inserted.every((c) => !VOWEL_LETTERS.has(c) || inserted.length === 1)) {
    const doubled = inserted.some((c, i) => target.includes(c + c) && !produced.includes(c + c));
    if (doubled) return "doubling";
  }
  if (deleted.some((c) => produced.includes(c + c)) || inserted.some((c) => target.includes(c + c))) {
    return "doubling";
  }
  if (inserted.some((c) => "hwgkbtel".includes(c))) return "silent_letter";
  if (substituted.some((o) => VOWEL_LETTERS.has(o.from) && VOWEL_LETTERS.has(o.to))) {
    return "vowel_pattern";
  }
  if (inserted.some((c) => VOWEL_LETTERS.has(c)) || deleted.some((c) => VOWEL_LETTERS.has(c))) {
    return "vowel_pattern";
  }
  return "phonetic_spelling";
}

/**
 * @param {object} input
 * @param {string} input.produced   the word as written
 * @param {string} input.target     the reconstructed intended word
 * @param {number} [input.targetConfidence] 0..1 confidence in the reconstruction
 * @param {object} [input.token]    the source token, for offsets
 * @param {string} [input.source]   which layer proposed this pair
 */
export function classifyError({ produced, target, targetConfidence = 0.6, token = null, source = "lexicon" }) {
  const p = String(produced).toLowerCase().replace(/[^a-z']/g, "");
  const t = String(target).toLowerCase().replace(/[^a-z']/g, "");

  if (!p || !t || p === t) return null;

  const producedIsWord = isRealWord(p);
  // A misspelling has to be pronounced by rule; looking it up would either fail
  // or, worse, silently return the pronunciation of a different real word.
  // Non-words are scored against every plausible reading, so that a spelling is
  // only called phonologically wrong when no reading of it reaches the target.
  const readings = producedIsWord ? [pronounce(p).phonemes] : pronounceVariants(p);
  const targetPron = pronounce(t);
  const phon = bestPhonemeMatch(readings, targetPron.phonemes);
  const producedPhonemes = phon.variant;
  const chars = characterAlignment(p, t);
  const morph = analyseMorphology(p, t);

  const evidence = {
    produced,
    target: t,
    producedPhonemes,
    targetPhonemes: targetPron.phonemes,
    phoneticSimilarity: Number(phon.similarity.toFixed(3)),
    soundsLikeTarget: phon.similarity >= PHONETIC_PLAUSIBILITY_THRESHOLD,
    editDistance: chars.distance,
    editOps: chars.ops,
    start: token?.start ?? null,
    end: token?.end ?? null,
    sentence: token?.sentence ?? null,
    source,
    targetConfidence: Number(targetConfidence.toFixed(2)),
  };

  const secondary = [];

  // 1. Both real words: sound decides between homophone and word choice.
  if (producedIsWord) {
    const category = phon.similarity >= 0.95 ? "homophone" : "grammatical";
    return {
      ...evidence,
      category,
      subtype: category === "homophone" ? "homophone_confusion" : "word_choice",
      subtypeLabel: describeSubtype(category, category === "homophone" ? "homophone_confusion" : "word_choice"),
      secondary,
      confidence: Number((targetConfidence * (category === "homophone" ? 0.9 : 0.6)).toFixed(2)),
    };
  }

  // 2. Root intact, ending broken.
  if (morph.affixError && morph.stemMatches) {
    if (!evidence.soundsLikeTarget) secondary.push("phonological");
    return {
      ...evidence,
      category: "morphological",
      subtype: morph.affixError,
      subtypeLabel: describeSubtype("morphological", morph.affixError),
      morphology: morph,
      secondary,
      confidence: Number((targetConfidence * 0.9).toFixed(2)),
    };
  }

  // 3. Explained entirely by a swap or a mirror-letter substitution.
  const substantiveOps = chars.ops.filter((o) => o.op !== "match");
  const visualOps = substantiveOps.filter(
    (o) => o.op === "transpose" || (o.op === "substitute" && isMirrorPair(o.from, o.to)),
  );
  if (visualOps.length && visualOps.length === substantiveOps.length && chars.distance <= 2) {
    const subtype = visualOps.some((o) => o.op === "transpose") ? "transposition" : "letter_reversal";
    if (!evidence.soundsLikeTarget) secondary.push("phonological");
    return {
      ...evidence,
      category: "visual",
      subtype,
      subtypeLabel: describeSubtype("visual", subtype),
      secondary,
      confidence: Number((targetConfidence * 0.85).toFixed(2)),
    };
  }
  if (visualOps.length) secondary.push("visual");

  // 4. Sound preserved or not — the phonological / surface split.
  if (evidence.soundsLikeTarget) {
    const subtype = orthographicSubtype(chars.ops, p, t);
    return {
      ...evidence,
      category: "orthographic",
      subtype,
      subtypeLabel: describeSubtype("orthographic", subtype),
      secondary,
      // Confidence rises the further the pair sits above the plausibility line.
      confidence: Number(
        (targetConfidence *
          (0.6 + 0.4 * Math.min(1, (phon.similarity - PHONETIC_PLAUSIBILITY_THRESHOLD) / 0.15))
        ).toFixed(2),
      ),
    };
  }

  const subtype = phonologicalSubtype(phon.ops, producedPhonemes, targetPron.phonemes);
  return {
    ...evidence,
    category: "phonological",
    subtype,
    subtypeLabel: describeSubtype("phonological", subtype),
    phonemeOps: phon.ops,
    secondary,
    confidence: Number(
      (targetConfidence *
        (0.6 + 0.4 * Math.min(1, (PHONETIC_PLAUSIBILITY_THRESHOLD - phon.similarity) / 0.3))
      ).toFixed(2),
    ),
  };
}
