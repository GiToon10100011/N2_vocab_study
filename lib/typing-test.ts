/**
 * 실전 테스트(한자 → 읽기 타이핑)의 규칙. 전부 순수 함수다. DB 조회는 lib/typing-test-load.ts 가 한다.
 *
 * - 이틀에 한 번, 마지막으로 「끝낸」 테스트의 학습일 기준으로 뜬다. 며칠을 건너뛰어도 뜨는 것은 1회분이다.
 * - N 자리를 재시험 → 처음 보는 단어(위험도 가중 무작위) → 통과한 단어(오래된 순) 로 채우고 섞는다.
 *   위험한 것부터 줄 세우지 않는다. 그러면 첫 테스트가 가장 어려운 단어로만 채워져 오답이 몰린다.
 */
import { checkAnswer } from "./reading-answer";
import {
  APP_TIMEZONE,
  DAY_START_HOUR,
  addDays,
  diffDays,
  isKanaOnly,
  shuffle,
  studyDate,
} from "./srs";

export const TEST_SIZE_DEFAULT = 40;
export const TEST_SIZE_MIN = 10;
export const TEST_SIZE_MAX = 100;
/** 끝낸 테스트의 학습일로부터 이만큼 지나야 다음 테스트가 뜬다. 설정으로 두지 않는다. */
export const TEST_INTERVAL_DAYS = 2;
/** 틀린 단어는 테스트에서 이만큼 연속으로 맞혀야 「읽기 주의」가 풀린다. */
export const PASS_STREAK = 2;

/** 숫자가 아닌 값은 기본값으로 둔다. */
export function normalizeTestSize(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return TEST_SIZE_DEFAULT;
  return Math.max(TEST_SIZE_MIN, Math.min(TEST_SIZE_MAX, Math.round(v)));
}

/* ------------------------------------------------------------------ *
 * 단어별 테스트 이력
 * ------------------------------------------------------------------ */

export type TestStatus = "untested" | "retest" | "passed";

/** history = 테스트 답의 정오, 오래된 것부터. */
export function testStatus(history: boolean[]): TestStatus {
  if (history.length === 0) return "untested";
  const lastWrong = history.lastIndexOf(false);
  if (lastWrong < 0) return "passed";
  return history.length - 1 - lastWrong >= PASS_STREAK ? "passed" : "retest";
}

/* ------------------------------------------------------------------ *
 * 출제 선택
 * ------------------------------------------------------------------ */

export interface TestCandidate {
  id: string;
  surface: string;
  reading: string;
  study_day: string;
  stage: number;
  suspended: boolean;
  /** 첫 리뷰 로그(learn 포함)의 학습일. 로그가 없으면 null */
  firstReviewDay: string | null;
  /** 플래시카드 s2r 오답 (재시도 · 연습 · 테스트 행 제외) */
  s2rWrong: number;
  /** 테스트 답의 정오, 오래된 것부터 */
  history: boolean[];
  /** 마지막 테스트 답 시각(ISO) */
  lastAnsweredAt: string | null;
}

/** 헷갈리는 소리: 요음 · 촉음, おう · えい 류 장음 */
export const CONFUSABLE = /[ゃゅょっ]|[おこそとのほもよろをごぞどぼぽ]う|[えけせてねへめれげぜでべぺ]い/;

/**
 * 한자가 있고, 보류되지 않았고, 이미 학습한 단어. 그날 처음 배운 단어는 뺀다.
 * 읽기가 가나로 판정되지 않는 단어는 채점할 수 없으므로 뺀다.
 */
export function isTestEligible(c: TestCandidate, today: string): boolean {
  return (
    !c.suspended &&
    c.stage > 0 &&
    !isKanaOnly(c) &&
    c.firstReviewDay !== today &&
    checkAnswer(c.reading).ok
  );
}

/** 플래시카드 s2r 오답 · 헷갈리는 소리 · 오래된 정도를 곱한다. 최소 1, 최대 72. */
export function testWeight(c: TestCandidate, today: string): number {
  const wrong = 1 + Math.min(c.s2rWrong, 3);
  const trap = CONFUSABLE.test(c.reading) ? 2 : 1;
  const age = 1 + Math.min(Math.max(diffDays(today, c.study_day), 0), 56) / 7;
  return wrong * trap * age;
}

/**
 * 가중 무작위 순서(Efraimidis–Spirakis). 무거울수록 앞에 올 확률이 높지만 항상 앞은 아니다.
 * rand 를 입력 순서대로 항목마다 한 번씩 부른다. 같은 key 는 입력 순서를 지킨다.
 */
export function weightedOrder<T>(
  items: T[],
  weight: (t: T) => number,
  rand: () => number = Math.random,
): T[] {
  return items
    .map((item, i) => ({ item, i, key: Math.log(1 - rand()) / weight(item) }))
    .sort((a, b) => b.key - a.key || a.i - b.i)
    .map((x) => x.item);
}

/** 마지막 답이 오래된 것부터. 답이 없으면 가장 오래된 것으로 친다. */
function byLastAnswered(a: TestCandidate, b: TestCandidate): number {
  const x = a.lastAnsweredAt ?? "";
  const y = b.lastAnsweredAt ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}

/** 이번 테스트에 낼 단어 id. 순서는 섞여 있다. */
export function pickTestWords(
  cands: TestCandidate[],
  today: string,
  size: number,
  rand: () => number = Math.random,
): string[] {
  const eligible = cands.filter((c) => isTestEligible(c, today));
  const retest = eligible.filter((c) => testStatus(c.history) === "retest").sort(byLastAnswered);
  const fresh = weightedOrder(
    eligible.filter((c) => testStatus(c.history) === "untested"),
    (c) => testWeight(c, today),
    rand,
  );
  const passed = eligible.filter((c) => testStatus(c.history) === "passed").sort(byLastAnswered);
  const picked = [...retest, ...fresh, ...passed].slice(0, size);
  return shuffle(picked, rand).map((c) => c.id);
}

/* ------------------------------------------------------------------ *
 * 출현 판정
 * ------------------------------------------------------------------ */

export interface LatestTest {
  testDay: string;
  total: number;
  /** 아직 안 푼 문항 중 낼 수 있는 것(단어가 보류되지 않았고 한자가 있다) */
  remaining: number;
  lastAnsweredAt: string | null;
}

export type TestPhase =
  | { phase: "active"; testDay: string; remaining: number; total: number }
  | { phase: "wait"; nextDay: string }
  | { phase: "ready" };

/** 테스트를 끝낸 학습일 = 마지막 답의 학습일. 답이 하나도 없이 끝났으면 시작한 날. */
export function finishedStudyDay(
  latest: Pick<LatestTest, "testDay" | "lastAnsweredAt">,
  dayStartHour: number = DAY_START_HOUR,
): string {
  if (!latest.lastAnsweredAt) return latest.testDay;
  return studyDate(new Date(latest.lastAnsweredAt), APP_TIMEZONE, dayStartHour);
}

/**
 * 진행 중이면 이어서 본다(날이 바뀌어도). 다 풀었으면 끝낸 학습일로부터 이틀이 지나야 새로 뜬다.
 * 새로 낼 단어가 있는지는 여기서 보지 않는다 — 조회가 필요해서 로더가 따로 센다.
 */
export function testPhase(
  latest: LatestTest | null,
  today: string,
  dayStartHour: number = DAY_START_HOUR,
): TestPhase {
  if (!latest) return { phase: "ready" };
  if (latest.remaining > 0) {
    return { phase: "active", testDay: latest.testDay, remaining: latest.remaining, total: latest.total };
  }
  const finished = finishedStudyDay(latest, dayStartHour);
  if (diffDays(today, finished) >= TEST_INTERVAL_DAYS) return { phase: "ready" };
  return { phase: "wait", nextDay: addDays(finished, TEST_INTERVAL_DAYS) };
}

/* ------------------------------------------------------------------ *
 * 답 요청
 * ------------------------------------------------------------------ */

const MAX_ANSWERS = 200;
const MAX_TYPED = 64;

/** /api/test-answers 의 answers. 모양이 맞는 것만, 같은 단어는 첫 답만 받는다. */
export function parseTestAnswers(raw: unknown): { wordId: string; typed: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { wordId: string; typed: string }[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_ANSWERS) break;
    if (typeof item !== "object" || item === null) continue;
    const { wordId, typed } = item as Record<string, unknown>;
    if (typeof wordId !== "string" || wordId.length < 10 || seen.has(wordId)) continue;
    if (typeof typed !== "string" || typed.length === 0 || typed.length > MAX_TYPED) continue;
    seen.add(wordId);
    out.push({ wordId, typed });
  }
  return out;
}
