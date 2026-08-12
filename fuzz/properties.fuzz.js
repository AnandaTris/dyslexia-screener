import { describe, test } from "vitest";
import fc from "fast-check";
import { characterAlignment, tokenAlignment } from "../lib/nlp/align.js";
import {
  normalisePhonemes,
  phonemeDistance,
  phonemeSequenceDistance,
} from "../lib/nlp/phonemes.js";
import { splitSentences, textStatistics, tokenizeWords } from "../lib/nlp/tokenize.js";
import {
  DEVELOPMENTAL_REVERSAL_AGE,
  LIKELY_SCORE_THRESHOLD,
  decideVerdict,
  normaliseScore,
} from "../lib/screening/verdict.js";
import { summariseCaseload, summariseStudentTrend } from "../lib/trends.js";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function replayCharacterAlignment(source, ops) {
  let output = "";
  let cursor = 0;

  for (const op of ops) {
    invariant(Number.isInteger(op.at), "character operation offset must be an integer");
    invariant(op.at >= cursor && op.at <= source.length, "character operation offsets must be ordered and in bounds");
    output += source.slice(cursor, op.at);
    cursor = op.at;

    if (op.op === "substitute") {
      invariant(source[cursor] === op.from, "substitution must name the consumed source character");
      output += op.to;
      cursor += 1;
    } else if (op.op === "transpose") {
      invariant(source.slice(cursor, cursor + 2) === op.from, "transpose must name the consumed source pair");
      output += op.to;
      cursor += 2;
    } else if (op.op === "delete") {
      invariant(source[cursor] === op.from, "deletion must name the consumed source character");
      cursor += 1;
    } else if (op.op === "insert") {
      output += op.to;
    } else {
      throw new Error(`unknown character alignment operation: ${op.op}`);
    }
  }

  return output + source.slice(cursor);
}

const shortString = fc.string({ maxLength: 32 });
const token = fc.string({ maxLength: 12 });

const tokenizerProperty = fc.property(fc.string({ maxLength: 1_024 }), (source) => {
  const sentences = splitSentences(source);
  const tokens = tokenizeWords(source);
  const statistics = textStatistics(source);

  let sentenceEnd = 0;
  for (const [index, sentence] of sentences.entries()) {
    invariant(sentence.index === index, "sentence indexes must be contiguous");
    invariant(sentence.start >= sentenceEnd, "sentence offsets must be ordered");
    invariant(sentence.end >= sentence.start && sentence.end <= source.length, "sentence offsets must stay in bounds");
    invariant(source.slice(sentence.start, sentence.end) === sentence.text, "sentence offsets must point into the original text");
    invariant(sentence.text === sentence.text.trim(), "sentence text must not include surrounding whitespace");
    sentenceEnd = sentence.end;
  }

  let tokenEnd = 0;
  for (const [index, word] of tokens.entries()) {
    invariant(word.index === index, "word indexes must be contiguous");
    invariant(word.start >= tokenEnd, "word offsets must be ordered");
    invariant(word.end > word.start && word.end <= source.length, "word offsets must stay in bounds");
    invariant(source.slice(word.start, word.end) === word.text, "word offsets must point into the original text");
    invariant(word.normalised === word.text.toLowerCase().replace(/’/g, "'"), "word normalisation must be deterministic");
    invariant(word.sentence >= 0 && word.sentence < Math.max(1, sentences.length), "word sentence membership must be in bounds");
    tokenEnd = word.end;
  }

  invariant(statistics.characters === source.length, "character count must use the untouched source");
  invariant(statistics.words === tokens.length, "word statistics must agree with tokenisation");
  invariant(statistics.sentences === sentences.length, "sentence statistics must agree with splitting");
  invariant(statistics.uniqueWords >= 0 && statistics.uniqueWords <= tokens.length, "unique word count must be bounded by word count");
  invariant(Number.isFinite(statistics.averageWordLength) && statistics.averageWordLength >= 0, "average word length must be finite and non-negative");
});

const characterAlignmentProperty = fc.property(shortString, shortString, (source, target) => {
  const forward = characterAlignment(source, target);
  const reverse = characterAlignment(target, source);

  invariant(forward.distance === forward.ops.length, "every character operation must cost exactly one");
  invariant(forward.distance >= 0 && forward.distance <= Math.max(source.length, target.length), "character distance must stay within edit-distance bounds");
  invariant(forward.distance === reverse.distance, "character distance must be symmetric");
  invariant(replayCharacterAlignment(source, forward.ops) === target, "character edit script must replay to the target");
});

const tokenAlignmentProperty = fc.property(
  fc.array(token, { maxLength: 18 }),
  fc.array(token, { maxLength: 18 }),
  (source, target) => {
    const operations = tokenAlignment(source, target);
    const rebuilt = [];
    let sourceIndex = 0;
    let targetIndex = 0;

    for (const op of operations) {
      if (op.sourceIndex !== null) {
        invariant(op.sourceIndex === sourceIndex, "source token indexes must be contiguous");
        invariant(op.from === source[sourceIndex], "token operation must name the source token");
      }
      if (op.targetIndex !== null) {
        invariant(op.targetIndex === targetIndex, "target token indexes must be contiguous");
        invariant(op.to === target[targetIndex], "token operation must name the target token");
      }

      if (op.op === "equal") {
        invariant(op.from === op.to, "equal token operations must contain equal values");
        rebuilt.push(op.to);
        sourceIndex += 1;
        targetIndex += 1;
      } else if (op.op === "replace") {
        rebuilt.push(op.to);
        sourceIndex += 1;
        targetIndex += 1;
      } else if (op.op === "delete") {
        sourceIndex += 1;
      } else if (op.op === "insert") {
        rebuilt.push(op.to);
        targetIndex += 1;
      } else {
        throw new Error(`unknown token alignment operation: ${op.op}`);
      }
    }

    invariant(sourceIndex === source.length, "token alignment must consume the source");
    invariant(targetIndex === target.length, "token alignment must consume the target");
    invariant(JSON.stringify(rebuilt) === JSON.stringify(target), "token alignment must rebuild the target");
  },
);

const phonemeToken = fc.string({ maxLength: 5 });
const phonemeSequence = fc.array(phonemeToken, { maxLength: 16 });
const phonemeMetricProperty = fc.property(
  phonemeToken,
  phonemeToken,
  phonemeSequence,
  phonemeSequence,
  (left, right, sequenceA, sequenceB) => {
    const unit = phonemeDistance(left, right);
    invariant(Number.isFinite(unit) && unit >= 0 && unit <= 1, "phoneme substitution cost must be in [0, 1]");
    invariant(unit === phonemeDistance(right, left), "phoneme substitution cost must be symmetric");

    const forward = phonemeSequenceDistance(sequenceA, sequenceB);
    const reverse = phonemeSequenceDistance(sequenceB, sequenceA);
    const identity = phonemeSequenceDistance(sequenceA, sequenceA);
    invariant(Number.isFinite(forward.distance) && forward.distance >= 0, "phoneme sequence distance must be finite and non-negative");
    invariant(Number.isFinite(forward.similarity) && forward.similarity >= 0 && forward.similarity <= 1, "phoneme similarity must be in [0, 1]");
    invariant(Math.abs(forward.distance - reverse.distance) < 1e-10, "phoneme sequence distance must be symmetric");
    invariant(identity.distance === 0 && identity.similarity === 1, "a phoneme sequence must be identical to itself");
    invariant(normalisePhonemes(sequenceA).every((value) => typeof value === "string" && value.length > 0), "normalised phonemes must be non-empty strings");
  },
);

const modelNumber = fc.oneof(
  fc.double({ noNaN: false, noDefaultInfinity: false }),
  fc.string({ maxLength: 24 }),
  fc.boolean(),
  fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
  fc.constant(null),
  fc.constant(undefined),
);
const indicator = fc.record({
  category: fc.oneof(fc.string({ maxLength: 24 }), fc.constant(null), fc.constant(undefined)),
  strength: fc.oneof(fc.string({ maxLength: 16 }), fc.constant(null)),
});
const indicatorInput = fc.oneof(
  fc.array(fc.oneof(indicator, fc.constant(null), fc.constant(undefined)), { maxLength: 12 }),
  fc.jsonValue(),
  fc.constant(undefined),
);

const verdictProperty = fc.property(
  fc.jsonValue(),
  modelNumber,
  indicatorInput,
  modelNumber,
  (isWritingSample, likelihoodScore, indicators, writerAge) => {
    const decision = decideVerdict({ isWritingSample, likelihoodScore, indicators, writerAge });
    const list = Array.isArray(indicators) ? indicators : [];
    const score = normaliseScore(likelihoodScore);

    invariant(["likely", "unlikely"].includes(decision.verdict), "verdict must use a supported label");
    invariant(Number.isInteger(decision.score) && decision.score >= 0 && decision.score <= 100, "verdict score must be an integer in [0, 100]");
    invariant(decision.reason === null || typeof decision.reason === "string", "verdict reason must be null or text");

    if (!isWritingSample) {
      invariant(decision.verdict === "unlikely" && decision.score === 0, "non-writing input cannot produce a positive screening result");
      invariant(decision.outcome === undefined, "non-writing input must not claim a screening outcome");
      return;
    }

    invariant(decision.outcome && typeof decision.outcome.heading === "string", "writing input must produce a user-facing outcome");
    invariant(
      ["assessment_recommended", "continue_screening", "no_clear_indicators"].includes(decision.outcome.code),
      "screening outcome must use a supported code",
    );

    if (list.length === 0) {
      invariant(decision.verdict === "unlikely" && decision.score === 0, "a score without indicators cannot recommend assessment");
      invariant(decision.outcome.code === "no_clear_indicators", "empty evidence must be described honestly");
    } else {
      invariant(decision.score === score, "evidence-bearing results must retain the normalised score");
      invariant(decision.outcome.allowPatternAnalysis === true, "evidence-bearing results must allow pattern analysis");
    }

    if (decision.verdict === "likely") {
      invariant(list.length > 0 && decision.score >= LIKELY_SCORE_THRESHOLD, "a likely verdict requires indicators and a threshold score");
    }

    if (decision.reason !== null) {
      const age = Number(writerAge);
      invariant(Number.isFinite(age) && age > 0 && age < DEVELOPMENTAL_REVERSAL_AGE, "a developmental override requires a young writer");
      invariant(list.length > 0 && list.every((item) => item?.category === "reversal"), "a developmental override requires reversal-only evidence");
    }
  },
);

const numericLike = fc.oneof(
  fc.integer({ min: -10_000, max: 10_000 }),
  fc.double({ min: -10_000, max: 10_000, noNaN: false }),
  fc.string({ maxLength: 12 }),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
);
const categoryCounts = fc.oneof(
  fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), numericLike, { maxKeys: 10 }),
  fc.array(numericLike, { maxLength: 6 }),
  fc.constant(null),
  fc.constant(undefined),
);
const storedRow = fc.record({
  id: fc.oneof(fc.string({ maxLength: 20 }), fc.constant(null)),
  created_at: fc.oneof(
    fc.date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2100-01-01T00:00:00Z"), noInvalidDate: true }).map((date) => date.toISOString()),
    fc.string({ maxLength: 24 }),
    fc.constant(null),
    fc.constant(undefined),
  ),
  word_count: numericLike,
  error_count: numericLike,
  category_counts: categoryCounts,
  dominant_profile: fc.oneof(fc.string({ maxLength: 20 }), fc.constant(null)),
  profile_label: fc.oneof(fc.string({ maxLength: 20 }), fc.constant(null)),
  profile_confidence: numericLike,
});

const trendProperty = fc.property(
  fc.array(storedRow, { maxLength: 25 }),
  fc.array(
    fc.record({
      student: fc.record({
        id: fc.oneof(fc.string({ maxLength: 20 }), fc.constant(null)),
        display_name: fc.oneof(fc.string({ maxLength: 30 }), fc.constant(null)),
      }),
      rows: fc.array(storedRow, { maxLength: 12 }),
    }),
    { maxLength: 8 },
  ),
  (rows, entries) => {
    const trend = summariseStudentTrend(rows);
    invariant(trend.samples === rows.length && trend.points.length === rows.length, "trend output must retain every stored sample");
    invariant(Number.isFinite(trend.totals.words) && trend.totals.words >= 0, "trend word total must be finite and non-negative");
    invariant(Number.isFinite(trend.totals.errors) && trend.totals.errors >= 0, "trend error total must be finite and non-negative");

    for (const point of trend.points) {
      const shares = Object.values(point.shares);
      invariant(shares.every((share) => Number.isFinite(share) && share >= 0 && share <= 1), "category shares must stay in [0, 1]");
      if (point.categorised > 0) {
        invariant(Math.abs(shares.reduce((sum, share) => sum + share, 0) - 1) < 1e-10, "category shares must sum to one");
      }
    }

    invariant(trend.errorRate.series.every((point) => Number.isFinite(point.value) && point.value >= 0), "error-rate series must contain finite non-negative values");
    invariant(trend.categories.every((category) => Number.isFinite(category.total) && category.total > 0), "reported categories must carry a positive finite total");

    const caseload = summariseCaseload(entries);
    invariant(caseload.students.length === entries.length, "caseload output must retain every student");
    invariant(caseload.totalSamples === entries.reduce((sum, entry) => sum + entry.rows.length, 0), "caseload sample total must match its inputs");
    invariant(caseload.withTrend <= caseload.withSamples && caseload.withSamples <= entries.length, "caseload roll-up counts must be internally ordered");
  },
);

const TARGETS = [
  { name: "tokenizer-offsets", property: tokenizerProperty },
  { name: "character-alignment", property: characterAlignmentProperty },
  { name: "token-alignment", property: tokenAlignmentProperty },
  { name: "phoneme-metric", property: phonemeMetricProperty },
  { name: "screening-verdict", property: verdictProperty },
  { name: "trend-aggregation", property: trendProperty },
];

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalInteger(value) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("FUZZ_SEED must be an integer");
  return parsed;
}

const requestedTarget = process.env.FUZZ_TARGET || null;
const selectedTargets = requestedTarget
  ? TARGETS.filter((target) => target.name === requestedTarget)
  : TARGETS;

if (selectedTargets.length === 0) {
  throw new Error(
    `Unknown fuzz target "${requestedTarget}". Choose one of: ${TARGETS.map((target) => target.name).join(", ")}`,
  );
}

const totalDuration = positiveInteger(process.env.FUZZ_DURATION_MS);
const requestedRuns = positiveInteger(process.env.FUZZ_RUNS);
if (totalDuration === null && requestedRuns === null) {
  throw new Error("Set FUZZ_DURATION_MS or FUZZ_RUNS through scripts/run-fuzz.mjs");
}
if (totalDuration !== null && requestedRuns !== null) {
  throw new Error("FUZZ_DURATION_MS and FUZZ_RUNS are mutually exclusive");
}

const seed = optionalInteger(process.env.FUZZ_SEED);
const path = process.env.FUZZ_PATH || null;
const targetDuration = totalDuration === null
  ? null
  : Math.max(1, Math.floor(totalDuration / selectedTargets.length));

function failureMessage(target, result) {
  const replay = [
    "npm run fuzz --",
    `--target ${target.name}`,
    `--seed ${result.seed}`,
    result.counterexamplePath ? `--path ${JSON.stringify(result.counterexamplePath)}` : "",
  ].filter(Boolean).join(" ");
  const cause = result.errorInstance instanceof Error
    ? result.errorInstance.stack ?? result.errorInstance.message
    : String(result.errorInstance ?? "property failed");

  return [
    `${target.name} failed after ${result.numRuns} generated cases and ${result.numShrinks} shrinks.`,
    `Counterexample: ${fc.stringify(result.counterexample)}`,
    `Replay: ${replay}`,
    cause,
  ].join("\n");
}

describe("robustness fuzzing", () => {
  for (const target of selectedTargets) {
    test(target.name, () => {
      const parameters = {
        numRuns: requestedRuns ?? Number.MAX_SAFE_INTEGER,
        markInterruptAsFailure: false,
      };
      if (targetDuration !== null) parameters.interruptAfterTimeLimit = targetDuration;
      if (seed !== null) parameters.seed = seed;
      if (path !== null) parameters.path = path;

      const startedAt = Date.now();
      const result = fc.check(target.property, parameters);
      const elapsed = Date.now() - startedAt;

      if (result.failed) throw new Error(failureMessage(target, result));
      console.log(
        `[fuzz] ${target.name}: ${result.numRuns} cases in ${elapsed}ms` +
          (result.interrupted ? " (time budget reached)" : ""),
      );
    }, (targetDuration ?? 7 * 24 * 60 * 60 * 1_000) + 30_000);
  }
});
