// Morphological analysis of a misspelling.
//
// The distinction that matters clinically is *where* the error sits. A writer
// who spells the root correctly and only ever fails at the affix boundary
// ("runing", "happyness", "walkt") has intact word-level orthography and a
// specific weakness in morphological spelling rules — a different teaching
// target from a writer whose roots are unstable. So this module tries to split
// both words into stem + affix and report which part broke.

const INFLECTIONAL = ["ing", "est", "ed", "es", "er", "s"];
const DERIVATIONAL = [
  "tion", "sion", "ment", "ness", "less", "able", "ible", "ity", "ous",
  "ful", "ive", "ist", "ly", "al", "or", "y",
];
const PREFIXES = [
  "under", "inter", "over", "dis", "mis", "non", "pre", "sub", "un", "re", "in", "im",
];

/** Suffixes longest-first so "ness" wins over "s". */
const SUFFIXES = [...DERIVATIONAL, ...INFLECTIONAL].sort((a, b) => b.length - a.length);

/** @returns {{ stem: string, suffix: string|null, suffixType: string|null, prefix: string|null }} */
export function decompose(word) {
  const w = String(word).toLowerCase();
  let stem = w;
  let prefix = null;

  for (const p of PREFIXES) {
    if (stem.startsWith(p) && stem.length - p.length >= 3) {
      prefix = p;
      stem = stem.slice(p.length);
      break;
    }
  }

  for (const s of SUFFIXES) {
    if (stem.endsWith(s) && stem.length - s.length >= 2) {
      return {
        stem: stem.slice(0, -s.length),
        suffix: s,
        suffixType: INFLECTIONAL.includes(s) ? "inflectional" : "derivational",
        prefix,
      };
    }
  }

  return { stem, suffix: null, suffixType: null, prefix };
}

/**
 * English spells the stem+suffix junction with three rules that a naive
 * concatenation breaks. Given the *modified* stem taken off a real word, guess
 * the base form the writer would have started from.
 */
function baseFormCandidates(stem) {
  const forms = new Set([stem]);
  if (/([bcdfglmnprstvz])\1$/.test(stem)) forms.add(stem.slice(0, -1)); // run+n+ing
  if (stem.endsWith("i")) forms.add(`${stem.slice(0, -1)}y`); // happy -> happi
  forms.add(`${stem}e`); // make -> mak + ing
  return [...forms];
}

/**
 * @returns {{
 *   stemMatches: boolean,
 *   affixError: null | "omission" | "substitution" | "addition" | "junction_rule",
 *   junctionRule: null | "consonant_doubling" | "y_to_i" | "silent_e_drop",
 *   producedSuffix: string|null,
 *   targetSuffix: string|null,
 *   suffixType: string|null,
 * }}
 */
export function analyseMorphology(produced, target) {
  const p = String(produced).toLowerCase();
  const t = String(target).toLowerCase();
  const pd = decompose(p);
  const td = decompose(t);

  const base = {
    stemMatches: pd.stem === td.stem,
    affixError: null,
    junctionRule: null,
    producedSuffix: pd.suffix,
    targetSuffix: td.suffix,
    suffixType: td.suffixType ?? pd.suffixType,
  };

  // The stem+suffix junction was spelled by naive concatenation.
  if (td.suffix) {
    for (const form of baseFormCandidates(td.stem)) {
      if (form + td.suffix !== p) continue;
      base.stemMatches = true;
      base.affixError = "junction_rule";
      base.junctionRule = form.endsWith("y")
        ? "y_to_i"
        : form.endsWith("e")
          ? "silent_e_drop"
          : "consonant_doubling";
      return base;
    }
  }

  // The ending was spelled by sound rather than by morpheme: "walkt" for
  // "walked", "dogz" for "dogs". The root is intact, so this is an affix
  // error, not a whole-word phonetic spelling.
  const PHONETIC_AFFIX = { ed: ["t", "d", "id"], es: ["z", "s", "iz"], s: ["z"] };
  const spokenForms = PHONETIC_AFFIX[td.suffix ?? ""] ?? [];
  for (const form of baseFormCandidates(td.stem)) {
    if (!spokenForms.some((ending) => form + ending === p)) continue;
    base.stemMatches = true;
    base.affixError = "phonetic_affix";
    return base;
  }

  if (!base.stemMatches) return base;

  if (td.suffix && !pd.suffix) base.affixError = "omission";
  else if (!td.suffix && pd.suffix) base.affixError = "addition";
  else if (td.suffix !== pd.suffix) base.affixError = "substitution";

  return base;
}
