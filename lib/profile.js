// Maps each screening indicator category to the dyslexia "profile emphasis"
// dimension(s) it informs. This is a screening emphasis, NOT a clinical subtype.
const CATEGORY_MAP = {
  phonetic_spelling: ["phonological"],
  omission: ["phonological"],
  transposition: ["phonological"],
  homophone: ["phonological", "surface"],
  inconsistency: ["surface"],
  case: ["surface"],
  reversal: ["visual_spatial"],
  formation: ["visual_spatial"],
  spacing: ["visual_spatial"],
  sizing: ["visual_spatial"],
};

const STRENGTH = { weak: 1, moderate: 2, strong: 3 };

export function deriveProfile(indicators) {
  if (!Array.isArray(indicators) || indicators.length === 0) return null;

  const weights = { phonological: 0, surface: 0, visual_spatial: 0 };
  for (const ind of indicators) {
    const dims = CATEGORY_MAP[ind?.category] || [];
    const w = STRENGTH[ind?.strength] || 1;
    for (const d of dims) weights[d] += w;
  }

  const total = weights.phonological + weights.surface + weights.visual_spatial;
  if (total === 0) return null;

  const primary_label = Object.keys(weights).reduce((a, b) =>
    weights[b] > weights[a] ? b : a
  );
  return { weights, primary_label };
}
