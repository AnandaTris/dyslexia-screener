// ARPAbet phoneme inventory with articulatory features, plus a
// feature-weighted distance between two phoneme sequences.
//
// Why not plain string equality: a dyslexic speller who writes "frend" for
// "friend" has produced the *same* sounds, while one who writes "sret" for
// "street" has dropped a phoneme. Both are one-word errors, but only the
// second one is evidence of a phoneme-grapheme mapping deficit. Comparing
// pronunciations with a graded, articulatory-aware distance is what lets us
// separate the two — that separation is the whole basis of the phonological
// vs. surface subtype distinction in the dual-route literature.

/** Vowels: [height 0-3 (low..high), backness 0-2 (front..back), rounded 0/1, diphthong 0/1] */
const VOWELS = {
  AA: [0, 2, 0, 0],
  AE: [0, 0, 0, 0],
  AH: [1, 1, 0, 0],
  AO: [1, 2, 1, 0],
  AW: [0, 1, 1, 1],
  AY: [0, 1, 0, 1],
  EH: [1, 0, 0, 0],
  ER: [1, 1, 0, 0],
  EY: [2, 0, 0, 1],
  IH: [2, 0, 0, 0],
  IY: [3, 0, 0, 0],
  OW: [2, 2, 1, 1],
  OY: [1, 2, 1, 1],
  UH: [2, 2, 1, 0],
  UW: [3, 2, 1, 0],
};

/** Consonants: [place 0-6, manner 0-5, voiced 0/1] */
const PLACE = {
  bilabial: 0,
  labiodental: 1,
  dental: 2,
  alveolar: 3,
  postalveolar: 4,
  velar: 5,
  glottal: 6,
};
const MANNER = {
  stop: 0,
  affricate: 1,
  fricative: 2,
  nasal: 3,
  liquid: 4,
  glide: 5,
};

const CONSONANTS = {
  P: [PLACE.bilabial, MANNER.stop, 0],
  B: [PLACE.bilabial, MANNER.stop, 1],
  T: [PLACE.alveolar, MANNER.stop, 0],
  D: [PLACE.alveolar, MANNER.stop, 1],
  K: [PLACE.velar, MANNER.stop, 0],
  G: [PLACE.velar, MANNER.stop, 1],
  CH: [PLACE.postalveolar, MANNER.affricate, 0],
  JH: [PLACE.postalveolar, MANNER.affricate, 1],
  F: [PLACE.labiodental, MANNER.fricative, 0],
  V: [PLACE.labiodental, MANNER.fricative, 1],
  TH: [PLACE.dental, MANNER.fricative, 0],
  DH: [PLACE.dental, MANNER.fricative, 1],
  S: [PLACE.alveolar, MANNER.fricative, 0],
  Z: [PLACE.alveolar, MANNER.fricative, 1],
  SH: [PLACE.postalveolar, MANNER.fricative, 0],
  ZH: [PLACE.postalveolar, MANNER.fricative, 1],
  HH: [PLACE.glottal, MANNER.fricative, 0],
  M: [PLACE.bilabial, MANNER.nasal, 1],
  N: [PLACE.alveolar, MANNER.nasal, 1],
  NG: [PLACE.velar, MANNER.nasal, 1],
  L: [PLACE.alveolar, MANNER.liquid, 1],
  R: [PLACE.alveolar, MANNER.liquid, 1],
  W: [PLACE.bilabial, MANNER.glide, 1],
  Y: [PLACE.postalveolar, MANNER.glide, 1],
};

export const IS_VOWEL = (p) => Object.hasOwn(VOWELS, p);
export const IS_CONSONANT = (p) => Object.hasOwn(CONSONANTS, p);

/** CMU entries carry stress digits (AH0, IY1). We compare segments, not stress. */
export function stripStress(phoneme) {
  return phoneme.replace(/\d/g, "");
}

export function normalisePhonemes(seq) {
  if (typeof seq === "string") seq = seq.split(/\s+/);
  return seq.map(stripStress).filter(Boolean);
}

/**
 * Substitution cost between two phonemes, 0 (identical) .. 1 (unrelated).
 * Costs are deliberately soft for contrasts that are *not* diagnostic:
 * vowel reduction and voicing slips happen in typical spelling too.
 */
export function phonemeDistance(a, b) {
  if (a === b) return 0;

  const va = VOWELS[a];
  const vb = VOWELS[b];
  if (va && vb) {
    // Schwa-like reduction (AH / IH / ER) is normal in unstressed syllables and
    // says nothing about phonological processing, so keep it very cheap.
    const reduced = new Set(["AH", "IH", "ER", "UH"]);
    if (reduced.has(a) && reduced.has(b)) return 0.08;

    const [h1, b1, r1, d1] = va;
    const [h2, b2, r2, d2] = vb;
    const raw =
      Math.abs(h1 - h2) / 3 +
      Math.abs(b1 - b2) / 2 +
      Math.abs(r1 - r2) +
      Math.abs(d1 - d2);
    return Math.min(0.65, 0.1 + raw * 0.16);
  }

  const ca = CONSONANTS[a];
  const cb = CONSONANTS[b];
  if (ca && cb) {
    const [p1, m1, g1] = ca;
    const [p2, m2, g2] = cb;
    if (p1 === p2 && m1 === m2) return 0.15; // voicing only: S/Z, T/D, F/V
    if (m1 === m2) return 0.4 + Math.min(0.15, Math.abs(p1 - p2) * 0.03);
    if (p1 === p2) return 0.5;
    // Stops and affricates share a closure; treat as closer than unrelated.
    if ((m1 === MANNER.stop && m2 === MANNER.affricate) ||
        (m2 === MANNER.stop && m1 === MANNER.affricate)) return 0.45;
    return 0.8;
  }

  // Syllabic consonants: "betr" for "better" and "litl" for "little" write the
  // /r/ and /l/ without the reduced vowel that carries them. Phonetically that
  // is the same segment, so it must not be scored as a lost phoneme.
  const syllabic = (x, y) => (x === "ER" && y === "R") || (x === "L" && y === "AH");
  if (syllabic(a, b) || syllabic(b, a)) return 0.25;

  // Vowel vs consonant: a genuine category error.
  return 1;
}

/**
 * Weighted Levenshtein over phoneme sequences.
 * Returns { distance, similarity, ops } where similarity is in [0, 1].
 */
export function phonemeSequenceDistance(seqA, seqB) {
  const a = normalisePhonemes(seqA);
  const b = normalisePhonemes(seqB);

  if (a.length === 0 && b.length === 0) {
    return { distance: 0, similarity: 1, ops: [] };
  }

  // Deleting or inserting a whole phoneme is the strongest signal we have, so
  // it costs a full unit — unlike a substitution, which is feature-scaled.
  const DEL = 1;
  const INS = 1;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const cost = Array.from({ length: rows }, () => new Float64Array(cols));
  const back = Array.from({ length: rows }, () => new Array(cols).fill(null));

  for (let i = 1; i < rows; i++) {
    cost[i][0] = cost[i - 1][0] + DEL;
    back[i][0] = "del";
  }
  for (let j = 1; j < cols; j++) {
    cost[0][j] = cost[0][j - 1] + INS;
    back[0][j] = "ins";
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const sub = cost[i - 1][j - 1] + phonemeDistance(a[i - 1], b[j - 1]);
      const del = cost[i - 1][j] + DEL;
      const ins = cost[i][j - 1] + INS;
      const best = Math.min(sub, del, ins);
      cost[i][j] = best;
      back[i][j] = best === sub ? "sub" : best === del ? "del" : "ins";
    }
  }

  const ops = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    const move = back[i][j];
    if (move === "sub") {
      if (a[i - 1] !== b[j - 1]) ops.push({ op: "sub", from: a[i - 1], to: b[j - 1] });
      i--;
      j--;
    } else if (move === "del") {
      ops.push({ op: "del", from: a[i - 1] });
      i--;
    } else {
      ops.push({ op: "ins", to: b[j - 1] });
      j--;
    }
  }
  ops.reverse();

  const distance = cost[a.length][b.length];
  const denom = Math.max(a.length, b.length) || 1;
  return {
    distance,
    similarity: Math.max(0, 1 - distance / denom),
    ops,
  };
}

/**
 * Best match between any plausible reading of a spelling and one target
 * pronunciation. "Could this spelling be read as the target?" is a maximum over
 * readings, not a comparison against a single guessed one.
 *
 * @param {string[][]} variants
 * @param {string[]} target
 */
export function bestPhonemeMatch(variants, target) {
  let best = null;
  for (const variant of variants) {
    const result = phonemeSequenceDistance(variant, target);
    if (!best || result.similarity > best.similarity) {
      best = { ...result, variant };
    }
  }
  return best ?? { distance: 0, similarity: 0, ops: [], variant: [] };
}
