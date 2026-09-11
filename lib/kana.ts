/** 히라가나 / 카타카나 / 장음부호만 */
const KANA_ONLY_RE = /^[ぁ-ゖ゙-゜ゝ-ゟァ-ヺ・-ヾ]+$/;

export function isAllKana(text: string): boolean {
  return text.length > 0 && KANA_ONLY_RE.test(text);
}

/** 읽기 칸에 가나가 아닌 문자가 섞였는가(경고용, 저장은 막지 않는다). */
export function hasNonKana(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && !KANA_ONLY_RE.test(t);
}
