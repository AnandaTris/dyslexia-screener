// Tokenisation strategy.
//
// Two levels, because the two analysis layers need different things:
//   - Sentences, so the neural corrector sees a whole clause of context
//     (a homophone error like "their/there" is only visible in context).
//   - Word tokens with character offsets into the original text, so every
//     finding we report can be pointed back at the exact place a teacher
//     would look at on the page.
//
// Word tokens keep internal apostrophes ("don't", "we're") but drop
// surrounding punctuation, which is analysed separately.

const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

/**
 * @typedef {{ text: string, normalised: string, start: number, end: number,
 *             index: number, sentence: number }} WordToken
 */

/** Splits text into sentences with offsets, tolerating missing end punctuation. */
export function splitSentences(text) {
  const source = String(text ?? "");
  const out = [];
  const re = /[^.!?\n]+[.!?]*[\s]*/g;
  let match;

  while ((match = re.exec(source)) !== null) {
    const raw = match[0];
    if (!raw.trim()) continue;
    const leading = raw.length - raw.trimStart().length;
    const start = match.index + leading;
    const body = raw.trim();
    out.push({ text: body, start, end: start + body.length, index: out.length });
  }

  return out;
}

/**
 * Splits text into word tokens with offsets and sentence membership.
 * @returns {WordToken[]}
 */
export function tokenizeWords(text) {
  const source = String(text ?? "");
  const sentences = splitSentences(source);
  const tokens = [];
  let match;

  WORD_RE.lastIndex = 0;
  while ((match = WORD_RE.exec(source)) !== null) {
    const start = match.index;
    const sentence = sentences.findIndex((s) => start >= s.start && start < s.end);
    tokens.push({
      text: match[0],
      normalised: match[0].toLowerCase().replace(/[’]/g, "'"),
      start,
      end: start + match[0].length,
      index: tokens.length,
      sentence: sentence === -1 ? 0 : sentence,
    });
  }

  return tokens;
}

/** Lightweight surface statistics used for reporting and for confidence gating. */
export function textStatistics(text) {
  const source = String(text ?? "");
  const words = tokenizeWords(source);
  const sentences = splitSentences(source);

  return {
    characters: source.length,
    words: words.length,
    sentences: sentences.length,
    uniqueWords: new Set(words.map((w) => w.normalised)).size,
    averageWordLength: words.length
      ? words.reduce((sum, w) => sum + w.text.length, 0) / words.length
      : 0,
  };
}
