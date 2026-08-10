/**
 * Unit test — NLP pipeline: the error taxonomy.
 *
 * taxonomy.js holds almost no logic; it is a table of constants plus
 * `isMirrorPair`. That is precisely why it needs pinning. `analyze.js` reads
 * these weights and thresholds directly to decide which profile a learner's
 * writing sample is given, and README.md and docs/NLP_ARCHITECTURE.md quote the
 * same numbers back to the reader as the published methodology. A one-character
 * edit here reclassifies every learner and makes the documentation wrong, and
 * nothing else in the repository would fail — the pipeline suites assert
 * relative outcomes ("this sample is surface-dominant"), which survive a
 * proportional change to the whole table.
 *
 * So these tests pin the published values, and the structural invariants that
 * `analyze.js` depends on but never checks.
 */

import { describe, expect, it } from "vitest";
import {
  ERROR_CATEGORIES,
  MIN_ERRORS_FOR_PROFILE,
  MIXED_PROFILE_MARGIN,
  PHONETIC_PLAUSIBILITY_THRESHOLD,
  PROFILES,
  PROFILE_WEIGHTS,
  isMirrorPair,
} from "./taxonomy.js";

describe("published thresholds", () => {
  it("pins the three numbers the methodology quotes to users", () => {
    // README.md tells the reader in prose that "if a sample has fewer than four
    // analysable errors, no profile is claimed at all". This constant is the
    // only thing enforcing that sentence, so lowering it to 3 would let the tool
    // label a learner off a single sentence while the documentation still
    // promises four.
    expect(MIN_ERRORS_FOR_PROFILE).toBe(4);

    // The single most consequential number in the pipeline: classify.js splits
    // phonological from orthographic on whether phoneme similarity reaches this
    // line, and those are the two profiles the dual-route model exists to
    // distinguish. Moving it moves the boundary between the two headline
    // results, not just a confidence figure.
    expect(PHONETIC_PLAUSIBILITY_THRESHOLD).toBe(0.85);

    // The honesty guard: below this separation analyze.js reports "mixed"
    // rather than crowning the leader. Shrinking it towards zero would turn
    // every near-tie into a confident single-profile claim.
    expect(MIXED_PROFILE_MARGIN).toBe(0.15);
  });
});

describe("category to profile weights", () => {
  it("pins the published weight table", () => {
    // Written out in full rather than spot-checked so that a regression diff
    // names the exact row that moved. These values are reproduced verbatim in
    // docs/NLP_ARCHITECTURE.md section 3; the two must not drift apart.
    expect(PROFILE_WEIGHTS).toEqual({
      phonological: { phonological: 1 },
      orthographic: { surface: 1 },
      homophone: { surface: 0.85 },
      morphological: { morphological: 1, phonological: 0.15 },
      visual: { visual: 1, surface: 0.35 },
      segmentation: { phonological: 0.45, surface: 0.3 },
    });
  });

  it("leaves grammatical unweighted so a word choice cannot claim a profile", () => {
    // analyze.js skips a category with no weights via `continue` *before* it
    // increments profiledErrors. That ordering is what makes the exclusion real:
    // a sample whose only errors are real-word substitutions never reaches the
    // four-error gate, so it gets "not enough errors" rather than a profile
    // built from evidence the taxonomy says is unrelated to spelling.
    expect(PROFILE_WEIGHTS.grammatical).toBeUndefined();

    // It stays a reportable category, though — excluded from the profile is not
    // the same as invisible to the teacher.
    expect(ERROR_CATEGORIES.grammatical).toBeDefined();
  });

  it("only ever names profiles that PROFILES defines and analyze.js seeds", () => {
    const targeted = new Set(
      Object.values(PROFILE_WEIGHTS).flatMap((weights) => Object.keys(weights)),
    );
    for (const profile of targeted) {
      expect(PROFILES).toHaveProperty(profile);
    }

    // analyze.js seeds its accumulator with these four keys hard-coded. A weight
    // pointing at a fifth profile would add to `undefined`, poisoning that score
    // with NaN and then the normalised total with it — every share would come
    // back NaN rather than throwing anywhere a developer would notice.
    expect(Object.keys(PROFILES).sort()).toEqual([
      "morphological",
      "phonological",
      "surface",
      "visual",
    ]);
  });

  it("only ever keys categories that ERROR_CATEGORIES defines", () => {
    // buildSummary dereferences ERROR_CATEGORIES[category].label for every
    // weighted category with no optional chaining, so a weight row naming a
    // category that does not exist crashes the whole analysis at the last step,
    // after the expensive NLP work has already run.
    for (const category of Object.keys(PROFILE_WEIGHTS)) {
      expect(ERROR_CATEGORIES).toHaveProperty(category);
    }
  });
});

describe("ERROR_CATEGORIES", () => {
  it("keeps the seven published categories", () => {
    // Membership, not order, is the contract — reordering the table is
    // cosmetic, but adding a category is not: an unweighted newcomer is
    // silently dropped from every profile by the `continue` in buildProfile,
    // which looks like the classifier ignoring errors rather than a missing row
    // in PROFILE_WEIGHTS.
    expect(Object.keys(ERROR_CATEGORIES).sort()).toEqual([
      "grammatical",
      "homophone",
      "morphological",
      "orthographic",
      "phonological",
      "segmentation",
      "visual",
    ]);
  });

  it("gives every category and subtype the teacher-facing copy the UI renders", () => {
    for (const [name, category] of Object.entries(ERROR_CATEGORIES)) {
      expect(category.label, `${name}.label`).toBeTruthy();
      expect(category.short, `${name}.short`).toBeTruthy();
      expect(category.description, `${name}.description`).toBeTruthy();

      // classify.js resolves subtypeLabel through this map and falls back to
      // null rather than throwing, so a subtype added to the classifier without
      // a description here degrades into a blank line in the report instead of
      // any visible failure.
      const subtypes = Object.entries(category.subtypes ?? {});
      expect(subtypes.length, `${name}.subtypes`).toBeGreaterThan(0);
      for (const [subtype, description] of subtypes) {
        expect(typeof description, `${name}.${subtype}`).toBe("string");
        expect(description.length, `${name}.${subtype}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("PROFILES", () => {
  it("gives every profile the three strings the report interpolates", () => {
    // The mixed-profile branch of analyze.js builds its prose by concatenating
    // the runner-up's description and intervention onto the leader's, calling
    // .charAt(0) on each. A missing field there throws; a blank one prints a
    // sentence fragment into advice a teacher is meant to act on.
    for (const [name, profile] of Object.entries(PROFILES)) {
      expect(profile.label, `${name}.label`).toBeTruthy();
      expect(profile.description, `${name}.description`).toBeTruthy();
      expect(profile.intervention, `${name}.intervention`).toBeTruthy();
    }
  });
});

describe("isMirrorPair", () => {
  it("recognises the confusable pairs the visual subtype names, either order and either case", () => {
    // These four are the pairs the letter_reversal subtype description promises
    // to a teacher. classify.js lowercases before calling, but the function
    // documents case-insensitivity on its own, and the symmetry matters because
    // the alignment decides which letter lands in `from` and which in `to`.
    for (const [a, b] of [
      ["b", "d"],
      ["p", "q"],
      ["m", "w"],
      ["n", "u"],
    ]) {
      expect(isMirrorPair(a, b), `${a}/${b}`).toBe(true);
      expect(isMirrorPair(b, a), `${b}/${a}`).toBe(true);
      expect(isMirrorPair(a.toUpperCase(), b), `${a.toUpperCase()}/${b}`).toBe(true);
    }
  });

  it("rejects a letter against itself and letters that are merely similar", () => {
    // The negative side is load-bearing: step 3 of the classifier diverts an
    // error to the visual category as soon as every substitution is a mirror
    // pair. Widening this predicate would pull ordinary vowel-team and nasal
    // errors — the substance of the orthographic and phonological categories —
    // into a bucket the tool explicitly discounts for young writers.
    expect(isMirrorPair("b", "b")).toBe(false);
    expect(isMirrorPair("a", "e")).toBe(false);
    expect(isMirrorPair("n", "m")).toBe(false);
    expect(isMirrorPair("i", "l")).toBe(false);
  });
});
