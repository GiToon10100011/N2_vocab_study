/**
 * 오답노트(문법·교재 오답)의 고정 값과 입력 검증.
 * 폼(클라이언트)과 서버 액션이 같은 규칙을 쓰도록 순수 함수로만 둔다.
 */

/** 출처 3종. db/schema.sql 의 mistakes_source_valid 와 같아야 한다. */
export const MISTAKE_SOURCES = ["master1500", "grammar", "reading"] as const;
export type MistakeSource = (typeof MISTAKE_SOURCES)[number];

export const MISTAKE_SOURCE_LABEL: Record<MistakeSource, string> = {
  master1500: "마스터1500",
  grammar: "문법",
  reading: "독해",
};

/**
 * 분류 7종. 사용자가 늘리는 태그가 아니라 고정 값이고, db/schema.sql 의
 * mistakes_category_valid 와 같아야 한다(lib/mistakes.test.ts 가 대조한다).
 *
 * when 은 Obsidian 「오답 분류 기준」 표의 「언제 쓰는가」 칸을 그대로 옮긴 것이다.
 * 기준을 바꾸려면 그 문서를 먼저 고치고 여기를 맞춘다. 여기서 문구를 지어내지 않는다.
 */
export const MISTAKE_CATEGORIES = [
  { name: "개념 부족", when: "규칙 자체를 모르거나 반대로 알고 있었다" },
  { name: "접속 실수", when: "앞에 오는 형태를 틀렸다 (사전형/ます형/ない형…)" },
  { name: "활용 실수", when: "활용형을 잘못 만들었다" },
  { name: "문법 구별 실패", when: "비슷한 두 문법을 헷갈렸다" },
  { name: "해석 실패", when: "문장 뜻을 잘못 읽었다" },
  { name: "회상 실패", when: "알고 있었는데 그 순간 안 떠올랐다" },
  { name: "단순 실수", when: "알았는데 다른 이유로 틀렸다" },
] as const;
export type MistakeCategory = (typeof MISTAKE_CATEGORIES)[number]["name"];

/** 폼과 서버 액션이 받는 원시 입력. 전부 사용자가 친 그대로다. */
export interface MistakeInput {
  source: string;
  category: string;
  ref?: string;
  question?: string;
  chosen?: string;
  answer?: string;
  why?: string;
}

/** 검증을 통과한 저장 직전 형태. 빈 칸은 null 이다. */
export interface MistakeDraft {
  source: MistakeSource;
  category: MistakeCategory;
  ref: string | null;
  question: string | null;
  chosen: string | null;
  answer: string | null;
  why: string | null;
}

export interface Mistake extends MistakeDraft {
  id: string;
  created_at: string;
  /** 문제를 푼 날 'YYYY-MM-DD'. 입력한 날과 다를 수 있다. */
  study_day: string;
  /** 재확인에서 맞힌 시각. null 이면 미해결. */
  resolved_at: string | null;
}

export type MistakeInvalid = "source" | "category" | "empty" | "too_long";

export type MistakeValidation =
  | { ok: true; value: MistakeDraft }
  | { ok: false; reason: MistakeInvalid };

export const MISTAKE_REF_MAX = 100;
export const MISTAKE_TEXT_MAX = 2000;

function isSource(v: unknown): v is MistakeSource {
  return (MISTAKE_SOURCES as readonly unknown[]).includes(v);
}

function isCategory(v: unknown): v is MistakeCategory {
  return MISTAKE_CATEGORIES.some((c) => c.name === v);
}

function text(v: unknown): string | null {
  return typeof v === "string" ? v.trim() || null : null;
}

export function validateMistake(input: MistakeInput): MistakeValidation {
  if (!isSource(input?.source)) return { ok: false, reason: "source" };
  if (!isCategory(input.category)) return { ok: false, reason: "category" };

  const value: MistakeDraft = {
    source: input.source,
    category: input.category,
    ref: text(input.ref),
    question: text(input.question),
    chosen: text(input.chosen),
    answer: text(input.answer),
    why: text(input.why),
  };

  const texts = [value.question, value.chosen, value.answer, value.why];
  // 출처와 분류만 있는 행은 나중에 무엇을 틀렸는지 알 수 없다.
  if (value.ref === null && texts.every((t) => t === null)) return { ok: false, reason: "empty" };
  if (
    (value.ref?.length ?? 0) > MISTAKE_REF_MAX ||
    texts.some((t) => (t?.length ?? 0) > MISTAKE_TEXT_MAX)
  ) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, value };
}
