// English grapheme-to-phoneme (G2P) conversion.
//
// Two paths:
//   1. Real words     -> looked up in the CMU Pronouncing Dictionary (135k words).
//   2. Non-words      -> a context-sensitive letter-to-sound rule engine.
//
// Path 2 is the one that matters. A misspelling like "enuf" is not in any
// dictionary, so the only way to ask "does this spelling still *sound* like the
// word the student meant?" is to pronounce the misspelling itself. That question
// is what distinguishes a surface/orthographic error (sounds right, looks wrong)
// from a phonological error (the sounds themselves are wrong).
//
// The rule set is a compact English subset in the tradition of the NRL
// letter-to-sound rules. It does not need to handle irregular real words —
// those never reach it, because they resolve through CMU first.

import { dictionary as CMU } from "cmu-pronouncing-dictionary";
import { normalisePhonemes } from "./phonemes.js";

const NOT_VOWEL = "[^aeiouy]";

// [grapheme, leftContext | null, rightContext | null, phonemes]
// Contexts are regexes matched against the text before / after the grapheme.
// Left contexts are anchored at the end, right contexts at the start.
const RULES = [
  // --- multi-letter endings and Latinate suffixes -------------------------
  ["ought", null, /^$/, ["AO", "T"]],
  ["ough", null, /^$/, ["AH", "F"]],
  ["ough", null, null, ["AH"]],
  ["tious", null, /^$/, ["SH", "AH", "S"]],
  ["cious", null, /^$/, ["SH", "AH", "S"]],
  ["tion", null, null, ["SH", "AH", "N"]],
  ["sion", /[aeiouy]$/, null, ["ZH", "AH", "N"]],
  ["sion", null, null, ["SH", "AH", "N"]],
  ["cian", null, null, ["SH", "AH", "N"]],
  ["cial", null, null, ["SH", "AH", "L"]],
  ["tial", null, null, ["SH", "AH", "L"]],
  ["ture", null, /^$/, ["CH", "ER"]],
  ["sure", null, /^$/, ["ZH", "ER"]],
  ["ment", null, /^$/, ["M", "AH", "N", "T"]],
  ["ness", null, /^$/, ["N", "AH", "S"]],
  ["ould", null, /^$/, ["UH", "D"]],
  ["eigh", null, null, ["EY"]],
  ["ight", null, null, ["AY", "T"]],
  ["ght", null, null, ["T"]],
  ["dge", null, /^$/, ["JH"]],
  ["tch", null, null, ["CH"]],
  ["ful", null, /^$/, ["F", "AH", "L"]],
  ["ous", null, /^$/, ["AH", "S"]],
  ["ing", null, /^$/, ["IH", "NG"]],

  // --- r-controlled vowels ------------------------------------------------
  ["air", null, null, ["EH", "R"]],
  ["eer", null, null, ["IH", "R"]],
  ["ear", null, /^$/, ["IH", "R"]],
  ["oor", null, null, ["AO", "R"]],
  ["our", null, null, ["AW", "R"]],
  ["are", null, /^$/, ["EH", "R"]],
  ["ore", null, /^$/, ["AO", "R"]],
  ["ure", null, /^$/, ["Y", "ER"]],
  ["ire", null, /^$/, ["AY", "ER"]],
  ["ar", null, null, ["AA", "R"]],
  ["or", null, null, ["AO", "R"]],
  ["er", null, null, ["ER"]],
  ["ir", null, null, ["ER"]],
  ["ur", null, null, ["ER"]],

  // --- vowel digraphs -----------------------------------------------------
  ["ai", null, null, ["EY"]],
  ["ay", null, null, ["EY"]],
  ["au", null, null, ["AO"]],
  ["aw", null, null, ["AO"]],
  ["ea", null, null, ["IY"]],
  ["ee", null, null, ["IY"]],
  ["ei", null, null, ["EY"]],
  ["eu", null, null, ["UW"]],
  ["ew", null, null, ["UW"]],
  ["ey", null, null, ["EY"]],
  ["ie", null, null, ["IY"]],
  ["oa", null, null, ["OW"]],
  ["oe", null, /^$/, ["OW"]],
  ["oi", null, null, ["OY"]],
  ["oy", null, null, ["OY"]],
  ["oo", null, null, ["UW"]],
  ["ou", null, null, ["AW"]],
  ["ow", null, /^$/, ["OW"]],
  ["ow", null, null, ["AW"]],
  ["ue", null, /^$/, ["UW"]],
  ["ui", null, null, ["UW"]],
  ["uy", null, null, ["AY"]],

  // --- consonant digraphs -------------------------------------------------
  ["ch", null, null, ["CH"]],
  ["sh", null, null, ["SH"]],
  ["ph", null, null, ["F"]],
  ["th", null, null, ["TH"]],
  ["wh", /^$/, null, ["W"]],
  ["ck", null, null, ["K"]],
  ["ng", null, null, ["NG"]],
  ["qu", null, null, ["K", "W"]],
  ["kn", /^$/, null, ["N"]],
  ["gn", /^$/, null, ["N"]],
  ["wr", /^$/, null, ["R"]],
  ["rh", /^$/, null, ["R"]],
  ["ps", /^$/, null, ["S"]],
  ["mb", null, /^$/, ["M"]],
  ["mn", null, /^$/, ["M"]],
  ["sc", null, /^[eiy]/, ["S"]],
  ["dg", null, /^[eiy]/, ["JH"]],
  ["gu", /^$/, /^[aeiou]/, ["G"]],

  // --- doubled consonants collapse to one phoneme -------------------------
  ["bb", null, null, ["B"]],
  ["cc", null, null, ["K"]],
  ["dd", null, null, ["D"]],
  ["ff", null, null, ["F"]],
  ["gg", null, null, ["G"]],
  ["kk", null, null, ["K"]],
  ["ll", null, null, ["L"]],
  ["mm", null, null, ["M"]],
  ["nn", null, null, ["N"]],
  ["pp", null, null, ["P"]],
  ["rr", null, null, ["R"]],
  ["ss", null, null, ["S"]],
  ["tt", null, null, ["T"]],
  ["zz", null, null, ["Z"]],

  // --- inflectional endings ------------------------------------------------
  // Each requires a vowel earlier in the stem, otherwise "sed" and "bed" get
  // read as stem + past-tense "-ed" and lose their vowel entirely.
  ["le", new RegExp(`[aeiouy][a-z]*${NOT_VOWEL}$`), /^$/, ["AH", "L"]],
  ["ed", /[aeiouy][a-z]*[td]$/, /^$/, ["IH", "D"]],
  ["ed", /[aeiouy][a-z]*(?:[pkfs]|ch|sh|th)$/, /^$/, ["T"]],
  ["ed", /[aeiouy][a-z]+$/, /^$/, ["D"]],
  ["es", /[aeiouy][a-z]*(?:[sxz]|ch|sh)$/, /^$/, ["IH", "Z"]],
  ["es", /[aeiouy][a-z]+$/, /^$/, ["Z"]],

  // --- single vowels: split-digraph ("magic e") first ----------------------
  ["a", null, new RegExp(`^${NOT_VOWEL}e$`), ["EY"]],
  ["e", null, new RegExp(`^${NOT_VOWEL}e$`), ["IY"]],
  ["i", null, new RegExp(`^${NOT_VOWEL}e$`), ["AY"]],
  ["o", null, new RegExp(`^${NOT_VOWEL}e$`), ["OW"]],
  ["u", null, new RegExp(`^${NOT_VOWEL}e$`), ["UW"]],
  ["e", new RegExp(`${NOT_VOWEL}$`), /^$/, []], // silent final e
  ["a", null, null, ["AE"]],
  ["e", null, null, ["EH"]],
  ["i", null, null, ["IH"]],
  ["o", null, null, ["AA"]],
  ["u", null, null, ["AH"]],
  ["y", /^$/, null, ["Y"]],
  ["y", null, /^$/, ["IY"]],
  ["y", null, null, ["IH"]],

  // --- single consonants ---------------------------------------------------
  ["c", null, /^[eiy]/, ["S"]],
  ["c", null, null, ["K"]],
  ["g", null, /^[eiy]/, ["JH"]],
  ["g", null, null, ["G"]],
  ["x", null, null, ["K", "S"]],
  ["j", null, null, ["JH"]],
  ["b", null, null, ["B"]],
  ["d", null, null, ["D"]],
  ["f", null, null, ["F"]],
  ["h", null, null, ["HH"]],
  ["k", null, null, ["K"]],
  ["l", null, null, ["L"]],
  ["m", null, null, ["M"]],
  ["n", null, null, ["N"]],
  ["p", null, null, ["P"]],
  ["r", null, null, ["R"]],
  ["s", null, null, ["S"]],
  ["t", null, null, ["T"]],
  ["v", null, null, ["V"]],
  ["w", null, null, ["W"]],
  ["z", null, null, ["Z"]],
];

// Longest grapheme wins; among equal lengths, a rule with an explicit context
// outranks the context-free default, and declaration order breaks the rest.
const ORDERED = RULES.map(([g, left, right, p], i) => ({
  g,
  left,
  right,
  p,
  rank: [-g.length, left || right ? 0 : 1, i],
})).sort((a, b) => {
  for (let i = 0; i < 3; i++) {
    if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
  }
  return 0;
});

// Bucket by first letter so each position tries ~10 rules instead of ~120.
const BY_LETTER = new Map();
for (const rule of ORDERED) {
  const key = rule.g[0];
  if (!BY_LETTER.has(key)) BY_LETTER.set(key, []);
  BY_LETTER.get(key).push(rule);
}

/** Applies the rule engine to any letter string, real word or not. */
export function pronounceByRule(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, "");
  const out = [];
  let i = 0;

  while (i < w.length) {
    const candidates = BY_LETTER.get(w[i]) ?? [];
    let applied = null;

    for (const rule of candidates) {
      if (!w.startsWith(rule.g, i)) continue;
      if (rule.left && !rule.left.test(w.slice(0, i))) continue;
      if (rule.right && !rule.right.test(w.slice(i + rule.g.length))) continue;
      applied = rule;
      break;
    }

    if (applied) {
      out.push(...applied.p);
      i += applied.g.length;
    } else {
      i += 1; // unknown character: skip rather than fail
    }
  }

  return out;
}

// English single vowels are ambiguous out of context: "hom" can be read with
// the short vowel of "hot" or the long vowel of "home". The rule engine has to
// commit to one, so we also expose the alternatives — the question we actually
// want to answer is "could this spelling be read as the target word?", and that
// is a maximum over plausible readings, not a single guess.
const LONG_VARIANT = { AE: "EY", EH: "IY", IH: "AY", AA: "OW", AH: "UW" };
const MAX_VARIANTS = 8;

/**
 * Plausible readings of a spelling, base pronunciation first.
 * @returns {string[][]}
 */
export function pronounceVariants(word) {
  const base = pronounceByRule(word);
  const swappable = [];
  base.forEach((p, i) => {
    if (LONG_VARIANT[p]) swappable.push(i);
  });

  if (swappable.length === 0) return [base];

  // Beyond three ambiguous vowels the combinations stop being informative, so
  // fall back to the two extremes: everything short, everything long.
  if (swappable.length > 3) {
    const allLong = base.map((p) => LONG_VARIANT[p] ?? p);
    return [base, allLong];
  }

  const variants = [];
  for (let mask = 0; mask < 2 ** swappable.length && variants.length < MAX_VARIANTS; mask++) {
    const next = [...base];
    swappable.forEach((position, bit) => {
      if (mask & (1 << bit)) next[position] = LONG_VARIANT[next[position]];
    });
    variants.push(next);
  }
  return variants;
}

/** CMU pronunciation for a known word, or null. */
export function pronounceFromDictionary(word) {
  const entry = CMU[String(word).toLowerCase()];
  return entry ? normalisePhonemes(entry) : null;
}

/**
 * Best available pronunciation.
 * @returns {{ phonemes: string[], source: "cmu" | "rules" }}
 */
export function pronounce(word) {
  const looked = pronounceFromDictionary(word);
  if (looked && looked.length) return { phonemes: looked, source: "cmu" };
  return { phonemes: pronounceByRule(word), source: "rules" };
}

export function isKnownToCmu(word) {
  return Object.hasOwn(CMU, String(word).toLowerCase());
}
