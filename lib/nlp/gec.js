// Neural grammatical error correction — the contextual layer of the pipeline.
//
// Model: Xenova/t5-base-grammar-correction, an ONNX build of
// vennify/t5-base-grammar-correction (T5-base, Apache-2.0, trained on JFLEG),
// run locally through Transformers.js. Nothing is sent to a third party.
//
// Why a neural model at all, when we already have a dictionary: a dictionary
// can only see words that do not exist. It is blind to "their" written for
// "there", to "to" written for "too", and to any misspelling whose intended
// target is ambiguous out of context. A sequence-to-sequence corrector reads
// the sentence and proposes the intended wording, which is exactly the signal
// the lexicon layer cannot produce.
//
// Why this model and not the smaller grammar-synthesis-small: the small model
// was measured on this project's samples and hallucinates. Given "The dof ran
// to the bark and the dall was reb" it returns "The dog was killed by a car
// wreck". In a diagnostic tool an invented rewrite becomes an invented error in
// a child's report, so faithfulness matters more here than model size. The base
// model rewrites "Their was to much wind so we went hom" to "There was too much
// wind so we went home" and changes nothing else.
//
// The layer is optional by design. If the weights cannot be fetched, the
// analyser degrades to the lexicon and phonology layers and says so in its
// output, rather than failing the request.

const DEFAULT_MODEL = "Xenova/t5-base-grammar-correction";
const DEFAULT_PREFIX = "grammar: ";

let pipelinePromise = null;
let loadFailure = null;

export function gecConfig() {
  return {
    enabled: process.env.NLP_GEC !== "off",
    model: process.env.NLP_GEC_MODEL || DEFAULT_MODEL,
    // The vennify checkpoint was trained with a task prefix; other
    // checkpoints (grammar-synthesis) expect none, so this is overridable.
    prefix: process.env.NLP_GEC_PREFIX ?? DEFAULT_PREFIX,
    dtype: process.env.NLP_GEC_DTYPE || "q8",
  };
}

/**
 * Loads (and caches) the correction pipeline. First call downloads ~70 MB of
 * quantised weights from the Hugging Face hub; later calls are instant.
 */
export async function loadCorrector() {
  const config = gecConfig();
  if (!config.enabled) return null;
  if (loadFailure) return null;
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    // Weights are fetched once and cached on disk by Transformers.js.
    env.allowLocalModels = false;
    return pipeline("text2text-generation", config.model, { dtype: config.dtype });
  })().catch((err) => {
    loadFailure = err instanceof Error ? err.message : String(err);
    pipelinePromise = null;
    return null;
  });

  return pipelinePromise;
}

/**
 * Proposes a corrected version of each sentence.
 *
 * @param {string[]} sentences
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, corrections: (string|null)[], model: string|null, reason?: string }>}
 */
export async function correctSentences(sentences, { timeoutMs = 120_000 } = {}) {
  const config = gecConfig();
  if (!config.enabled) {
    return { ok: false, corrections: sentences.map(() => null), model: null, reason: "disabled" };
  }

  const corrector = await Promise.race([
    loadCorrector(),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), timeoutMs)),
  ]);

  if (corrector === "timeout") {
    return {
      ok: false,
      corrections: sentences.map(() => null),
      model: config.model,
      reason: "Model load exceeded the time budget. Run `npm run warm:nlp` once to cache the weights.",
    };
  }
  if (!corrector) {
    return {
      ok: false,
      corrections: sentences.map(() => null),
      model: config.model,
      reason: loadFailure ?? "Model unavailable",
    };
  }

  const corrections = [];
  for (const sentence of sentences) {
    try {
      const output = await corrector(`${config.prefix}${sentence}`, {
        max_new_tokens: Math.min(256, Math.ceil(sentence.length / 2) + 40),
        num_beams: 2,
        do_sample: false,
      });
      const text = Array.isArray(output) ? output[0]?.generated_text : output?.generated_text;
      corrections.push(typeof text === "string" ? text.trim() : null);
    } catch {
      corrections.push(null);
    }
  }

  return { ok: true, corrections, model: config.model };
}
