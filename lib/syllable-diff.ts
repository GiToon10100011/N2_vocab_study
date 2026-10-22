/**
 * 틀린 읽기를 음절 단위로 정답과 나란히 보여 주기 위한 대조.
 *
 * 헷갈리는 것은 しょう / そう 같은 요음과 장음 · 촉음이 붙는지 여부다. 그래서 요음은 한 음절로 묶고
 * (ちゅ, しょ), っ · ー · ん 은 따로 세어 「빠졌다」를 그 글자 하나로 짚는다(どぶつ ↔ ど[う]ぶつ).
 */

/** 앞 글자에 붙어 한 음절이 되는 작은 가나 */
const SMALL = new Set("ゃゅょぁぃぅぇぉゎゕゖ");

export function toSyllables(kana: string): string[] {
  const out: string[] = [];
  for (const ch of kana) {
    if (SMALL.has(ch) && out.length > 0) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/** diff 블록의 한쪽이 "" 이면 그쪽에 그 음절이 없다(누락). */
export type DiffBlock =
  | { kind: "same"; text: string }
  | { kind: "diff"; typed: string; expected: string };

/** 두 음절 배열의 최장 공통 부분열로 맞춰 세우고, 어긋난 구간을 한 블록으로 묶는다. */
export function diffSyllables(typed: string, expected: string): DiffBlock[] {
  const a = toSyllables(typed);
  const b = toSyllables(expected);

  // lcs[i][j] = a[i..] 와 b[j..] 의 최장 공통 부분열 길이
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const blocks: DiffBlock[] = [];
  const same = (text: string) => {
    const last = blocks[blocks.length - 1];
    if (last?.kind === "same") last.text += text;
    else blocks.push({ kind: "same", text });
  };
  const diff = (t: string, e: string) => {
    const last = blocks[blocks.length - 1];
    if (last?.kind === "diff") {
      last.typed += t;
      last.expected += e;
    } else blocks.push({ kind: "diff", typed: t, expected: e });
  };

  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      same(a[i]);
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1])) {
      diff(a[i], "");
      i++;
    } else {
      diff("", b[j]);
      j++;
    }
  }
  return blocks;
}
