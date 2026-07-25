// Alignment utilities.
//
// Character alignment uses Damerau-Levenshtein rather than plain Levenshtein
// because adjacent transposition has to be a *single* operation. "gril" for
// "girl" is one swap, and swaps are diagnostically distinct from the two
// separate substitutions plain Levenshtein would report.
//
// Token alignment does the same job one level up: it lines the writer's tokens
// against the corrected tokens so we can read off which word was replaced by
// which, including insertions and deletions.

/**
 * Character-level edit script from `source` to `target`.
 * @returns {{ distance: number, ops: {op: string, from?: string, to?: string, at: number}[] }}
 */
export function characterAlignment(source, target) {
  const a = String(source);
  const b = String(target);
  const rows = a.length + 1;
  const cols = b.length + 1;

  const cost = Array.from({ length: rows }, () => new Int32Array(cols));
  const back = Array.from({ length: rows }, () => new Array(cols).fill(null));

  for (let i = 1; i < rows; i++) {
    cost[i][0] = i;
    back[i][0] = "delete";
  }
  for (let j = 1; j < cols; j++) {
    cost[0][j] = j;
    back[0][j] = "insert";
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const same = a[i - 1] === b[j - 1];
      let best = cost[i - 1][j - 1] + (same ? 0 : 1);
      let move = same ? "match" : "substitute";

      if (cost[i - 1][j] + 1 < best) {
        best = cost[i - 1][j] + 1;
        move = "delete";
      }
      if (cost[i][j - 1] + 1 < best) {
        best = cost[i][j - 1] + 1;
        move = "insert";
      }
      // Damerau: one swap of adjacent characters costs 1, not 2.
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1] &&
        cost[i - 2][j - 2] + 1 < best
      ) {
        best = cost[i - 2][j - 2] + 1;
        move = "transpose";
      }

      cost[i][j] = best;
      back[i][j] = move;
    }
  }

  const ops = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    const move = back[i][j];
    if (move === "match") {
      i--;
      j--;
    } else if (move === "substitute") {
      ops.push({ op: "substitute", from: a[i - 1], to: b[j - 1], at: i - 1 });
      i--;
      j--;
    } else if (move === "transpose") {
      ops.push({ op: "transpose", from: a.slice(i - 2, i), to: b.slice(j - 2, j), at: i - 2 });
      i -= 2;
      j -= 2;
    } else if (move === "delete") {
      ops.push({ op: "delete", from: a[i - 1], at: i - 1 });
      i--;
    } else {
      ops.push({ op: "insert", to: b[j - 1], at: i });
      j--;
    }
  }

  ops.reverse();
  return { distance: cost[a.length][b.length], ops };
}

/**
 * Token-level alignment between the writer's tokens and a corrected version.
 * @param {string[]} source
 * @param {string[]} target
 * @returns {{op: "equal"|"replace"|"delete"|"insert", sourceIndex: number|null,
 *            targetIndex: number|null, from?: string, to?: string}[]}
 */
export function tokenAlignment(source, target) {
  const rows = source.length + 1;
  const cols = target.length + 1;
  const cost = Array.from({ length: rows }, () => new Int32Array(cols));
  const back = Array.from({ length: rows }, () => new Array(cols).fill(null));

  for (let i = 1; i < rows; i++) {
    cost[i][0] = i;
    back[i][0] = "delete";
  }
  for (let j = 1; j < cols; j++) {
    cost[0][j] = j;
    back[0][j] = "insert";
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const same = source[i - 1] === target[j - 1];
      let best = cost[i - 1][j - 1] + (same ? 0 : 1);
      let move = same ? "equal" : "replace";

      if (cost[i - 1][j] + 1 < best) {
        best = cost[i - 1][j] + 1;
        move = "delete";
      }
      if (cost[i][j - 1] + 1 < best) {
        best = cost[i][j - 1] + 1;
        move = "insert";
      }

      cost[i][j] = best;
      back[i][j] = move;
    }
  }

  const ops = [];
  let i = source.length;
  let j = target.length;
  while (i > 0 || j > 0) {
    const move = back[i][j];
    if (move === "equal" || move === "replace") {
      ops.push({
        op: move,
        sourceIndex: i - 1,
        targetIndex: j - 1,
        from: source[i - 1],
        to: target[j - 1],
      });
      i--;
      j--;
    } else if (move === "delete") {
      ops.push({ op: "delete", sourceIndex: i - 1, targetIndex: null, from: source[i - 1] });
      i--;
    } else {
      ops.push({ op: "insert", sourceIndex: null, targetIndex: j - 1, to: target[j - 1] });
      j--;
    }
  }

  ops.reverse();
  return ops;
}
