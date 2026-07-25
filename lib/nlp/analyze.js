// Orchestrates the error-pattern analysis.
//
// Pipeline
//   text
//     -> tokenise (sentences for context, words for offsets)
//     -> word-boundary pass      (run-together / split words)
//     -> neural pass             (Transformers.js GEC: context-dependent errors)
//     -> lexicon pass            (Hunspell + phonetic search: remaining non-words)
//     -> classify each pair      (phonology / morphology / alignment)
//     -> aggregate               (category rates, recurring patterns, profile)
//
// The neural and lexicon passes are complementary rather than redundant: the
// first sees errors that produce real words, the second sees errors the first
// leaves untouched.

import { classifyError } from "./classify.js";
import { correctSentences, gecConfig } from "./gec.js";
import { pronounce, pronounceByRule } from "./g2p.js";
import { isCommonNoun, isRealWord, suggestTargets, editDistance, scoreCandidate } from "./lexicon.js";
import { phonemeSequenceDistance } from "./phonemes.js";
import { splitSentences, textStatistics, tokenizeWords } from "./tokenize.js";
import { tokenAlignment } from "./align.js";
import {
  ERROR_CATEGORIES,
  MIN_ERRORS_FOR_PROFILE,
  MIXED_PROFILE_MARGIN,
  PROFILES,
  PROFILE_WEIGHTS,
} from "./taxonomy.js";

const FUNCTION_WORDS = new Set(
  "a an and the to of in is it on at be we he my no so up us as or if do go me by".split(" "),
);

/** Words a run-together / split-word check must sound identical across. */
const BOUNDARY_PHONETIC_THRESHOLD = 0.95;

function soundsSame(a, b) {
  return phonemeSequenceDistance(pronounceByRule(a), pronounceByRule(b)).similarity >= BOUNDARY_PHONETIC_THRESHOLD;
}

/** A word has to contain a vowel; "fr", "pl" and "st" are onsets, not words. */
function isPlausibleWordPart(part) {
  if (!/[aeiouy]/.test(part)) return false;
  if (part.length < 2 && !FUNCTION_WORDS.has(part)) return false;
  return isCommonNoun(part);
}

/**
 * Word-boundary errors. Deliberately conservative on three counts: both halves
 * must be plausible words in their own right, the joined form must sound
 * identical to the two halves in sequence (which keeps "becos" from being read
 * as "be cos"), and the split must beat the best single-word reconstruction
 * (which keeps "frend" as a misspelling of "friend" rather than "fr end").
 */
function findBoundaryErrors(tokens) {
  const found = [];
  const consumed = new Set();
  const SPLIT_SCORE = 0.88;

  // Joins are tested first. "to gether" is one split word, but read in
  // isolation "gether" also splits into "get her" — the pass that has both
  // tokens in view has to claim them before the pass that sees only one.
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (b.start !== a.end + 1) continue; // must be separated by exactly one space
    const joined = a.normalised + b.normalised;
    // At least one half must be a non-word, otherwise "a way" reads as "away".
    if (isRealWord(a.normalised) && isRealWord(b.normalised)) continue;
    if (!isCommonNoun(joined)) continue;

    found.push({
      category: "segmentation",
      subtype: "split_word",
      subtypeLabel: ERROR_CATEGORIES.segmentation.subtypes.split_word,
      produced: `${a.text} ${b.text}`,
      target: joined,
      start: a.start,
      end: b.end,
      sentence: a.sentence,
      source: "boundary",
      confidence: 0.8,
      phoneticSimilarity: 1,
      soundsLikeTarget: true,
      editDistance: 1,
      secondary: [],
    });
    consumed.add(a.index);
    consumed.add(b.index);
  }

  for (const token of tokens) {
    const w = token.normalised;
    if (consumed.has(token.index) || w.length < 4 || isRealWord(w)) continue;

    for (let cut = 1; cut < w.length; cut++) {
      const left = w.slice(0, cut);
      const right = w.slice(cut);
      if (!isPlausibleWordPart(left) || !isPlausibleWordPart(right)) continue;
      if (!soundsSame(w, left + right)) continue;

      const [bestSingle] = suggestTargets(w, { maxCandidates: 1 });
      if (bestSingle && bestSingle.score >= SPLIT_SCORE) continue;

      found.push({
        category: "segmentation",
        subtype: "run_together",
        subtypeLabel: ERROR_CATEGORIES.segmentation.subtypes.run_together,
        produced: token.text,
        target: `${left} ${right}`,
        start: token.start,
        end: token.end,
        sentence: token.sentence,
        source: "boundary",
        confidence: SPLIT_SCORE,
        phoneticSimilarity: 1,
        soundsLikeTarget: true,
        editDistance: 1,
        secondary: [],
      });
      consumed.add(token.index);
      break;
    }
  }

  return { errors: found, consumed };
}

/**
 * Pairs proposed by the neural corrector.
 *
 * A seq2seq model paraphrases as readily as it corrects, and every paraphrase
 * it slips in becomes a fabricated "error" in the report. Two filters keep that
 * out:
 *
 *   - Real word replaced by a real word: only accepted when the two sound alike.
 *     That is the homophone case the dictionary is structurally blind to, and it
 *     is the only reason we consult the model about real words at all. It is
 *     what rejects the model's rewrite of "a sand castle" to "a and castle".
 *   - Non-word replaced: accepted, but as a *candidate* — the merge step scores
 *     it against the lexicon's own best guess and keeps the stronger of the two,
 *     so the model's "friends" loses to the lexicon's "friend".
 */
function pairsFromCorrection(sentenceTokens, correctedText) {
  const corrected = tokenizeWords(correctedText).map((t) => t.normalised);
  const original = sentenceTokens.map((t) => t.normalised);
  const pairs = [];

  for (const op of tokenAlignment(original, corrected)) {
    if (op.op !== "replace") continue;
    const token = sentenceTokens[op.sourceIndex];
    const from = op.from;
    const to = op.to;
    if (!token || from === to || !isCommonNoun(to)) continue;

    // pronounce() looks real words up in CMU and only falls back to rules for
    // non-words. Using the rule engine on both sides here would mis-pronounce
    // "their" as TH-EY-R against "there" as TH-IY-R and score the most common
    // homophone pair in English at 0.896 — just under the bar.
    const sameSound =
      phonemeSequenceDistance(pronounce(from).phonemes, pronounce(to).phonemes).similarity >= 0.9;

    if (isRealWord(from)) {
      if (!sameSound) continue;
      pairs.push({ token, target: to, targetConfidence: 0.8, source: "neural" });
      continue;
    }

    const distance = editDistance(from, to);
    const closeInLetters = distance <= Math.max(2, Math.ceil(Math.max(from.length, to.length) * 0.5));
    if (!closeInLetters && !sameSound) continue;

    pairs.push({ token, target: to, targetConfidence: 0.8, source: "neural", contested: true });
  }

  return pairs;
}

/** Recurring letter-level substitutions across the whole sample. */
function recurringPatterns(errors) {
  const counts = new Map();

  for (const error of errors) {
    for (const op of error.editOps ?? []) {
      let key = null;
      if (op.op === "substitute") key = `${op.from} → ${op.to}`;
      else if (op.op === "insert") key = `missing "${op.to}"`;
      else if (op.op === "delete") key = `extra "${op.from}"`;
      else if (op.op === "transpose") key = `"${op.from}" swapped to "${op.to}"`;
      if (!key) continue;

      const entry = counts.get(key) ?? { pattern: key, count: 0, examples: [] };
      entry.count += 1;
      if (entry.examples.length < 3 && !entry.examples.includes(error.produced)) {
        entry.examples.push(error.produced);
      }
      counts.set(key, entry);
    }
  }

  return [...counts.values()]
    .filter((entry) => entry.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

/** Words misspelled more than once, or spelled inconsistently across the sample. */
function repeatedWordErrors(errors) {
  const byTarget = new Map();
  for (const error of errors) {
    if (!error.target) continue;
    const entry = byTarget.get(error.target) ?? { target: error.target, spellings: new Set(), count: 0 };
    entry.spellings.add(error.produced.toLowerCase());
    entry.count += 1;
    byTarget.set(error.target, entry);
  }

  return [...byTarget.values()]
    .filter((entry) => entry.count >= 2)
    .map((entry) => ({
      target: entry.target,
      count: entry.count,
      spellings: [...entry.spellings],
      inconsistent: entry.spellings.size > 1,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

/** Weighted profile scores, normalised to shares of the total evidence. */
function buildProfile(errors, statistics) {
  const scores = { phonological: 0, surface: 0, morphological: 0, visual: 0 };
  let profiledErrors = 0;

  for (const error of errors) {
    const weights = PROFILE_WEIGHTS[error.category];
    if (!weights) continue;
    profiledErrors += 1;
    const weight = error.confidence ?? 0.6;
    for (const [profile, factor] of Object.entries(weights)) {
      scores[profile] += factor * weight;
    }
    // A secondary tag contributes at a third of the weight of a primary one.
    for (const tag of error.secondary ?? []) {
      for (const [profile, factor] of Object.entries(PROFILE_WEIGHTS[tag] ?? {})) {
        scores[profile] += factor * weight * 0.33;
      }
    }
  }

  const total = Object.values(scores).reduce((sum, v) => sum + v, 0);
  const shares = Object.fromEntries(
    Object.entries(scores).map(([k, v]) => [k, total ? Number((v / total).toFixed(3)) : 0]),
  );

  const ranked = Object.entries(shares).sort((a, b) => b[1] - a[1]);
  const [topKey, topShare] = ranked[0] ?? ["phonological", 0];
  const [secondKey, secondShare] = ranked[1] ?? ["surface", 0];

  if (profiledErrors < MIN_ERRORS_FOR_PROFILE) {
    return {
      scores: shares,
      profiledErrors,
      errorRate: statistics.words ? Number((profiledErrors / statistics.words).toFixed(3)) : 0,
      dominant: null,
      label: "Not enough errors to describe a pattern",
      description: `Only ${profiledErrors} analysable spelling ${
        profiledErrors === 1 ? "error was" : "errors were"
      } found, below the ${MIN_ERRORS_FOR_PROFILE} needed before an error pattern can be described. This is a good sign for this sample, but it also means no profile can be reported.`,
      intervention: null,
      confidence: 0,
      mixed: false,
      runnerUp: null,
    };
  }

  const mixed = topShare - secondShare < MIXED_PROFILE_MARGIN;
  const profile = PROFILES[topKey];
  const runnerUp = PROFILES[secondKey];

  // Confidence rises with how many errors we have and how cleanly the leading
  // profile separates from the next one.
  const volume = Math.min(1, profiledErrors / 12);
  const separation = Math.min(1, (topShare - secondShare) / 0.35);
  const confidence = Number((0.35 + 0.4 * volume + 0.25 * separation).toFixed(2));

  return {
    scores: shares,
    profiledErrors,
    errorRate: statistics.words ? Number((profiledErrors / statistics.words).toFixed(3)) : 0,
    dominant: topKey,
    label: mixed ? `Mixed pattern: ${profile.label.toLowerCase()} and ${runnerUp.label.toLowerCase()}` : profile.label,
    description: mixed
      ? `${profile.description} At the same time, ${runnerUp.description.charAt(0).toLowerCase()}${runnerUp.description.slice(1)} Neither pattern clearly leads in this sample.`
      : profile.description,
    intervention: mixed
      ? `${profile.intervention} Alongside this: ${runnerUp.intervention.charAt(0).toLowerCase()}${runnerUp.intervention.slice(1)}`
      : profile.intervention,
    confidence,
    mixed,
    runnerUp: mixed ? secondKey : null,
  };
}

function buildCaveats({ statistics, profile, errors, writerAge, neuralOk, transcribed }) {
  const caveats = [];

  if (statistics.words < 40) {
    caveats.push(
      `The sample is ${statistics.words} words long. Error patterns are only stable across several samples of 50 words or more, so treat this as a single data point.`,
    );
  }
  if (!neuralOk) {
    caveats.push(
      "The contextual correction model was unavailable, so errors that produce real words (their/there, to/too) could not be detected. Only non-word misspellings were analysed.",
    );
  }
  if (transcribed) {
    caveats.push(
      "The text was transcribed from an image. Any transcription mistake becomes an apparent spelling error, so check the transcription before acting on individual findings.",
    );
  }

  const visualShare = profile.scores.visual ?? 0;
  if (visualShare > 0.2) {
    if (writerAge && writerAge < 8) {
      caveats.push(
        `Reversals and letter swaps make up a noticeable share of the errors. At age ${writerAge} this is developmentally common and should not be read as an indicator on its own.`,
      );
    } else {
      caveats.push(
        "Reversals and letter swaps make up a noticeable share of the errors. These are developmentally common in writers under about seven; the writer's age matters for interpreting them.",
      );
    }
  }

  const lowConfidence = errors.filter((e) => (e.confidence ?? 0) < 0.5).length;
  if (lowConfidence > errors.length / 3 && errors.length > 0) {
    caveats.push(
      `${lowConfidence} of ${errors.length} errors had an uncertain intended word. Where the intended word is a guess, its category is a guess too.`,
    );
  }

  caveats.push(
    "This is an analysis of writing patterns, not a diagnosis. Dyslexia and its profiles can only be identified through a full psychoeducational assessment.",
  );

  return caveats;
}

function buildSummary({ statistics, profile, categoryCounts, patterns }) {
  if (!profile.dominant) {
    return `Across ${statistics.words} words, ${profile.profiledErrors} spelling ${
      profile.profiledErrors === 1 ? "error was" : "errors were"
    } found — too few to describe a recurring pattern.`;
  }

  const parts = [];
  const rate = Math.round(profile.errorRate * 100);
  parts.push(
    `Across ${statistics.words} words, ${profile.profiledErrors} spelling errors were analysed (${rate}% of words).`,
  );

  const ordered = Object.entries(categoryCounts)
    .filter(([category]) => PROFILE_WEIGHTS[category])
    .sort((a, b) => b[1] - a[1]);
  if (ordered.length) {
    const described = ordered
      .slice(0, 3)
      .map(([category, count]) => `${count} ${ERROR_CATEGORIES[category].label.toLowerCase()}`)
      .join(", ");
    parts.push(`The errors break down as ${described}.`);
  }

  parts.push(`The dominant pattern is ${profile.label.toLowerCase()}.`);

  if (patterns.length) {
    parts.push(
      `The most frequent recurring pattern is "${patterns[0].pattern}", seen ${patterns[0].count} times.`,
    );
  }

  return parts.join(" ");
}

/**
 * Full error-pattern analysis of a writing sample.
 *
 * @param {string} text
 * @param {{ writerAge?: number|null, transcribed?: boolean, useNeural?: boolean,
 *           timeoutMs?: number }} [options]
 */
export async function analyzeWriting(text, options = {}) {
  const { writerAge = null, transcribed = false, useNeural = true, timeoutMs } = options;
  const source = String(text ?? "").trim();
  const statistics = textStatistics(source);

  if (statistics.words === 0) {
    return {
      ok: false,
      error: "No readable words were found in the sample.",
      statistics,
    };
  }

  const tokens = tokenizeWords(source);
  const sentences = splitSentences(source);
  const boundary = findBoundaryErrors(tokens);

  // --- neural pass ---------------------------------------------------------
  let neural = { ok: false, corrections: sentences.map(() => null), model: null, reason: "skipped" };
  if (useNeural) {
    neural = await correctSentences(sentences.map((s) => s.text), timeoutMs ? { timeoutMs } : {});
  }

  const pairsByToken = new Map();

  if (neural.ok) {
    sentences.forEach((sentence, i) => {
      const corrected = neural.corrections[i];
      if (!corrected) return;
      const sentenceTokens = tokens.filter((t) => t.sentence === sentence.index);
      for (const pair of pairsFromCorrection(sentenceTokens, corrected)) {
        if (boundary.consumed.has(pair.token.index)) continue;
        pairsByToken.set(pair.token.index, pair);
      }
    });
  }

  // --- lexicon pass --------------------------------------------------------
  // Runs over every non-word, including ones the neural layer already claimed:
  // where both layers propose a target they are scored on the same scale and
  // the better-supported reconstruction wins.
  for (const token of tokens) {
    if (boundary.consumed.has(token.index)) continue;
    if (isRealWord(token.normalised)) continue;

    const existing = pairsByToken.get(token.index);
    if (existing && !existing.contested) continue;

    const [best] = suggestTargets(token.normalised, { maxCandidates: 1 });

    if (existing) {
      const neuralScore = scoreCandidate(token.normalised, existing.target);
      // The model earns a small bonus for having read the sentence; the
      // lexicon layer is blind to context and can only judge form.
      if (!best || neuralScore + 0.05 >= best.score) {
        pairsByToken.set(token.index, { ...existing, targetConfidence: Math.min(0.9, neuralScore) });
        continue;
      }
    }

    if (!best) continue;
    pairsByToken.set(token.index, {
      token,
      target: best.word,
      targetConfidence: best.score,
      source: existing ? "neural+lexicon" : "lexicon",
    });
  }

  // --- classification ------------------------------------------------------
  const classified = [];
  for (const pair of pairsByToken.values()) {
    const error = classifyError({
      produced: pair.token.text,
      target: pair.target,
      targetConfidence: pair.targetConfidence,
      token: pair.token,
      source: pair.source,
    });
    if (error) classified.push(error);
  }

  const errors = [...boundary.errors, ...classified].sort(
    (a, b) => (a.start ?? 0) - (b.start ?? 0),
  );

  // --- aggregation ---------------------------------------------------------
  const categoryCounts = {};
  const subtypeCounts = {};
  for (const error of errors) {
    categoryCounts[error.category] = (categoryCounts[error.category] ?? 0) + 1;
    const key = `${error.category}.${error.subtype}`;
    subtypeCounts[key] = (subtypeCounts[key] ?? 0) + 1;
  }

  const patterns = recurringPatterns(errors);
  const repeated = repeatedWordErrors(errors);
  const profile = buildProfile(errors, statistics);

  return {
    ok: true,
    statistics,
    errors,
    categoryCounts,
    subtypeCounts,
    recurringPatterns: patterns,
    repeatedWords: repeated,
    profile,
    summary: buildSummary({ statistics, profile, categoryCounts, patterns }),
    caveats: buildCaveats({
      statistics,
      profile,
      errors,
      writerAge,
      neuralOk: neural.ok,
      transcribed,
    }),
    pipeline: {
      layers: {
        boundary: true,
        neural: neural.ok,
        lexicon: true,
      },
      neuralModel: neural.model ?? gecConfig().model,
      neuralReason: neural.ok ? null : neural.reason,
    },
  };
}
