// Error taxonomy and the mapping from error categories to dyslexia profiles.
//
// The taxonomy follows the phonological / orthographic / morphological division
// used in the spelling-error literature, with two additions that matter for
// handwritten primary-school work: visual (reversal and transposition) errors,
// and word-boundary errors.
//
// The profile mapping is grounded in the dual-route model of reading and
// spelling. A writer who cannot hold the phoneme-grapheme mapping produces
// errors that do not sound like the target ("sret" for "street") — the
// phonological profile. A writer whose sub-lexical route is intact but whose
// stored word forms are not produces errors that sound exactly right but look
// wrong ("enuf", "wisle") — the surface / orthographic profile. Those two
// signatures are what this file encodes.
//
// IMPORTANT: a profile is a description of an error pattern in one writing
// sample. It is not a diagnosis and not a subtype label for a person.

export const ERROR_CATEGORIES = {
  phonological: {
    label: "Phonological",
    short: "Sounds are lost or changed",
    description:
      "The spelling does not represent the sounds of the target word. Phonemes are dropped, added or replaced, so the word cannot be read back correctly.",
    subtypes: {
      cluster_reduction: "Consonant cluster reduced (e.g. 'sret' for 'street')",
      vowel_omission: "Vowel left out of a syllable (e.g. 'lettr' for 'letter')",
      syllable_omission: "A whole syllable is missing (e.g. 'famly' for 'family')",
      phoneme_substitution: "A sound is replaced by an unrelated sound",
    },
  },
  orthographic: {
    label: "Orthographic",
    short: "Sounds right, spelled wrong",
    description:
      "The spelling is phonetically plausible — read aloud it gives the target word — but it breaks English spelling convention. This points at the stored visual word form rather than at sound processing.",
    subtypes: {
      phonetic_spelling: "Spelled as it sounds (e.g. 'enuf' for 'enough')",
      silent_letter: "A silent letter is omitted (e.g. 'wisle' for 'whistle')",
      vowel_pattern: "Wrong vowel team for the right sound (e.g. 'skool' for 'school')",
      doubling: "Doubled consonant added or dropped",
    },
  },
  morphological: {
    label: "Morphological",
    short: "Root is right, ending is wrong",
    description:
      "The root of the word is spelled correctly and the error sits at the prefix or suffix — including the junction rules English applies when an ending is added.",
    subtypes: {
      omission: "Ending left off (e.g. 'walk' for 'walked')",
      substitution: "Wrong ending used (e.g. 'walking' for 'walked')",
      addition: "Ending added where none belongs",
      junction_rule:
        "Ending attached without the spelling change it requires (e.g. 'runing', 'happyness')",
      phonetic_affix: "Ending spelled by sound rather than by morpheme (e.g. 'walkt' for 'walked')",
    },
  },
  visual: {
    label: "Visual",
    short: "Letters reversed or swapped",
    description:
      "Letters that are mirror images of one another are exchanged, or adjacent letters are swapped. Common in young writers as a developmental stage, so it carries weight only alongside other patterns.",
    subtypes: {
      letter_reversal: "Mirror-image letter substituted (b/d, p/q, m/w, n/u)",
      transposition: "Adjacent letters swapped (e.g. 'gril' for 'girl')",
    },
  },
  homophone: {
    label: "Homophone",
    short: "Right sound, wrong word",
    description:
      "A real word that sounds like the intended word was used instead of it (their/there, to/too). Spell-checkers cannot see these, and they depend on stored word forms rather than on sound.",
    subtypes: {
      homophone_confusion: "Homophone substituted for the target word",
    },
  },
  segmentation: {
    label: "Word boundary",
    short: "Words joined or split",
    description:
      "Two words are run together or one word is split apart, showing an unstable sense of where words begin and end.",
    subtypes: {
      run_together: "Two words written as one (e.g. 'alot')",
      split_word: "One word written as two (e.g. 'to gether')",
    },
  },
  grammatical: {
    label: "Grammatical",
    short: "Word choice or agreement",
    description:
      "A real-word substitution that changes grammar rather than spelling. Reported for completeness; it does not feed the spelling profile.",
    subtypes: {
      word_choice: "A different real word was used",
    },
  },
};

/**
 * How much each error category contributes to each profile.
 * Rows that map to nothing (grammatical) are deliberately absent.
 */
export const PROFILE_WEIGHTS = {
  phonological: { phonological: 1 },
  orthographic: { surface: 1 },
  homophone: { surface: 0.85 },
  morphological: { morphological: 1, phonological: 0.15 },
  visual: { visual: 1, surface: 0.35 },
  segmentation: { phonological: 0.45, surface: 0.3 },
};

export const PROFILES = {
  phonological: {
    label: "Phonological pattern",
    description:
      "Errors mostly do not preserve the sounds of the target word, which is the signature associated with difficulty mapping phonemes to graphemes.",
    intervention:
      "Structured, explicit phonics: phoneme segmentation and blending, grapheme-phoneme correspondence drills, and multisensory work on consonant clusters and vowels within syllables.",
  },
  surface: {
    label: "Surface / orthographic pattern",
    description:
      "Errors are phonetically plausible — the sounds survive but the conventional letter pattern does not — which is the signature associated with weak stored word forms rather than weak sound processing.",
    intervention:
      "Orthographic pattern work: word families and rimes, high-frequency irregular word study with visual recall (look-cover-write-check), homophone pairs in context, and morpheme-based vocabulary work.",
  },
  morphological: {
    label: "Morphological pattern",
    description:
      "Roots are spelled correctly and errors concentrate on prefixes, suffixes and the spelling changes English requires when endings are added.",
    intervention:
      "Explicit morphology: teach the doubling, drop-the-e and y-to-i rules directly, sort words by suffix, and practise building word families from a shared root.",
  },
  visual: {
    label: "Visual-orthographic pattern",
    description:
      "Reversals and letter swaps are prominent. In writers under roughly seven this is a common developmental stage and should not be read as an indicator on its own.",
    intervention:
      "Letter-formation and orientation work with multisensory cues for the confusable pairs, plus proof-reading routines that slow down letter-by-letter checking.",
  },
};

/** Below this many analysable lexical errors, no profile is claimed. */
export const MIN_ERRORS_FOR_PROFILE = 4;

/** Phoneme similarity at or above which a misspelling counts as sounding correct. */
export const PHONETIC_PLAUSIBILITY_THRESHOLD = 0.85;

/** Two profiles closer than this share the lead and the result is called mixed. */
export const MIXED_PROFILE_MARGIN = 0.15;

export const MIRROR_PAIRS = [
  ["b", "d"],
  ["p", "q"],
  ["b", "p"],
  ["d", "q"],
  ["m", "w"],
  ["n", "u"],
  ["s", "z"],
  ["g", "q"],
];

export function isMirrorPair(a, b) {
  const x = String(a).toLowerCase();
  const y = String(b).toLowerCase();
  return MIRROR_PAIRS.some(([p, q]) => (p === x && q === y) || (p === y && q === x));
}
