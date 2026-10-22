/**
 * 실전 테스트의 답 판정. 화면의 즉시 판정과 서버의 재채점이 이 파일 하나를 쓴다.
 *
 * - 입력칸은 친 그대로 두고, 여기서 문자열 전체를 한 번에 가나로 확정한다(부분 변환 금지, 규칙 6).
 * - 가타카나는 히라가나로 바꿔 비교하지만 ー 는 그대로 둔다. wanakana.toHiragana 는 ー 를 앞 모음으로
 *   바꿔서 チューショーテキ 를 ちゅうしょうてき 로 만든다 — 장음 오류가 정답이 된다. 그래서 쓰지 않는다.
 */
import { toKana } from "wanakana";
import { fromImeRomaji } from "./kana";

/** 채점할 수 있는 확정 가나: 히라가나와 장음 부호만 */
const ANSWER_RE = /^[ぁ-ゖー]+$/;

/** ァ-ヶ 를 같은 자리의 ぁ-ゖ 로 옮긴다. ー(U+30FC)는 범위 밖이라 남는다. */
function katakanaToHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * 입력 전체를 가나로 확정한다. 미리보기 줄에 그대로 보여 준다.
 * 가나가 아닌 것이 남아도 그대로 돌려준다(입력 도중의 chuus 같은 상태도 보여야 한다).
 */
export function convertAnswer(input: string): string {
  const t = input.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  return katakanaToHiragana(toKana(fromImeRomaji(t)));
}

export type AnswerCheck = { ok: true; kana: string } | { ok: false; reason: "empty" | "not-kana" };

/** 채점할 수 있는 입력인가. 한자가 섞이거나 로마자 · 기호가 남으면 채점하지 않는다. */
export function checkAnswer(input: string): AnswerCheck {
  const kana = convertAnswer(input);
  if (kana.length === 0) return { ok: false, reason: "empty" };
  if (!ANSWER_RE.test(kana)) return { ok: false, reason: "not-kana" };
  return { ok: true, kana };
}

export type Judgement =
  | { result: "invalid"; reason: "empty" | "not-kana" }
  | { result: "correct" | "wrong"; kana: string; compare: { typed: string; expected: string } };

/** 끝의 だ 하나를 뗀다. 떼고 남는 것이 없으면 떼지 않는다. */
function dropDa(s: string): string {
  return s.length > 1 && s.endsWith("だ") ? s.slice(0, -1) : s;
}

/**
 * 한 글자라도 다르면 오답이다(장음 · 요음 · 촉음 포함).
 *
 * 예외 하나: 표기와 읽기가 둘 다 だ 로 끝나는 な형용사(哀れだ)는 입력의 だ 가 있든 없든 정답이다.
 * 단어장 표기 관례일 뿐 읽기 지식이 아니기 때문이다.
 *
 * kana 는 저장할 확정 가나, compare 는 이 규칙을 적용한 뒤 실제로 비교한 두 문자열이다.
 */
export function judgeReading(
  input: string,
  word: { surface: string; reading: string },
): Judgement {
  const checked = checkAnswer(input);
  if (!checked.ok) return { result: "invalid", reason: checked.reason };

  const kana = checked.kana;
  const reading = convertAnswer(word.reading);
  const daRule = word.surface.endsWith("だ") && reading.endsWith("だ");
  const typed = daRule ? dropDa(kana) : kana;
  const expected = daRule ? dropDa(reading) : reading;
  return { result: typed === expected ? "correct" : "wrong", kana, compare: { typed, expected } };
}
