// Lexicon services: is this a real word, and if not, what did the writer mean?
//
// Hunspell (via nspell + dictionary-en) answers the first question. Its own
// suggest() is tuned for typists, not for dyslexic spelling — it offers nothing
// useful for "enuf" — so target reconstruction here is our own: union of
// orthographic neighbours and a phonetic index over the CMU dictionary, which
// finds words that *sound* like the misspelling however far apart the letters
// are. Candidates are then re-ranked with a small high-frequency prior, because
// Hunspell happily accepts rare words that a school-age writer never intended.

import en from "dictionary-en";
import nspell from "nspell";
import { dictionary as CMU } from "cmu-pronouncing-dictionary";
import { pronounce, pronounceVariants } from "./g2p.js";
import { bestPhonemeMatch, IS_VOWEL, normalisePhonemes } from "./phonemes.js";
import { analyseMorphology } from "./morphology.js";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

// A frequency prior, not a dictionary. Roughly the highest-frequency English
// words plus the ones that dominate primary-school writing — enough to break
// ties like "table" vs "babel" without shipping a full frequency table.
const COMMON_WORDS = new Set(
  `the be to of and a in that have i it for not on with he as you do at this but his by from they
   we say her she or an will my one all would there their what so up out if about who get which go
   me when make can like time no just him know take people into year your good some could them see
   other than then now look only come its over think also back after use two how our work first
   well way even new want because any these give day most us is are was were been has had did said
   went got made came took saw came knew found told asked left felt kept let began seemed helped
   showed tried called used man men woman women child children boy girl friend friends family
   mother father brother sister teacher school house home room door garden street town city water
   food money book books story night morning day week month summer winter dog cat bird tree
   little big small large long short high low old young happy sad good bad nice great best better
   right wrong same different many much more less every each both few own such where why while
   before again always never often sometimes together enough through though thought thing things
   something nothing everything anything everyone someone people place places world life today
   tomorrow yesterday because beautiful favourite favorite different remember birthday holiday
   present presents played playing played walking running jumped jumping talking looking wanted
   started stopped finished decided answered listened watched opened closed carried worried
   whistle write wrote writing read reading letter letters word words spell spelling
   gave give ran run sat sit ate eat drank drink swam swim slept sleep bought brought
   caught taught thought built build sang sing rang ring fell fall broke break spoke speak
   wore wear bore tore grew grow threw throw flew fly blew blow drew draw knew know
   park parked home house shop shops swing swings bike ride rode beach sea sand castle
   night nights light bright might sight fight tight enough because friend friendly
   brother sister mother father cousin uncle aunt grandma grandpa`
    .split(/\s+/)
    .filter(Boolean),
);

let spellChecker = null;
let phoneticIndex = null;

function speller() {
  if (!spellChecker) spellChecker = nspell(en);
  return spellChecker;
}

/** True for words Hunspell accepts in any casing — used to decide "is this an error?". */
export function isRealWord(word) {
  const w = String(word);
  if (!/[a-zA-Z]/.test(w)) return false;
  const s = speller();
  return s.correct(w) || s.correct(w.toLowerCase());
}

/**
 * True only when the *lowercase* form is in the dictionary. Hunspell stores
 * proper nouns capitalised, so this is what keeps "Enif" and "Pecos" out of the
 * candidate list for "enuf" and "becos".
 */
export function isCommonNoun(word) {
  return speller().correct(String(word).toLowerCase());
}

/** Consonant skeleton of a pronunciation — the part misspellings tend to preserve. */
function phoneticKey(phonemes) {
  return phonemes.filter((p) => !IS_VOWEL(p)).join(".");
}

/** Lazily invert the CMU dictionary into skeleton -> words (~90 ms, once per process). */
function getPhoneticIndex() {
  if (phoneticIndex) return phoneticIndex;
  phoneticIndex = new Map();
  for (const word of Object.keys(CMU)) {
    if (word.length < 2 || !/^[a-z]+$/.test(word)) continue;
    const key = phoneticKey(normalisePhonemes(CMU[word]));
    if (!key) continue;
    const bucket = phoneticIndex.get(key);
    if (bucket) bucket.push(word);
    else phoneticIndex.set(key, [word]);
  }
  return phoneticIndex;
}

/**
 * Buckets for common skeletons run to hundreds of words. Scoring all of them is
 * wasteful, but truncating in insertion order silently drops the right answer
 * ("night" sits deep in the N.T bucket), so order by prior plausibility first.
 */
function phoneticCandidates(producedPhonemes, word, limit = 250) {
  const bucket = getPhoneticIndex().get(phoneticKey(producedPhonemes)) ?? [];
  if (bucket.length <= limit) return bucket;

  return [...bucket]
    .sort((a, b) => {
      const commonDelta = (COMMON_WORDS.has(b) ? 1 : 0) - (COMMON_WORDS.has(a) ? 1 : 0);
      if (commonDelta) return commonDelta;
      return Math.abs(a.length - word.length) - Math.abs(b.length - word.length);
    })
    .slice(0, limit);
}

/** Norvig-style edit-distance-1 neighbourhood. */
function edits1(word) {
  const out = new Set();
  for (let i = 0; i <= word.length; i++) {
    const left = word.slice(0, i);
    const right = word.slice(i);
    if (right) {
      out.add(left + right.slice(1)); // deletion
      if (right.length > 1) {
        out.add(left + right[1] + right[0] + right.slice(2)); // transposition
      }
      for (const c of ALPHABET) out.add(left + c + right.slice(1)); // substitution
    }
    for (const c of ALPHABET) out.add(left + c + right); // insertion
  }
  out.delete(word);
  return out;
}

/** Character-level Levenshtein, used only for ranking candidates. */
export function editDistance(a, b) {
  const prev = new Uint16Array(b.length + 1);
  const curr = new Uint16Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev.set(curr);
  }
  return prev[b.length];
}

/**
 * How well `candidate` explains `word` as a misspelling of it, in [0, ~1.1].
 *
 * Sound outweighs letters, and by a deliberate margin: dyslexic misspellings
 * are frequently orthographically distant but phonetically near-identical.
 * "nite" is three letter-edits from "night" and one from "nice", but only
 * "night" is a perfect phonetic match.
 *
 * Exported so the neural layer's proposals are ranked on the same scale as the
 * lexicon's own, and the better-supported one can win.
 */
export function scoreCandidate(word, candidate, variants) {
  const readings = variants ?? pronounceVariants(word);
  const phonetic = bestPhonemeMatch(readings, pronounce(candidate).phonemes).similarity;
  const orth = 1 - editDistance(word, candidate) / Math.max(word.length, candidate.length);
  const common = COMMON_WORDS.has(candidate) ? 1 : 0;
  // A candidate that explains the misspelling as a broken suffix rule
  // ("hopeing" = hope + ing) is a better fit than one that merely happens to
  // be a similar string ("hopping").
  const morphological = analyseMorphology(word, candidate).affixError === "junction_rule" ? 1 : 0;

  return phonetic * 0.6 + orth * 0.25 + common * 0.15 + morphological * 0.1;
}

/**
 * Best guesses at the word a misspelling was aiming for, best first.
 *
 * @param {string} misspelling
 * @param {{ maxCandidates?: number }} [options]
 * @returns {{ word: string, score: number, via: "orthographic" | "phonetic" }[]}
 */
export function suggestTargets(misspelling, { maxCandidates = 5 } = {}) {
  const word = String(misspelling).toLowerCase().replace(/[^a-z']/g, "");
  if (word.length < 2) return [];

  const variants = pronounceVariants(word);
  const seen = new Map();

  const consider = (candidate, via) => {
    if (candidate === word || seen.has(candidate)) return;
    seen.set(candidate, { word: candidate, score: scoreCandidate(word, candidate, variants), via });
  };

  const one = edits1(word);
  for (const candidate of one) {
    if (isCommonNoun(candidate)) consider(candidate, "orthographic");
  }

  // Edit-2 is expensive, so only pay for it when edit-1 came up short.
  if (seen.size < 3) {
    let scanned = 0;
    for (const near of one) {
      for (const candidate of edits1(near)) {
        if (candidate.length > 2 && isCommonNoun(candidate)) {
          consider(candidate, "orthographic");
        }
      }
      if (++scanned > 40) break;
    }
  }

  // Always consulted, not just as a fallback: "enuf" -> "enough" and
  // "wisle" -> "whistle" are three orthographic edits away but phonetically
  // identical, so the letter-based search can never reach them.
  for (const reading of variants) {
    for (const candidate of phoneticCandidates(reading, word)) {
      if (isCommonNoun(candidate)) consider(candidate, "phonetic");
    }
  }

  for (const candidate of speller().suggest(word).slice(0, 5)) {
    if (isCommonNoun(candidate.toLowerCase())) {
      consider(candidate.toLowerCase(), "orthographic");
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates);
}

/** Exposed so tests can reset module-level caches between runs. */
export function _resetLexiconCaches() {
  spellChecker = null;
  phoneticIndex = null;
}
