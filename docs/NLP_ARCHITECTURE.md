# PS4 — Error Pattern Analyzer: NLP architecture

Covers the documentation items Problem Statement 4 asks for: NLP architecture and
tokenisation strategy, error taxonomy and classification rationale, and evaluation
methodology.

All code referenced lives in `lib/nlp/`.

---

## 1. What the subsystem answers

Given a writing sample, PS4 asks us to detect recurring errors, categorise them
(phonological / orthographic / morphological), and produce something an educator can
act on.

The category question is the hard one, and it is not a spell-check question. Consider
two misspellings:

| Written | Intended | Sounds like the target? |
|---|---|---|
| `enuf` | enough | yes — /ɛ n ʌ f/ |
| `sret` | street | no — the /t/ of the cluster is gone |

A spell-checker treats these identically: two non-words, one edit away from a
suggestion. But they come from opposite places. `enuf` shows intact sound processing
and a missing stored word form. `sret` shows the sound itself did not survive.

That split is the **dual-route** distinction the dyslexia literature draws between a
*phonological* profile (the sub-lexical grapheme-phoneme route is impaired) and a
*surface / orthographic* profile (the lexical route is impaired). Reproducing it
mechanically is what this subsystem does.

**The system never outputs a diagnosis.** It describes an error pattern in one sample.
Every report carries that caveat.

---

## 2. Pipeline

```
text (typed, or transcribed from an image by the PS1 vision model)
  │
  ├─ tokenise ─────────── sentences (context) + word tokens (offsets)   tokenize.js
  │
  ├─ word-boundary pass ─ run-together / split words                    analyze.js
  │
  ├─ neural pass ──────── Transformers.js GEC → intended wording        gec.js
  │
  ├─ lexicon pass ─────── Hunspell + phonetic search → intended word    lexicon.js
  │
  ├─ classify ─────────── phonology + morphology + alignment            classify.js
  │
  └─ aggregate ────────── rates, recurring patterns, profile            analyze.js
```

### 2.1 Tokenisation strategy (`tokenize.js`)

Two levels, because the two detection layers need different things.

- **Sentences** (`splitSentences`) — the neural corrector needs a whole clause. A
  homophone error is invisible without one: `their` and `there` are both perfectly
  good words, and only the surrounding sentence says which was meant.
- **Word tokens** (`tokenizeWords`) — a regex over `[A-Za-z]+(?:['’][A-Za-z]+)*`,
  keeping internal apostrophes (`don't`) and dropping surrounding punctuation. Each
  token stores its `start`/`end` character offsets into the original text and its
  sentence index, so every finding can be pointed back at the exact spot on the page.

Deliberately **not** using a subword tokeniser for analysis. BPE/SentencePiece splits
by corpus frequency, which cuts across the morpheme boundaries we need to reason about
(`hope|ing` vs `hop|ing`). The T5 model uses SentencePiece internally, but only inside
`gec.js`; nothing downstream sees those pieces.

### 2.2 Word-boundary pass

Catches `alot` → `a lot` and `to gether` → `together`. Three guards keep it
conservative, because a naive splitter fires constantly:

1. Both halves must contain a vowel — this rejects `fr|end`, `pl|ad`, `st|oped`.
2. The joined form must sound identical to the two halves in sequence — this rejects
   `be|cos`, where `be` and `cos` are both real words.
3. The split must beat the best single-word reconstruction — this keeps `frend` as a
   misspelling of `friend` rather than becoming `fr end`.

Joins are tested before splits: read alone, `gether` splits into `get her`, so the pass
that has both tokens in view must claim them first.

### 2.3 Neural pass — the open-source model (`gec.js`)

| | |
|---|---|
| Model | `Xenova/t5-base-grammar-correction` |
| Base | `vennify/t5-base-grammar-correction` (T5-base, Apache-2.0, JFLEG) |
| Runtime | `@huggingface/transformers` (Transformers.js, Apache-2.0), ONNX, `q8` |
| Where it runs | Locally, in the Node process. Nothing is sent to a third party. |
| Size | ~70 MB quantised, downloaded once and cached (`npm run warm:nlp`) |

**Why a neural model is needed at all.** A dictionary can only see words that do not
exist. It is structurally blind to `their` for `there`, `to` for `too`, and to any
misspelling whose target is ambiguous out of context. A sequence-to-sequence corrector
reads the sentence and proposes the intended wording — the one signal the lexicon layer
can never produce.

**Why this checkpoint and not `Xenova/grammar-synthesis-small`.** Both were measured on
this project's samples. The smaller model hallucinates:

| Input | grammar-synthesis-small | t5-base-grammar-correction |
|---|---|---|
| `The dof ran to the bark and the dall was reb.` | *"The dog was killed by a car wreck."* | "The dove ran to the bark and the doll was reb." |
| `Their was to much wind so we went hom.` | *"They were so fast and we went."* | "There was too much wind so we went home." |

In a diagnostic tool an invented rewrite becomes an invented error in a child's report.
Faithfulness matters more than model size here. The model is configurable via
`NLP_GEC_MODEL` / `NLP_GEC_PREFIX` / `NLP_GEC_DTYPE`, and `NLP_GEC=off` disables the
layer entirely.

**Guarding against paraphrase.** A seq2seq model paraphrases as readily as it corrects,
so its proposals are filtered:

- Real word → real word is accepted **only when the two sound alike**. That is the
  homophone case, the only reason we consult the model about real words at all. It is
  what rejected the model's rewrite of "a sand castle" to "a and castle".
- Non-word → word is accepted as a *candidate*, then scored against the lexicon's own
  best guess on the same scale; the stronger wins. This is what turns the model's
  `frend → friends` back into `frend → friend`.

**Graceful degradation.** If the weights cannot be fetched the analyser runs on its
other layers and says so, both in `pipeline.layers` and in a caveat on the report.

### 2.4 Lexicon pass (`lexicon.js`)

- **Is this a word?** Hunspell via `nspell` + `dictionary-en` (MIT / BSD).
- **What was meant?** Hunspell's own `suggest()` is tuned for typists — for `enuf` it
  returns only `Enif` — so target reconstruction is ours: the union of
  - orthographic neighbours (Norvig edit-1, widening to edit-2 when edit-1 is thin), and
  - a **phonetic index** inverting the CMU Pronouncing Dictionary (135k words) by
    consonant skeleton. `enuf` → /ɛ n ʌ f/ → skeleton `N.F` → reaches `enough`, which is
    three letter-edits away and unreachable by orthographic search.

Candidates are ranked by

```
0.60 × phonetic similarity      (best over plausible readings)
0.25 × orthographic similarity  (1 − normalised Levenshtein)
0.15 × high-frequency prior
0.10 × explains-as-suffix-rule bonus
```

Sound is weighted above letters on purpose: `nite` is three edits from `night` but one
from `nice`, and only `night` is a perfect phonetic match. The frequency prior exists
because Hunspell accepts rare words and proper nouns a school-age writer never meant;
proper nouns are additionally excluded by requiring the *lowercase* form to be in the
dictionary.

### 2.5 Grapheme-to-phoneme (`g2p.js`, `phonemes.js`)

The phonological test needs the pronunciation of the *misspelling*, which by definition
is not in any dictionary. Two paths:

- Real words → CMU Pronouncing Dictionary (ISC licence).
- Non-words → a context-sensitive letter-to-sound rule engine (~120 rules, ARPAbet
  output, in the tradition of the NRL letter-to-sound rules). It does not need to handle
  irregular real words, because those resolve through CMU first.

Because English single vowels are ambiguous out of context (`hom` could be *hot*-vowel
or *home*-vowel), the engine also emits **variant readings**, and comparisons take the
maximum. The question is "could this spelling be read as the target?", which is a
maximum over readings, not a single guess.

Comparison is a **feature-weighted** Levenshtein over phoneme sequences, not string
equality. Substitution cost comes from articulatory features, so contrasts that are not
diagnostic stay cheap:

- voicing only (S/Z, T/D, TH/DH) → 0.15
- schwa-ish reduction (AH/IH/ER/UH) → 0.08
- syllabic consonants (ER↔R, L↔AH) → 0.25 — `betr` for `better` writes the same segment
- vowel ↔ consonant → 1.0
- **deleting or inserting a whole phoneme → 1.0**, the strongest signal available

`soundsLikeTarget` is `similarity ≥ 0.85`.

### 2.6 Classification (`classify.js`)

Decision order, deliberate:

1. **Both words real** → homophone (sim ≥ 0.95) or word-choice.
2. **Root intact, ending broken** → morphological, whatever the sounds do.
3. **Explained entirely by a swap or mirror-letter pair** (≤ 2 edits) → visual.
4. **Everything else** → phonological or orthographic, split on `soundsLikeTarget`.

Step 4 is the load-bearing one. Every earlier step exists to stop a structurally
explainable error from being scored as evidence about phoneme processing when it is
really about something else.

Morphology (`morphology.js`) decomposes both words into prefix + stem + suffix and
recognises the three English junction rules a naive concatenation breaks — consonant
doubling (`runing`), y→i (`happyness`), silent-e drop (`makeing`) — plus affixes spelled
by sound (`jumpt` for `jumped`).

---

## 3. Error taxonomy and rationale

| Category | Signature | Why it is its own category |
|---|---|---|
| **Phonological** | Sounds are lost or changed | Points at grapheme-phoneme mapping — the sub-lexical route |
| **Orthographic** | Sounds right, letters wrong | Points at the stored word form — the lexical route |
| **Morphological** | Root right, affix wrong | Root orthography is intact; the weakness is a specific, teachable rule set |
| **Visual** | Mirror letters, adjacent swaps | Developmentally normal under ~7, so it must be separable and age-weighted |
| **Homophone** | Real word, right sound, wrong word | Invisible to spell-checkers; depends on stored forms, not sound |
| **Word boundary** | Words joined or split | Unstable sense of where words begin and end |
| **Grammatical** | Real-word substitution, different sound | Reported for completeness; deliberately excluded from the profile |

Subtypes carry the teaching detail (`cluster_reduction`, `vowel_omission`,
`silent_letter`, `junction_rule`, `phonetic_affix`, …). Full definitions in
`taxonomy.js`.

### Category → profile weights

```
phonological  → phonological 1.0
orthographic  → surface 1.0
homophone     → surface 0.85
morphological → morphological 1.0, phonological 0.15
visual        → visual 1.0, surface 0.35
segmentation  → phonological 0.45, surface 0.30
grammatical   → (excluded)
```

Each error contributes its weight scaled by its own confidence; secondary tags count at
one third. Scores are normalised to shares.

### Guards on the conclusion

- Fewer than **4** analysable errors → no profile is claimed at all.
- Top two profiles within **0.15** → reported as *mixed*, not forced into a winner.
- Profile confidence = `0.35 + 0.40 × volume + 0.25 × separation`.
- Caveats fire automatically for short samples, transcribed text, a missing neural
  layer, high visual share, and low-confidence target reconstruction.

---

## 4. Evaluation methodology

### Component level

Each layer is separable and measurable on its own:

- **Target reconstruction** — accuracy@1 against a list of (misspelling → intended)
  pairs. Current lexicon-only accuracy on the 20-item development list is 17/20; the
  three misses (`sret`, `becos`, `tabel`) are all cases where only sentence context
  disambiguates, which is what the neural layer supplies.
- **G2P** — phoneme accuracy against CMU on held-out real words, plus manual review on
  non-words.
- **Classification** — per-category precision/recall against hand-labelled pairs.

### System level

Fixed development samples, each engineered to have a known dominant pattern:

| Sample | Expected | Result |
|---|---|---|
| A — `nite, frend, enuf, bild, casel, verry, enyway, woz` | Surface / orthographic | ✅ surface, 0.96 share |
| B — `wnt, shp, wth, bght, rn, ws` (vowels dropped) | Phonological | ✅ phonological, 0.63 share |
| C — `runing, jumpt, happyness, makeing, hopeing, stoped` | Morphological | ✅ morphological, 0.87 share |
| D — clean text | No profile | ✅ "not enough errors" |
| E — `alot, to gether, icecream, abit` | Word boundary | ✅ 4/4 boundary errors |

### Known limitations

- **Reversal-heavy writing** (`dof` for `dog`, `dall` for `doll`) is only recoverable
  from context, and the GEC model is inconsistent on it. Sample F resolves 1/9. This is
  the weakest area and is stated in the report caveats.
- **Non-rhotic and dialect spellings** (`pak` for `park`, `bruv` for `brother`) are read
  literally: `pak` is a phonetically correct spelling of `pack`.
- **No writer-frequency model.** Ranking uses a small fixed high-frequency list, not
  corpus statistics.
- **Single-sample scope.** A profile describes one sample. Several samples are needed
  before a pattern is real, which is why `MIN_ERRORS_FOR_PROFILE` exists and why the
  caveat about sample size always fires under 40 words.

---

## 5. Running it

```bash
npm install
npm run warm:nlp     # one-time: caches model weights, then smoke-tests the pipeline
npm run dev
```

Apply `supabase/error_analyses.sql` in the Supabase SQL editor to create the storage
table.

| Variable | Default | Purpose |
|---|---|---|
| `NLP_GEC` | on | `off` disables the neural layer |
| `NLP_GEC_MODEL` | `Xenova/t5-base-grammar-correction` | Checkpoint to load |
| `NLP_GEC_PREFIX` | `grammar: ` | Task prefix; set empty for grammar-synthesis |
| `NLP_GEC_DTYPE` | `q8` | ONNX quantisation |

`onnxruntime-node`, `dictionary-en`, `nspell` and `cmu-pronouncing-dictionary` are
declared in `serverComponentsExternalPackages` — the first loads a native binary, and
the rest read data files relative to their own package directory, both of which webpack
bundling breaks.

### Model cache and deployment

Transformers.js caches weights in `node_modules/@huggingface/transformers/.cache`
(~335 MB after warming). Two consequences:

- A fresh `npm ci` wipes the cache, so `npm run warm:nlp` has to be re-run.
- On a platform that rebuilds `node_modules` per deploy, the first request after a
  deploy pays for the download inside its own timeout. For the demo, warm the cache
  locally and run the app locally. For a hosted deployment, either bake the weights into
  the image at build time or set `NLP_GEC=off` and accept the lexicon-only pipeline.

`correctSentences` has a load timeout (120 s default) so a cold model degrades to the
lexicon layers rather than hanging the request.
