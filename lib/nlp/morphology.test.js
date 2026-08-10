/**
 * Planned Unit Test — NLP pipeline stage 5: morphological decomposition.
 *
 * Two callers depend on this module and both depend on it narrowly.
 * classify.js promotes an error to category "morphological" only when
 * analyseMorphology reports an affixError *and* stemMatches; lexicon.js pays a
 * ranking bonus only for the exact string "junction_rule". So the tests below
 * pin the junction rules by name, and — just as load-bearing — the pairs where
 * no rule may fire, because a false positive here reroutes a root-level
 * spelling error away from the phonological evidence that should explain it,
 * and hands the teacher the wrong lesson.
 */

import { describe, expect, it } from "vitest";
import { analyseMorphology, decompose } from "./morphology.js";

describe("decompose", () => {
  it("takes the longest suffix, so 'ness' beats the trailing 's'", () => {
    expect(decompose("happiness")).toMatchObject({
      stem: "happi",
      suffix: "ness",
      suffixType: "derivational",
    });
    expect(decompose("running")).toMatchObject({
      stem: "runn",
      suffix: "ing",
      suffixType: "inflectional",
    });
  });

  it("leaves a short word whole rather than tearing its stem down to one letter", () => {
    // Function words are what would break: "as" and "bed" both end in something
    // on the suffix list, and a stem of "a" or "b" would then be compared for
    // equality against the stem of every other word in the sample.
    expect(decompose("as")).toMatchObject({ stem: "as", suffix: null, suffixType: null });
    expect(decompose("bed")).toMatchObject({ stem: "bed", suffix: null });
    // One letter more and the split is worth making.
    expect(decompose("beds")).toMatchObject({ stem: "bed", suffix: "s" });
  });

  it("strips the longest matching prefix, and only when three letters survive", () => {
    // "under" has to be tried before "un", or every under- word would keep a
    // "der" fragment welded to the front of its stem.
    expect(decompose("understand")).toMatchObject({ prefix: "under", stem: "stand" });
    expect(decompose("unhappy")).toMatchObject({ prefix: "un", stem: "happ", suffix: "y" });
    // "undo" would be left as "do", which is a word in its own right and would
    // make the stem comparison meaningless.
    expect(decompose("undo")).toMatchObject({ prefix: null, stem: "undo" });
  });
});

describe("analyseMorphology", () => {
  it("names consonant_doubling when the writer concatenated without doubling", () => {
    expect(analyseMorphology("runing", "running")).toMatchObject({
      stemMatches: true,
      affixError: "junction_rule",
      junctionRule: "consonant_doubling",
      targetSuffix: "ing",
      suffixType: "inflectional",
    });
    expect(analyseMorphology("biger", "bigger").junctionRule).toBe("consonant_doubling");

    // The plain decompositions disagree — "run" against "runn" — so stemMatches
    // is true only because the junction branch reconstructed the base form and
    // overrode it. classify.js demands stemMatches before it will call anything
    // morphological, so losing that override loses the whole category.
    expect(decompose("runing").stem).not.toBe(decompose("running").stem);
  });

  it("names silent_e_drop when the writer kept the stem's final e", () => {
    // The pair lexicon.js cites when it explains the scoring bonus: "hopeing"
    // must resolve to "hoping" rather than to the string-similar "hopping".
    expect(analyseMorphology("hopeing", "hoping")).toMatchObject({
      stemMatches: true,
      affixError: "junction_rule",
      junctionRule: "silent_e_drop",
    });
    expect(analyseMorphology("useing", "using").junctionRule).toBe("silent_e_drop");
  });

  it("names y_to_i when the writer left the y in place", () => {
    // Both sides of the inflectional/derivational split, because the rule is
    // taught once but applies across suffix families.
    expect(analyseMorphology("cryed", "cried")).toMatchObject({
      stemMatches: true,
      junctionRule: "y_to_i",
      suffixType: "inflectional",
    });
    expect(analyseMorphology("happyness", "happiness")).toMatchObject({
      affixError: "junction_rule",
      junctionRule: "y_to_i",
      suffixType: "derivational",
    });
  });

  it("fires no junction rule when the root, not the boundary, is what broke", () => {
    // "freinds" carries a perfectly formed plural -s and "quikly" a perfectly
    // formed -ly; the damage is inside the root. Reporting a junction rule here
    // would tell a teacher to drill suffix rules at a writer whose suffixes are
    // the only part they got right.
    expect(analyseMorphology("freinds", "friends")).toMatchObject({
      stemMatches: false,
      affixError: null,
      junctionRule: null,
    });
    expect(analyseMorphology("quikly", "quickly")).toMatchObject({
      stemMatches: false,
      affixError: null,
      junctionRule: null,
    });
    // No suffix on the target at all, so there is no junction to get wrong.
    expect(analyseMorphology("littel", "little")).toMatchObject({
      affixError: null,
      junctionRule: null,
      targetSuffix: null,
    });
  });

  it("separates an ending spelled by sound from an ending spelled by rule", () => {
    // "walkt" and "dogz" transcribe the ending they heard. The root survived,
    // so this stays an affix error rather than being scored as evidence that
    // the writer cannot spell the word at all.
    expect(analyseMorphology("walkt", "walked")).toMatchObject({
      stemMatches: true,
      affixError: "phonetic_affix",
      junctionRule: null,
      targetSuffix: "ed",
    });
    expect(analyseMorphology("dogz", "dogs")).toMatchObject({
      stemMatches: true,
      affixError: "phonetic_affix",
    });
    // The branch may only rescue an intact root. "wokt" spells the whole word
    // by sound, and calling that an affix error would credit the writer with
    // root orthography they never demonstrated.
    expect(analyseMorphology("wokt", "walked")).toMatchObject({
      stemMatches: false,
      affixError: null,
    });
  });

  it("tells a missing, an added and a swapped ending apart on an intact root", () => {
    expect(analyseMorphology("jump", "jumped")).toMatchObject({
      stemMatches: true,
      affixError: "omission",
      producedSuffix: null,
      targetSuffix: "ed",
    });
    expect(analyseMorphology("jumping", "jumped")).toMatchObject({
      affixError: "substitution",
      producedSuffix: "ing",
      targetSuffix: "ed",
    });

    const added = analyseMorphology("runs", "run");
    expect(added).toMatchObject({ affixError: "addition", producedSuffix: "s", targetSuffix: null });
    // The target has no suffix to describe, so the type has to come from what
    // the writer actually produced — otherwise every added ending would report
    // a null suffixType and the report could not say which system misfired.
    expect(added.suffixType).toBe("inflectional");
  });
});
