/**
 * Planned Unit Test — NLP pipeline stage 1: the tokeniser.
 *
 * From the test plan: "NLP pipeline stages (tokeniser, word boundary pass, T5
 * grammar correction wrapper, Hunspell matcher, classifier, aggregator): each
 * stage tested in isolation against sample text."
 *
 * Sample text in, tokens out. No doubles — this stage has no collaborators.
 */

import { describe, expect, it } from "vitest";
import { splitSentences, textStatistics, tokenizeWords } from "./tokenize.js";

describe("splitSentences", () => {
  it("splits on terminal punctuation and records offsets", () => {
    const sentences = splitSentences("Hello there. How are you?");

    expect(sentences.map((s) => s.text)).toEqual(["Hello there.", "How are you?"]);
    expect(sentences[0].start).toBe(0);
    expect(sentences[1].start).toBe(13);
  });

  it("tolerates a missing full stop at the end", () => {
    // Children's writing routinely stops without punctuation; dropping the last
    // clause would lose the context the corrector stage needs.
    expect(splitSentences("Hello there. How are you").map((s) => s.text)).toEqual([
      "Hello there.",
      "How are you",
    ]);
  });

  it("returns nothing for blank text", () => {
    expect(splitSentences("   ")).toEqual([]);
    expect(splitSentences(undefined)).toEqual([]);
  });
});

describe("tokenizeWords", () => {
  it("keeps internal apostrophes and drops surrounding punctuation", () => {
    const tokens = tokenizeWords("Don't go. We're late");

    expect(tokens.map((t) => t.text)).toEqual(["Don't", "go", "We're", "late"]);
    expect(tokens.map((t) => t.normalised)).toEqual(["don't", "go", "we're", "late"]);
  });

  it("carries character offsets back into the original text", () => {
    const text = "Don't go. We're late";
    const tokens = tokenizeWords(text);

    // Every finding reported later is pointed at the page through these offsets,
    // so they have to index the untouched source.
    for (const token of tokens) {
      expect(text.slice(token.start, token.end)).toBe(token.text);
    }
  });

  it("records which sentence each token belongs to", () => {
    expect(tokenizeWords("Don't go. We're late").map((t) => t.sentence)).toEqual([0, 0, 1, 1]);
  });

  it("normalises a curly apostrophe to a straight one", () => {
    expect(tokenizeWords("don’t").map((t) => t.normalised)).toEqual(["don't"]);
  });
});

describe("textStatistics", () => {
  it("counts characters, words, sentences and unique words", () => {
    const stats = textStatistics("The cat sat. The cat ran.");

    expect(stats.characters).toBe(25);
    expect(stats.words).toBe(6);
    expect(stats.sentences).toBe(2);
    expect(stats.uniqueWords).toBe(4); // the, cat, sat, ran
    expect(stats.averageWordLength).toBeCloseTo(3, 5);
  });

  it("does not divide by zero on empty input", () => {
    expect(textStatistics("")).toMatchObject({ words: 0, averageWordLength: 0 });
  });
});
