import { toHiragana, toKatakana } from "wanakana";

/** 히라가나 / 카타카나 / 장음부호만 */
const KANA_ONLY_RE = /^[ぁ-ゖ゙-゜ゝ-ゟァ-ヺ・-ヾ]+$/;

export function isAllKana(text: string): boolean {
  return text.length > 0 && KANA_ONLY_RE.test(text);
}

/** 읽기 칸에 가나가 아닌 문자가 섞였는가(저장 차단 판정에 쓴다). */
export function hasNonKana(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && !KANA_ONLY_RE.test(t);
}

/**
 * 읽기 칸 입력을 가나로 확정한다.
 *
 * - 이미 전부 가나면 그대로 둔다. 카타카나 단어(バランス)를 히라가나로 뭉개지 않기 위해서다.
 * - 로마자가 섞여 있으면 소문자로 낮춘 뒤 통째로 변환한다.
 *   소문자로 낮추는 이유: wanakana 는 대문자 로마자를 가타카나로 바꾼다(KYOU -> キョウ).
 *   Shift 가 한 글자만 섞여도 의도치 않은 가타카나가 나온다.
 * - 부분 변환(IMEMode)을 쓰지 않는다. 타이핑 도중 상태가 그대로 저장되면
 *   ふきゅう 가 ふきゅ 로 잘려 들어가기 때문이다.
 */
export function normalizeReading(input: string): string {
  const t = input.trim().replace(/\s+/g, "");
  if (t.length === 0) return "";
  if (isAllKana(t)) return t;
  return toHiragana(t.toLowerCase(), { passRomaji: false });
}

/** 로마자로 친 읽기를 가타카나로 바꾼다(외래어 표기용 버튼). */
export function toKatakanaReading(input: string): string {
  const t = normalizeReading(input);
  return t.length > 0 ? toKatakana(t) : t;
}
