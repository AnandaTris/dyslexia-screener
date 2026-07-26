/**
 * Planned Unit Test — NLP pipeline stage 5: the classifier.
 *
 * From the test plan: each stage tested in isolation against sample text. This
 * one takes a (produced, target) pair and returns the tagged error, so the
 * "sample text" is a word pair. No doubles: it runs against the real lexicon
 * and pronunciation artefacts, as the plan specifies.
 *
 * One test per branch of the classifier's decision order, because the order is
 * the design: every earlier branch exists to stop a structurally explainable
 * error from being scored as evidence about phoneme processing.
 */

import { describe, expect, it } from "vitest";
import { classifyError } from "./classify.js";

describe("classifyError", () => {
  it("tags a real-word substitution that sounds identical as a homophone", () => {
    const error = classifyError({ produced: "their", target: "there" });

    expect(error.category).toBe("homophone");
    expect(error.subtype).toBe("homophone_confusion");
    expect(error.soundsLikeTarget).toBe(true);
  });

  it("tags a real-word substitution that sounds different as a word choice", () => {
    const error = classifyError({ produced: "bog", target: "dog" });

    expect(error.category).toBe("grammatical");
    expect(error.subtype).toBe("word_choice");
  });

  it("tags an intact root with a broken ending as morphological", () => {
    expect(classifyError({ produced: "runing", target: "running" })).toMatchObject({
      category: "morphological",
      subtype: "junction_rule",
    });

    // Spelled by sound rather than by morpheme: the root survives, so this is an
    // affix error and not a whole-word phonetic spelling.
    expect(classifyError({ produced: "walkt", target: "walked" })).toMatchObject({
      category: "morphological",
      subtype: "phonetic_affix",
    });
  });

  it("tags an error explained entirely by a swap as visual", () => {
    const error = classifyError({ produced: "gril", target: "girl" });

    expect(error.category).toBe("visual");
    expect(error.subtype).toBe("transposition");
    // The sounds did not survive the swap, so phonology is recorded as a
    // secondary signal rather than discarded.
    expect(error.secondary).toContain("phonological");
  });

  it("tags a phonetically plausible misspelling as orthographic", () => {
    const error = classifyError({ produced: "enuf", target: "enough" });

    expect(error.category).toBe("orthographic");
    expect(error.subtype).toBe("silent_letter");
    expect(error.soundsLikeTarget).toBe(true);
  });

  it("tags a misspelling that loses the sounds as phonological", () => {
    const error = classifyError({ produced: "sret", target: "street" });

    expect(error.category).toBe("phonological");
    expect(error.subtype).toBe("cluster_reduction");
    expect(error.soundsLikeTarget).toBe(false);
  });

  it("carries the token's offsets and the reconstruction confidence through", () => {
    const error = classifyError({
      produced: "enuf",
      target: "enough",
      targetConfidence: 0.85,
      token: { start: 10, end: 14, sentence: 1 },
      source: "lexicon",
    });

    expect(error).toMatchObject({ start: 10, end: 14, sentence: 1, source: "lexicon" });
    expect(error.targetConfidence).toBe(0.85);
    expect(error.editOps.length).toBeGreaterThan(0);
  });

  it("returns null when there is no error to classify", () => {
    expect(classifyError({ produced: "friend", target: "friend" })).toBeNull();
    expect(classifyError({ produced: "", target: "friend" })).toBeNull();
  });
});
