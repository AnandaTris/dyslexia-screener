/**
 * Planned Unit Test — NLP pipeline stages 2 and 6: the word-boundary pass and
 * the aggregator.
 *
 * Both stages are internal to `analyzeWriting`, so they are exercised through
 * it with the neural layer switched off (`useNeural: false`). Everything else
 * runs for real against the local Hunspell and CMU dictionaries, as the plan
 * specifies. The T5 layer is the one artefact that is not in the repository —
 * see gec.test.js for why it is not downloaded here.
 */

import { describe, expect, it } from "vitest";
import { analyzeWriting } from "./analyze.js";
import { MIN_ERRORS_FOR_PROFILE } from "./taxonomy.js";

const OFFLINE = { useNeural: false };

// Four misspellings that survive without the contextual layer, in a sample long
// enough for a profile to be claimed.
const SAMPLE =
  "My frend and I went to the park after school. " +
  "The sun was brite so we bilt a sand castle togather. " +
  "I was very tird and we did not have enuf time to play. " +
  "We walked home befor it got dark.";

describe("word-boundary pass", () => {
  it("finds two words run together", async () => {
    const { errors } = await analyzeWriting(
      "I saw alot of birds in the park today and it was fun.",
      OFFLINE,
    );

    expect(errors).toContainEqual(
      expect.objectContaining({
        category: "segmentation",
        subtype: "run_together",
        produced: "alot",
        target: "a lot",
      }),
    );
  });

  it("finds one word split into two", async () => {
    const { errors } = await analyzeWriting(
      "We went to gether to the park today and it was fun.",
      OFFLINE,
    );

    expect(errors).toContainEqual(
      expect.objectContaining({
        category: "segmentation",
        subtype: "split_word",
        produced: "to gether",
        target: "together",
      }),
    );
  });

  it("does not split a misspelling that a single word explains better", async () => {
    // "frend" splits into "fr" + "end", but "friend" is the better story, and a
    // spurious boundary error would change the profile.
    const { errors } = await analyzeWriting(SAMPLE, OFFLINE);
    const frend = errors.find((e) => e.produced === "frend");

    expect(frend.category).not.toBe("segmentation");
    expect(frend.target).toBe("friend");
  });
});

describe("aggregator", () => {
  it("tags the sample's errors and rolls them into a profile", async () => {
    const analysis = await analyzeWriting(SAMPLE, { ...OFFLINE, writerAge: 9 });

    expect(analysis.ok).toBe(true);
    expect(analysis.statistics.words).toBe(41);

    // Every non-word was reconstructed and classified.
    const byProduced = Object.fromEntries(analysis.errors.map((e) => [e.produced, e]));
    expect(byProduced.frend).toMatchObject({ target: "friend", category: "orthographic" });
    expect(byProduced.enuf).toMatchObject({ target: "enough", subtype: "silent_letter" });
    expect(byProduced.brite).toMatchObject({ target: "bright" });

    // Counts are per category and per subtype, and they add up.
    const counted = Object.values(analysis.categoryCounts).reduce((a, b) => a + b, 0);
    expect(counted).toBe(analysis.errors.length);
    expect(analysis.categoryCounts.orthographic).toBeGreaterThanOrEqual(4);

    // The sounds survive but the letter patterns do not, which is the surface
    // signature rather than the phonological one.
    expect(analysis.profile.dominant).toBe("surface");
    expect(analysis.profile.confidence).toBeGreaterThan(0);
    expect(analysis.profile.errorRate).toBeCloseTo(
      analysis.profile.profiledErrors / analysis.statistics.words,
      2,
    );
    expect(analysis.summary).toContain("41 words");
  });

  it("finds letter-level patterns that recur across the sample", async () => {
    const { recurringPatterns } = await analyzeWriting(SAMPLE, OFFLINE);

    // "brite" for "bright" and "enuf" for "enough" both drop the same letter.
    expect(recurringPatterns.map((p) => p.pattern)).toContain('missing "g"');
    for (const pattern of recurringPatterns) expect(pattern.count).toBeGreaterThanOrEqual(2);
  });

  it("claims no profile when there are too few errors to describe one", async () => {
    const analysis = await analyzeWriting(
      "I went to the park and saw a brite light in the sky today.",
      OFFLINE,
    );

    expect(analysis.ok).toBe(true);
    expect(analysis.profile.profiledErrors).toBeLessThan(MIN_ERRORS_FOR_PROFILE);
    expect(analysis.profile.dominant).toBeNull();
    expect(analysis.profile.label).toBe("Not enough errors to describe a pattern");
  });

  it("says in its caveats that the contextual layer did not run", async () => {
    const { caveats, pipeline } = await analyzeWriting(SAMPLE, OFFLINE);

    expect(pipeline.layers).toMatchObject({ boundary: true, lexicon: true, neural: false });
    expect(caveats.some((c) => c.includes("contextual correction model was unavailable"))).toBe(true);
    // The report never claims to be a diagnosis, whatever else it says.
    expect(caveats.at(-1)).toContain("not a diagnosis");
  });

  it("warns that reversals are developmentally normal for a young writer", async () => {
    const { caveats } = await analyzeWriting("The bog ran to the barn and the ball was reb.", {
      ...OFFLINE,
      writerAge: 6,
    });

    expect(caveats.some((c) => /age 6|developmentally common/i.test(c))).toBe(true);
  });

  it("refuses a sample with no readable words", async () => {
    const analysis = await analyzeWriting("   ", OFFLINE);

    expect(analysis.ok).toBe(false);
    expect(analysis.error).toBe("No readable words were found in the sample.");
  });
});
