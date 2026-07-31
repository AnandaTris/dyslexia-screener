/**
 * Planned Unit Test — NLP pipeline stage 3: the T5 grammar-correction wrapper.
 *
 * DEVIATION FROM THE PLAN, stated up front. The plan says these stages "run
 * against the real local artefacts without network mocking". That holds for the
 * Hunspell and CMU dictionaries, which ship in node_modules — see
 * lexicon.test.js, which uses the real ones. It does not hold for T5: the
 * quantised weights are NOT in the repository. The first call to
 * `loadCorrector()` downloads about 70 MB from the Hugging Face hub and caches
 * it on disk, so a test that "runs it for real" is a 70 MB download on a cold
 * machine and a silent pass on a warm one — the least reproducible thing in the
 * suite, and it would put a network fetch in `npm test`.
 *
 * What is tested instead is the contract this wrapper actually owns: the
 * configuration it resolves, and the fact that a model it cannot load degrades
 * to a reported failure rather than throwing. That behaviour is the reason the
 * layer is optional by design, and it is what the analyser depends on.
 * `@huggingface/transformers` is stubbed so the failure is deterministic.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { correctSentences, gecConfig } from "./gec.js";

// Loading the pipeline fails, exactly as it does on a machine with no cached
// weights and no network.
vi.mock("@huggingface/transformers", () => ({
  env: {},
  pipeline: async () => {
    throw new Error("weights unavailable");
  },
}));

afterEach(() => vi.unstubAllEnvs());

describe("gecConfig", () => {
  it("defaults to the quantised t5-base grammar checkpoint, enabled", () => {
    vi.stubEnv("NLP_GEC", "");
    expect(gecConfig()).toMatchObject({
      enabled: true,
      model: "Xenova/t5-base-grammar-correction",
      prefix: "grammar: ",
      dtype: "q8",
    });
  });

  it("is switched off by NLP_GEC=off", () => {
    vi.stubEnv("NLP_GEC", "off");
    expect(gecConfig().enabled).toBe(false);
  });

  it("takes the model and prefix from the environment", () => {
    // Other checkpoints expect no task prefix, so an empty string has to be
    // distinguishable from "unset".
    vi.stubEnv("NLP_GEC_MODEL", "Xenova/grammar-synthesis-small");
    vi.stubEnv("NLP_GEC_PREFIX", "");
    expect(gecConfig()).toMatchObject({
      model: "Xenova/grammar-synthesis-small",
      prefix: "",
    });
  });
});

describe("correctSentences", () => {
  const SENTENCES = ["Their was to much wind.", "So we went hom."];

  it("reports 'disabled' without loading anything when the layer is off", async () => {
    vi.stubEnv("NLP_GEC", "off");

    const result = await correctSentences(SENTENCES);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("disabled");
    // One slot per sentence either way, so the caller can index by sentence
    // without checking whether the layer ran.
    expect(result.corrections).toEqual([null, null]);
  });

  it("returns a failure result carrying the reason when the model cannot load", async () => {
    vi.stubEnv("NLP_GEC", "on");

    const result = await correctSentences(SENTENCES, { timeoutMs: 5000 });

    // The layer is optional by design: an unavailable model degrades the
    // analysis to the lexicon and phonology passes, it does not throw.
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("weights unavailable");
    expect(result.model).toBe("Xenova/t5-base-grammar-correction");
    expect(result.corrections).toEqual([null, null]);
  });
});
