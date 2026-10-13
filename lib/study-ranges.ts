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
