import type {
  CardKind,
  GradeInput,
  PromptType,
  PromptWeights,
  QueueCard,
  QueueWord,
  SrsState,
  Word,
} from "./types";

/* ------------------------------------------------------------------ *
 * 설정값
 * ------------------------------------------------------------------ */

/** 간격 사다리(일). 인덱스 = stage. stage 0 은 "당일". */
export const LADDER: readonly number[] = [0, 1, 3, 7, 14, 30, 60, 120];
export const MAX_STAGE = LADDER.length - 1;

/** 출제 비율. 한자 -> 읽기가 약점이므로 가장 높게 둔다(기획 5.4). */
export const DEFAULT_WEIGHTS: PromptWeights = { s2r: 60, s2m: 25, r2m: 15 };

export const DEFAULT_NEW_LIMIT = 30;
export const DEFAULT_REVIEW_LIMIT = 150;

/** 하루 경계. 새벽 2시 공부는 전날 분량으로 집계한다. */
export const DAY_START_HOUR = 4;
export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Seoul";

/** 취약 단어(leech) 판정 */
export const WEAK_WRONG_THRESHOLD = 3;
export const WEAK_STREAK_MAX = 1;

/** 신규 단어를 몇 개씩 묶어 복습 사이에 끼워 넣는가. 학습 카드와 퀴즈 사이 간격이 된다. */
export const NEW_BATCH_SIZE = 5;

/** 오답 카드를 세션 안에서 몇 장 뒤에 다시 세우는가. */
export const RETRY_GAP = 5;

/* ------------------------------------------------------------------ *
 * 날짜 유틸 — 전부 'YYYY-MM-DD' 문자열로 다룬다(시각 비교 문제 제거)
 * ------------------------------------------------------------------ */

/** 지금 시각이 속한 "학습 날짜". 서버(UTC)에서도 사용자 현지 날짜가 나오도록 tz 를 고정한다. */
export function studyDate(
  now: Date = new Date(),
  timeZone: string = APP_TIMEZONE,
  dayStartHour: number = DAY_START_HOUR,
): string {
  const shifted = new Date(now.getTime() - dayStartHour * 3600_000);
  // en-CA 로케일은 YYYY-MM-DD 를 준다.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** a - b (일). a 가 b 보다 미래면 양수. */
export function diffDays(a: string, b: string): number {
  const toMs = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toMs(a) - toMs(b)) / 86_400_000);
}

/* ------------------------------------------------------------------ *
 * 단어 상태 판정
 * ------------------------------------------------------------------ */

export function isNew(word: Pick<Word, "stage">): boolean {
  return word.stage === 0;
}

/** 취약 단어: 3회 이상 틀렸고 최근에 연속으로 맞히지 못한 단어. */
export function isWeak(word: Pick<Word, "wrong_count" | "streak">): boolean {
  return (
    word.wrong_count >= WEAK_WRONG_THRESHOLD && word.streak <= WEAK_STREAK_MAX
  );
}

/** 큐 우선순위 1번 버킷(취약/오답)에 들어가는가. */
export function isPriority(
  word: Pick<Word, "wrong_count" | "streak" | "stage">,
): boolean {
  return isWeak(word) || word.stage <= 1;
}

export function stageLabel(stage: number): string {
  if (stage === 0) return "신규";
  if (stage <= 2) return "학습중";
  if (stage <= 5) return "복습중";
  return "안정";
}

/* ------------------------------------------------------------------ *
 * 전이 함수 — 이 앱의 핵심. 서버에서만 호출한다(단일 출처 유지).
 * ------------------------------------------------------------------ */

/** 성적 카운터. 연습 퀴즈도 이건 갱신한다(= 오답노트에 반영된다). */
export interface GradeCounters {
  correct_count: number;
  wrong_count: number;
  streak: number;
  last_wrong_type: PromptType | null;
}

/** 복습 스케줄. 오직 SRS 세션만 이걸 갱신한다. */
export interface GradeSchedule {
  stage: number;
  next_review: string;
}

export type GradePatch = GradeCounters & GradeSchedule;

export function gradeCounters(
  state: SrsState,
  promptType: PromptType,
  correct: boolean,
): GradeCounters {
  if (correct) {
    return {
      correct_count: state.correct_count + 1,
      wrong_count: state.wrong_count,
      streak: state.streak + 1,
      last_wrong_type: null,
    };
  }
  return {
    correct_count: state.correct_count,
    wrong_count: state.wrong_count + 1,
    streak: 0,
    last_wrong_type: promptType,
  };
}

/**
 * 알았음 -> 사다리 한 칸 위로.
 * 몰랐음 -> stage 1 고정(= 내일 다시). 2버튼 시스템에서 가장 예측 가능하고,
 *           한자 약점 보완에 안전한 쪽으로 기운다(기획 5.3).
 */
export function gradeSchedule(
  state: SrsState,
  correct: boolean,
  today: string,
): GradeSchedule {
  if (correct) {
    const stage = Math.min(state.stage + 1, MAX_STAGE);
    return { stage, next_review: addDays(today, LADDER[stage]) };
  }
  return { stage: 1, next_review: addDays(today, LADDER[1]) };
}

export function gradeWord(
  state: SrsState,
  promptType: PromptType,
  correct: boolean,
  today: string,
): GradePatch {
  return {
    ...gradeCounters(state, promptType, correct),
    ...gradeSchedule(state, correct, today),
  };
}

/* ------------------------------------------------------------------ *
 * 출제 유형 선택
 * ------------------------------------------------------------------ */

/** 가나만으로 쓰는 단어(ちゃんと 등)는 표기 == 읽기 이므로 s2r / r2m 이 무의미하다. */
export function isKanaOnly(word: Pick<QueueWord, "surface" | "reading">): boolean {
  return word.surface === word.reading;
}

/** 이 단어에 쓸 수 있는 유형 집합. */
export function allowedTypes(
  word: Pick<QueueWord, "surface" | "reading">,
  hasHomophone: boolean,
): PromptType[] {
  if (isKanaOnly(word)) return ["s2m"];
  // 以外 / 意外 처럼 읽기가 겹치면 "읽기 -> 뜻" 은 답이 하나로 정해지지 않는다.
  if (hasHomophone) return ["s2r", "s2m"];
  return ["s2r", "s2m", "r2m"];
}

export interface PickContext {
  word: Pick<QueueWord, "surface" | "reading" | "stage">;
  hasHomophone: boolean;
  lastWrongType: PromptType | null;
  weights?: PromptWeights;
  /** [0,1) 난수. 테스트에서 주입한다. */
  rand: number;
}

export function pickPromptType(ctx: PickContext): PromptType {
  const allowed = allowedTypes(ctx.word, ctx.hasHomophone);
  if (allowed.length === 1) return allowed[0];

  // 1) 약점 유형이 기록되어 있으면 그 유형으로 강제 출제한다.
  if (ctx.lastWrongType && allowed.includes(ctx.lastWrongType)) {
    return ctx.lastWrongType;
  }
  // 2) 신규 단어의 첫 퀴즈는 항상 한자 -> 읽기.
  if (ctx.word.stage === 0 && allowed.includes("s2r")) return "s2r";

  // 3) 가중 추첨(허용 집합 기준으로 재정규화).
  const weights = ctx.weights ?? DEFAULT_WEIGHTS;
  const total = allowed.reduce((sum, t) => sum + weights[t], 0);
  let r = ctx.rand * total;
  for (const t of allowed) {
    r -= weights[t];
    if (r < 0) return t;
  }
  return allowed[allowed.length - 1];
}

/* ------------------------------------------------------------------ *
 * 오늘의 큐 구성
 * ------------------------------------------------------------------ */

export interface BuildQueueInput {
  /** next_review <= today 인 복습 후보 + stage 0 인 신규 후보. suspended 는 이미 제외된 상태. */
  words: Word[];
  today: string;
  /** 읽기별 전체 단어 수. 동음 충돌 감지용. */
  readingCounts: Record<string, number>;
  newLimit?: number;
  reviewLimit?: number;
  skipNew?: boolean;
  weights?: PromptWeights;
  rand?: () => number;
}

function toQueueWord(w: Word): QueueWord {
  return {
    id: w.id,
    surface: w.surface,
    reading: w.reading,
    meaning_ko: w.meaning_ko,
    stage: w.stage,
    wrong_count: w.wrong_count,
  };
}

/**
 * 우선순위 1 취약/오답 -> 2 일반 복습 -> 3 신규 순으로 뽑고,
 * 복습 카드 사이에 신규를 NEW_BATCH_SIZE 개씩 끼워 넣는다.
 * 신규는 [학습카드 x5][퀴즈 x5] 형태로 배치되어 학습과 퀴즈 사이에 자연스러운 간격이 생긴다.
 */
export function buildQueue(input: BuildQueueInput): QueueCard[] {
  const {
    words,
    today,
    readingCounts,
    newLimit = DEFAULT_NEW_LIMIT,
    reviewLimit = DEFAULT_REVIEW_LIMIT,
    skipNew = false,
    weights = DEFAULT_WEIGHTS,
    rand = Math.random,
  } = input;

  const usable = words.filter((w) => !w.suspended);

  const dueReviews = usable.filter(
    (w) => w.stage > 0 && diffDays(today, w.next_review) >= 0,
  );
  const newWords = usable
    .filter((w) => w.stage === 0)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const priority = dueReviews
    .filter(isPriority)
    .sort((a, b) => diffDays(today, b.next_review) - diffDays(today, a.next_review));
  const normal = dueReviews
    .filter((w) => !isPriority(w))
    .sort((a, b) => a.next_review.localeCompare(b.next_review));

  const reviewWords = [...priority, ...normal].slice(0, reviewLimit);

  const reviewCards: QueueCard[] = reviewWords.map((w) => {
    const qw = toQueueWord(w);
    const kind = pickPromptType({
      word: qw,
      hasHomophone: (readingCounts[w.reading] ?? 1) > 1,
      lastWrongType: w.last_wrong_type,
      weights,
      rand: rand(),
    });
    return { key: `${w.id}:q`, kind, word: qw, weak: isWeak(w) };
  });

  const pickedNew = skipNew ? [] : newWords.slice(0, newLimit);
  const newBatches: QueueCard[][] = [];
  for (let i = 0; i < pickedNew.length; i += NEW_BATCH_SIZE) {
    const batch = pickedNew.slice(i, i + NEW_BATCH_SIZE);
    const learn: QueueCard[] = batch.map((w) => ({
      key: `${w.id}:learn`,
      kind: "learn" as CardKind,
      word: toQueueWord(w),
      weak: false,
    }));
    const quiz: QueueCard[] = batch.map((w) => {
      const qw = toQueueWord(w);
      return {
        key: `${w.id}:q`,
        // 신규 첫 퀴즈는 항상 한자 -> 읽기 (가나 전용 단어만 예외)
        kind: pickPromptType({
          word: qw,
          hasHomophone: (readingCounts[w.reading] ?? 1) > 1,
          lastWrongType: null,
          weights,
          rand: 0,
        }),
        word: qw,
        weak: false,
      };
    });
    newBatches.push([...learn, ...quiz]);
  }

  return interleave(reviewCards, newBatches);
}

/** Fisher-Yates. rand 를 주입해 테스트에서 결정적으로 돌린다. */
export function shuffle<T>(items: T[], rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface BuildPracticeInput {
  words: Word[];
  readingCounts: Record<string, number>;
  weights?: PromptWeights;
  rand?: () => number;
}

/**
 * 연습 퀴즈 큐. 아무 때나 눌러서 돌리는 용도라 SRS 를 전혀 건드리지 않는다.
 * 학습 카드도 없고, 매번 순서가 섞인다. 단어 하나당 카드 하나.
 */
export function buildPracticeQueue(input: BuildPracticeInput): QueueCard[] {
  const { words, readingCounts, weights = DEFAULT_WEIGHTS, rand = Math.random } = input;
  return shuffle(
    words.filter((w) => !w.suspended),
    rand,
  ).map((w) => {
    const qw = toQueueWord(w);
    return {
      key: `${w.id}:p`,
      kind: pickPromptType({
        word: qw,
        hasHomophone: (readingCounts[w.reading] ?? 1) > 1,
        // 연습에서는 약점 유형 강제를 쓰지 않는다. 매번 다른 각도로 보는 게 목적이다.
        lastWrongType: null,
        weights,
        rand: rand(),
      }),
      word: qw,
      weak: isWeak(w),
    };
  });
}

function interleave(reviewCards: QueueCard[], newBatches: QueueCard[][]): QueueCard[] {
  if (newBatches.length === 0) return reviewCards;
  const slots = newBatches.length + 1;
  const per = Math.floor(reviewCards.length / slots);
  const extra = reviewCards.length % slots;
  const out: QueueCard[] = [];
  let idx = 0;
  for (let i = 0; i < slots; i++) {
    const take = per + (i < extra ? 1 : 0);
    out.push(...reviewCards.slice(idx, idx + take));
    idx += take;
    if (i < newBatches.length) out.push(...newBatches[i]);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 채점 배치 계획 — 서버 액션이 그대로 실행하기만 하면 되도록 순수 함수로 뽑았다.
 * ------------------------------------------------------------------ */

export interface GradePlanItem {
  wordId: string;
  /** 성적 카운터 갱신. null 이면 아무것도 바꾸지 않는다. */
  counters: GradeCounters | null;
  /** 복습 스케줄 갱신. 연습 퀴즈에서는 항상 null 이다. */
  schedule: GradeSchedule | null;
  log: { promptType: CardKind; correct: boolean; retry: boolean; practice: boolean };
}

/**
 * 학습 카드 통과와 세션 내 재시도는 로그만 남긴다.
 * 정답을 방금 본 직후 맞히는 것은 기억이 아니라 잔상이기 때문이다(기획 5.3).
 *
 * practice = true (일차/주차 연습 퀴즈):
 *   복습 주기(stage / next_review)는 절대 건드리지 않지만,
 *   오답 기록(wrong_count / streak / last_wrong_type)에는 반영한다.
 *   "연습에서 계속 틀리는 단어"는 진짜로 약한 단어이므로 오답노트에 올라와야 한다.
 */
export function planGrades(
  states: Map<string, SrsState>,
  grades: GradeInput[],
  today: string,
  practice = false,
): GradePlanItem[] {
  const out: GradePlanItem[] = [];
  for (const g of grades) {
    const log = { promptType: g.kind, correct: g.correct, retry: g.retry, practice };
    if (g.kind === "learn" || g.retry) {
      out.push({ wordId: g.wordId, counters: null, schedule: null, log });
      continue;
    }
    const state = states.get(g.wordId);
    if (!state) continue; // 삭제된 단어

    const counters = gradeCounters(state, g.kind, g.correct);
    const schedule = practice ? null : gradeSchedule(state, g.correct, today);

    states.set(g.wordId, {
      stage: schedule ? schedule.stage : state.stage,
      ...counters,
    });
    out.push({ wordId: g.wordId, counters, schedule, log });
  }
  return out;
}

/** 주어진 시간대에서 instant 의 UTC 오프셋(분). */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUTC - instant.getTime()) / 60_000);
}

/** 학습 날짜 ymd 가 시작되는 실제 시각(= 그날 04:00 현지시각). 통계 쿼리 경계로 쓴다. */
export function studyDayStart(
  ymd: string,
  timeZone: string = APP_TIMEZONE,
  dayStartHour: number = DAY_START_HOUR,
): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, dayStartHour));
  return new Date(guess.getTime() - tzOffsetMinutes(guess, timeZone) * 60_000);
}
