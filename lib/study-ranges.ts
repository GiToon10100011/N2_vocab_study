/**
 * 풀이 범위. 그날 그 교재를 몇 번부터 몇 번까지 풀었는지 적는다.
 * 오답이 하나도 없는 날에는 오답 기록에 아무것도 남지 않아서, 어디까지 풀었는지를 따로 둔다.
 * 폼(클라이언트)과 서버 액션이 같은 규칙을 쓰도록 순수 함수로만 둔다.
 */
import { MISTAKE_SOURCES, type MistakeSource } from "./mistakes";

/** 교재·학습일마다 한 줄이다. 같은 날 다시 적으면 덮어쓴다. */
export interface StudyRange {
  source: MistakeSource;
  /** 문제를 푼 날 'YYYY-MM-DD'. 입력한 날과 다를 수 있다. */
  study_day: string;
  from_no: number;
  to_no: number;
}

/** 폼과 서버 액션이 받는 원시 입력. 번호는 사용자가 친 그대로다. */
export interface StudyRangeInput {
  source: string;
  from: string | number;
  to: string | number;
}

/** 번호의 상한. db/schema.sql 의 study_ranges_numbers 와 같아야 한다. */
export const STUDY_RANGE_MAX = 9999;

export type StudyRangeInvalid = "source" | "number" | "order";

export type StudyRangeValidation =
  | { ok: true; value: Pick<StudyRange, "source" | "from_no" | "to_no"> }
  | { ok: false; reason: StudyRangeInvalid };

/** 번호 칸의 글자를 정수로 읽는다. 전각 숫자(１２)도 받는다. 번호가 아니면 null. */
function parseNumber(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).normalize("NFKC").trim();
  if (!/^[0-9]{1,4}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= STUDY_RANGE_MAX ? n : null;
}

export function validateStudyRange(input: StudyRangeInput): StudyRangeValidation {
  const source = input?.source as MistakeSource;
  if (!MISTAKE_SOURCES.includes(source)) return { ok: false, reason: "source" };

  const from_no = parseNumber(input.from);
  const to_no = parseNumber(input.to);
  if (from_no === null || to_no === null) return { ok: false, reason: "number" };
  if (to_no < from_no) return { ok: false, reason: "order" };
  return { ok: true, value: { source, from_no, to_no } };
}

/** 오답은 저장하는데 범위는 저장하지 않았을 때 그 이유. 막지 않고 알리기만 한다. */
export type RangeSkipped = "no-start" | "no-end";

export const RANGE_SKIPPED_TEXT: Record<RangeSkipped, string> = {
  "no-start": "범위는 저장하지 않았습니다 (시작 번호 없음)",
  "no-end": "범위는 저장하지 않았습니다 (끝 번호 없음)",
};

export interface FormSavePlan {
  /**
   * 오답 저장을 한다. 오답 칸이 비고 범위만 있을 때만 false 다. 오답도 범위도 비었을 때도 true 다 —
   * 저장하겠다는 뜻이 아니라, 예전 오답 저장이 하던 대로 검증해서 빈 칸 안내를 띄우라는 뜻이다(아무것도 보내지 않는다).
   */
  mistake: boolean;
  /** 범위 저장을 한다. 번호가 덜 찼거나 틀렸으면 범위 검증이 그 이유를 알린다. */
  range: boolean;
  /** 오답은 저장하지만 범위는 저장하지 않은 이유. 없으면 null. */
  rangeSkipped: RangeSkipped | null;
}

/**
 * 저장 버튼 하나가 무엇을 저장할지 정한다. 예전에는 「저장」과 「범위 저장」이 따로여서, 범위가 한 번도
 * 저장되지 않은 채 오답만 쌓였다. 오답이 없는 날의 범위 저장은 오답 칸을 비워 두고 누르면 지켜진다.
 *
 *   오답 채워짐 + 범위 둘 다  → 오답과 범위 모두
 *   오답 채워짐 + 끝이 빔     → 오답만. 이유를 알리되 막지 않는다 — 풀면서 하나씩 적을 때
 *                              모르는 끝 번호로 범위를 덮어쓰지 않으려는 것이다
 *   오답 빔 + 범위 둘 다      → 범위만 (오답이 없는 날)
 *   오답 빔 + 범위 빔         → 아무것도 저장하지 않는다
 */
export function planFormSave(input: {
  mistakeBlank: boolean;
  from: string;
  to: string;
}): FormSavePlan {
  const hasFrom = input.from.trim() !== "";
  const hasTo = input.to.trim() !== "";

  if (input.mistakeBlank) {
    // 범위 칸에 무언가 적었다면 범위를 저장하려는 것이다. 한쪽만 찼으면 범위 검증이 안내한다.
    return hasFrom || hasTo
      ? { mistake: false, range: true, rangeSkipped: null }
      : { mistake: true, range: false, rangeSkipped: null };
  }
  if (hasFrom && hasTo) return { mistake: true, range: true, rangeSkipped: null };
  if (hasFrom) return { mistake: true, range: false, rangeSkipped: "no-end" };
  if (hasTo) return { mistake: true, range: false, rangeSkipped: "no-start" };
  return { mistake: true, range: false, rangeSkipped: null };
}

/**
 * 범위 칸에 먼저 채워 둘 값. 그날 그 교재로 저장한 것이 있으면 그것을 넣고(고쳐 쓰기),
 * 없으면 그 교재에서 직전에 푼 범위의 다음 번호를 시작 번호로 둔다.
 */
export function draftStudyRange(
  ranges: readonly StudyRange[],
  source: string,
  studyDay: string,
): { from: string; to: string } {
  const mine = ranges.filter((r) => r.source === source);
  const saved = mine.find((r) => r.study_day === studyDay);
  if (saved) return { from: String(saved.from_no), to: String(saved.to_no) };

  const before = mine
    .filter((r) => r.study_day < studyDay)
    .sort((a, b) => (a.study_day < b.study_day ? 1 : -1))[0];
  const next = before ? before.to_no + 1 : null;
  return { from: next !== null && next <= STUDY_RANGE_MAX ? String(next) : "", to: "" };
}
