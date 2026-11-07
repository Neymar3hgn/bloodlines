export type Piece = { op: "same" | "add" | "del"; text: string };

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean);

/** A word diff from the longest common subsequence. Strategies are short, so the plain table is fine. */
export function wordDiff(before: string, after: string): Piece[] {
  const a = words(before);
  const b = words(after);
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const out: Piece[] = [];
  const push = (op: Piece["op"], word: string) => {
    const last = out[out.length - 1];
    if (last?.op === op) last.text += ` ${word}`;
    else out.push({ op, text: word });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push("same", a[i]);
      i += 1;
      j += 1;
    } else if (i < a.length && (j >= b.length || table[i + 1][j] >= table[i][j + 1])) {
      push("del", a[i]);
      i += 1;
    } else {
      push("add", b[j]);
      j += 1;
    }
  }
  return out;
}
