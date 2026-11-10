/**
 * 실전 테스트(한자 → 읽기 · 뜻 타이핑)의 규칙. 전부 순수 함수다. DB 조회는 lib/typing-test-load.ts 가 한다.
 *
 * - 이틀에 한 번, 마지막으로 「끝낸」 테스트의 학습일 기준으로 뜬다. 며칠을 건너뛰어도 뜨는 것은 1회분이다.
 * - N 자리를 재시험 → 처음 보는 단어(무작위) → 통과한 단어(오래된 순) 로 채우고 섞는다. 단어장 전체를 한 바퀴
 *   무작위로 돌고 나서 다음 바퀴로 간다. 카드 오답 같은 가중치를 두지 않는다 — 카드 복습에 자주 나오는 단어가
 *   테스트에도 몰려서 두 쪽에 같은 단어만 나왔다(2026-11-10, 사용자 결정).
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
  stage: number;
  suspended: boolean;
  /** 첫 리뷰 로그(learn 포함)의 학습일. 로그가 없으면 null */
  firstReviewDay: string | null;
  /** 테스트 답의 정오, 오래된 것부터 */
  history: boolean[];
  /** 마지막 테스트 답 시각(ISO) */
  lastAnsweredAt: string | null;
}

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

/** 마지막 답이 오래된 것부터. 답이 없으면 가장 오래된 것으로 친다. */
function byLastAnswered(a: TestCandidate, b: TestCandidate): number {
  const x = a.lastAnsweredAt ?? "";
  const y = b.lastAnsweredAt ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * 오래된 순. 같은 시각끼리는 무작위다 — 한 묶음으로 보낸 답은 answered_at 이 같아서, 입력 순서를 따르면
 * 다음 바퀴가 지난 바퀴와 같은 순서로 나온다. 섞은 뒤 안정 정렬한다.
 */
function oldestFirst(cs: TestCandidate[], rand: () => number): TestCandidate[] {
  return shuffle(cs, rand).sort(byLastAnswered);
}

/** 이번 테스트에 낼 단어 id. 순서는 섞여 있다. */
export function pickTestWords(
  cands: TestCandidate[],
  today: string,
  size: number,
  rand: () => number = Math.random,
): string[] {
  const eligible = cands.filter((c) => isTestEligible(c, today));
  const of = (s: TestStatus) => eligible.filter((c) => testStatus(c.history) === s);
  const picked = [
    ...oldestFirst(of("retest"), rand),
    ...shuffle(of("untested"), rand),
    ...oldestFirst(of("passed"), rand),
  ].slice(0, size);
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
 * 읽기 주의
 * ------------------------------------------------------------------ */

/**
 * 테스트에서 틀린 뒤 아직 두 번 연속 맞히지 못한 단어(ids)의 카드에 caution 을 단다.
 * 표시가 없는 카드는 그대로 둔다(키가 없다). 입력 배열은 바꾸지 않는다.
 */
export function markCaution<T extends { word: { id: string } }>(
  cards: T[],
  ids: ReadonlySet<string>,
): (T & { caution?: boolean })[] {
  return cards.map((c) => (ids.has(c.word.id) ? { ...c, caution: true } : c));
}

/* ------------------------------------------------------------------ *
 * 답 요청
 * ------------------------------------------------------------------ */

const MAX_ANSWERS = 200;
const MAX_TYPED = 64;
const MAX_MEANING = 100;

export interface TestAnswerInput {
  wordId: string;
  typed: string;
  typedMeaning?: string;
  /** 「이것도 정답」을 눌렀다: 친 뜻을 단어의 뜻 목록에 더하고 정답으로 친다. typedMeaning 이 있을 때만 둔다. */
  acceptMeaning?: true;
}

/**
 * /api/test-answers 의 answers. 모양이 맞는 것만, 같은 단어는 첫 답만 받는다.
 * typedMeaning 은 뜻을 물은 화면이 보낸다. 없거나 모양이 틀리면 키를 두지 않는다 — 읽기만 반영한다
 * (뜻을 묻지 않던 예전 화면의 요청도 그대로 받아야 한다). acceptMeaning 은 true 일 때만 키를 둔다.
 */
export function parseTestAnswers(raw: unknown): TestAnswerInput[] {
  if (!Array.isArray(raw)) return [];
  const out: TestAnswerInput[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_ANSWERS) break;
    if (typeof item !== "object" || item === null) continue;
    const { wordId, typed, typedMeaning, acceptMeaning } = item as Record<string, unknown>;
    if (typeof wordId !== "string" || wordId.length < 10 || seen.has(wordId)) continue;
    if (typeof typed !== "string" || typed.length === 0 || typed.length > MAX_TYPED) continue;
    seen.add(wordId);
    const meaning = typeof typedMeaning === "string" ? typedMeaning.trim() : "";
    if (meaning.length === 0 || meaning.length > MAX_MEANING) {
      out.push({ wordId, typed });
      continue;
    }
    out.push(
      acceptMeaning === true
        ? { wordId, typed, typedMeaning: meaning, acceptMeaning: true }
        : { wordId, typed, typedMeaning: meaning },
    );
  }
  return out;
}
