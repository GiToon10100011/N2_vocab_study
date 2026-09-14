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



/**
 * IME 조합 중 눌린 물리 키를 로마자 문자열로 모은다.
 *
 * KeyboardEvent.code 는 IME 가 키를 가로채는 중에도 물리 키를 그대로 알려준다
 * (key 는 "Process" 가 되지만 code 는 "KeyF" 로 남는다).
 * 라이브 변환이 망가뜨리는 것은 IME 의 "표시"이지 사용자가 누른 키가 아니므로,
 * 키를 직접 모으면 완전한 로마자를 얻을 수 있다.
 *
 * 변환/이동 키(Space, Enter, 화살표 등)는 읽기의 일부가 아니므로 버린다.
 * @returns 갱신된 버퍼
 */
export function pushRomajiKey(buffer: string, code: string): string {
  if (code === "Backspace") return buffer.slice(0, -1);
  if (/^Key[A-Z]$/.test(code)) return buffer + code.slice(3).toLowerCase();
  if (code === "Minus") return buffer + "-";
  return buffer;
}

/** 한자(CJK 한자 · 々 · 〆)가 하나라도 들어 있는가. */
const HAS_KANJI = /[\u3400-\u4dbf\u4e00-\u9fff々〆]/;

/**
 * IME 로마자 관례를 표준 로마자로 맞춘다.
 *
 * IME 에서 단독 ん 을 넣으려면 n 을 두 번 쳐야 한다(しんぶん = shinbunn).
 * wanakana 는 nn 을 곧이곧대로 んん 으로 바꾸므로 한 번 줄여야 한다.
 * 단 nn 뒤에 모음이나 y 가 오면 ん + な행/や행 이라 그대로 두어야 한다
 * (annai -> あんない, mannaka -> まんなか).
 */
function fromImeRomaji(romaji: string): string {
  return romaji.replace(/nn(?![aiueoy])/g, "n");
}

/**
 * 조합이 끝났을 때 모아둔 로마자로 읽기 제안을 만든다.
 *
 * 표기에 한자가 없으면 제안하지 않는다. 두 가지를 한꺼번에 걸러낸다.
 *   - 가나뿐인 단어(きっかけ, バランス)는 표기 == 읽기라 제안이 불필요하다.
 *   - 한국어 IME 는 음절마다 compositionend 가 자동으로 발생한다. 한자가 없으므로 여기서 걸린다.
 *
 * 변환 결과에 로마자가 남으면(키를 놓쳐 자음으로 끝난 경우) 제안하지 않는다.
 * 어설픈 추정을 내놓느니 비워두는 편이 낫다.
 */
export function readingFromRomaji(romaji: string, confirmedSurface: string): string | null {
  if (!romaji) return null;
  if (!HAS_KANJI.test(confirmedSurface)) return null;
  const kana = normalizeReading(fromImeRomaji(romaji));
  return kana && isAllKana(kana) ? kana : null;
}
