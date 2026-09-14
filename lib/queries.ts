import { db } from "./db";
import type { AppSettings, PromptType, StudyDayGroup, TodayCounts, Word } from "./types";
import {
  DAY_START_HOUR,
  DEFAULT_NEW_LIMIT,
  DEFAULT_REVIEW_LIMIT,
  DEFAULT_WEIGHTS,
  WEAK_STREAK_MAX,
  WEAK_WRONG_THRESHOLD,
  diffDays,
} from "./srs";

/**
 * date / timestamptz 는 드라이버마다 파싱 결과가 달라지므로 전부 문자열로 고정해서 받는다.
 * (앱 전체가 'YYYY-MM-DD' 문자열을 전제로 동작한다)
 */
const WORD_COLS = `
  id, surface, reading, meaning_ko, note,
  to_char(study_day, 'YYYY-MM-DD') as study_day,
  to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
  stage,
  to_char(next_review, 'YYYY-MM-DD') as next_review,
  to_char(last_reviewed at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_reviewed,
  correct_count, wrong_count, streak, last_wrong_type, suspended
`;

export async function fetchTodayCounts(today: string): Promise<TodayCounts> {
  const rows = (await db().query(
    `select
       count(*) filter (where stage = 0)                                        as new_count,
       count(*) filter (where stage > 0 and next_review <= $1::date)            as review_count,
       count(*) filter (where stage > 0 and next_review <= $1::date
                          and wrong_count >= $2 and streak <= $3)               as weak_count,
       count(*)                                                                 as total_words
     from words
     where suspended = false`,
    [today, WEAK_WRONG_THRESHOLD, WEAK_STREAK_MAX],
  )) as Record<string, string>[];
  const r = rows[0] ?? {};
  return {
    newCount: Number(r.new_count ?? 0),
    reviewCount: Number(r.review_count ?? 0),
    weakCount: Number(r.weak_count ?? 0),
    totalWords: Number(r.total_words ?? 0),
  };
}

/** 학습일 그룹 목록. N일차 / N주차는 가장 이른 학습일을 기준으로 매긴다. */
export async function fetchStudyDays(today: string): Promise<StudyDayGroup[]> {
  const rows = (await db().query(
    `select to_char(study_day, 'YYYY-MM-DD')                                as study_day,
            count(*)::int                                                   as total,
            count(*) filter (where suspended = false
                               and stage > 0
                               and next_review <= $1::date)::int            as due_today,
            count(*) filter (where suspended = false and stage = 0)::int    as new_count
       from words
      group by study_day
      order by study_day asc`,
    [today],
  )) as { study_day: string; total: number; due_today: number; new_count: number }[];

  if (rows.length === 0) return [];
  const first = rows[0].study_day;
  return rows.map((r, i) => ({
    study_day: r.study_day,
    dayIndex: i + 1,
    weekIndex: Math.floor(diffDays(r.study_day, first) / 7) + 1,
    total: r.total,
    dueToday: r.due_today,
    newCount: r.new_count,
  }));
}

/**
 * 큐 후보. 밀린 복습이 아무리 쌓여도 페이로드가 폭발하지 않도록 넉넉한 상한만 둔다.
 * 실제 상한(150 / 30)은 buildQueue 가 적용한다.
 */
export async function fetchQueueCandidates(today: string): Promise<Word[]> {
  const rows = await db().query(
    `(select ${WORD_COLS} from words
       where suspended = false and stage > 0 and next_review <= $1::date
       order by next_review asc limit 400)
     union all
     (select ${WORD_COLS} from words
       where suspended = false and stage = 0
       order by created_at asc limit 60)`,
    [today],
  );
  return rows as unknown as Word[];
}

/** 읽기가 겹치는 단어들. 以外 / 意外 처럼 충돌하면 "읽기 -> 뜻" 을 빼기 위해 쓴다. */
export async function fetchHomophoneCounts(): Promise<Record<string, number>> {
  const rows = (await db().query(
    `select reading, count(*)::int as n
       from words where suspended = false
      group by reading having count(*) > 1`,
  )) as { reading: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.reading, r.n]));
}

export async function fetchSettings(): Promise<AppSettings> {
  const rows = (await db().query(
    `select new_limit, review_limit, weight_s2r, weight_s2m, weight_r2m, day_start_hour,
            to_char(last_backup_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_backup_at
       from settings where id = 1`,
  )) as Record<string, number | string | null>[];
  const r = rows[0];
  if (!r) {
    return {
      newLimit: DEFAULT_NEW_LIMIT,
      reviewLimit: DEFAULT_REVIEW_LIMIT,
      weights: { ...DEFAULT_WEIGHTS },
      dayStartHour: DAY_START_HOUR,
      lastBackupAt: null,
    };
  }
  const num = (k: string) => Number(r[k]);
  return {
    newLimit: num("new_limit"),
    reviewLimit: num("review_limit"),
    weights: { s2r: num("weight_s2r"), s2m: num("weight_s2m"), r2m: num("weight_r2m") },
    dayStartHour: num("day_start_hour"),
    lastBackupAt: (r.last_backup_at as string | null) ?? null,
  };
}

export async function saveSettings(s: AppSettings): Promise<void> {
  await db().query(
    `insert into settings (id, new_limit, review_limit, weight_s2r, weight_s2m, weight_r2m, day_start_hour)
     values (1, $1, $2, $3, $4, $5, $6)
     on conflict (id) do update set
       new_limit = excluded.new_limit, review_limit = excluded.review_limit,
       weight_s2r = excluded.weight_s2r, weight_s2m = excluded.weight_s2m,
       weight_r2m = excluded.weight_r2m, day_start_hour = excluded.day_start_hour`,
    [s.newLimit, s.reviewLimit, s.weights.s2r, s.weights.s2m, s.weights.r2m, s.dayStartHour],
  );
}

/** 유형별 정답률. 한자->읽기가 유독 낮으면 비중을 더 올릴 근거가 된다. */
export async function fetchTypeStats(since: string) {
  const rows = (await db().query(
    `select prompt_type,
            count(*)::int                             as total,
            count(*) filter (where correct)::int      as correct,
            count(*) filter (where practice)::int     as practice
       from reviews
      where reviewed_at >= $1::timestamptz
        and prompt_type <> 'learn' and in_session_retry = false
      group by prompt_type`,
    [since],
  )) as { prompt_type: PromptType; total: number; correct: number; practice: number }[];
  return rows;
}

export interface PeriodStats {
  newCount: number;
  reviewCount: number;
  correctCount: number;
  accuracy: number | null;
}

/** since 는 ISO 문자열. 전체 기간이면 아주 과거를 넘긴다. */
export async function fetchPeriodStats(
  since: string,
  includePractice = true,
): Promise<PeriodStats> {
  const practiceClause = includePractice ? "" : "and practice = false";
  const rows = (await db().query(
    `select
       (select count(*) from words where created_at >= $1::timestamptz) as new_count,
       (select count(*) from reviews
          where reviewed_at >= $1::timestamptz
            and prompt_type <> 'learn' and in_session_retry = false
            ${practiceClause})                                           as review_count,
       (select count(*) from reviews
          where reviewed_at >= $1::timestamptz
            and prompt_type <> 'learn' and in_session_retry = false
            ${practiceClause} and correct)                               as correct_count`,
    [since],
  )) as Record<string, string>[];
  const r = rows[0] ?? {};
  const reviewCount = Number(r.review_count ?? 0);
  const correctCount = Number(r.correct_count ?? 0);
  return {
    newCount: Number(r.new_count ?? 0),
    reviewCount,
    correctCount,
    accuracy: reviewCount > 0 ? correctCount / reviewCount : null,
  };
}

export async function fetchWeakTotal(): Promise<number> {
  const rows = (await db().query(
    `select count(*) as n from words
      where suspended = false and wrong_count >= $1 and streak <= $2`,
    [WEAK_WRONG_THRESHOLD, WEAK_STREAK_MAX],
  )) as { n: string }[];
  return Number(rows[0]?.n ?? 0);
}

export async function fetchWordsBySurface(surface: string): Promise<Word[]> {
  const rows = await db().query(
    `select ${WORD_COLS} from words where surface = $1 order by created_at asc limit 5`,
    [surface],
  );
  return rows as unknown as Word[];
}

export async function fetchRecentlyAdded(limit = 20): Promise<Word[]> {
  const rows = await db().query(
    `select ${WORD_COLS} from words order by created_at desc limit $1`,
    [limit],
  );
  return rows as unknown as Word[];
}

/** 학습일 범위로 단어를 가져온다. 일차 퀴즈(from == to)와 주차 퀴즈 모두 이걸로 처리한다. */
export async function fetchWordsInRange(from: string, to: string): Promise<Word[]> {
  const rows = await db().query(
    `select ${WORD_COLS} from words
      where suspended = false and study_day between $1::date and $2::date
      order by created_at asc`,
    [from, to],
  );
  return rows as unknown as Word[];
}

export async function fetchAllWords(): Promise<Word[]> {
  const rows = await db().query(
    `select ${WORD_COLS} from words order by created_at asc`,
  );
  return rows as unknown as Word[];
}

export interface InsertResult {
  word: Word;
  /** 이미 있던 단어라 뜻만 갱신했는가. SRS 진도는 건드리지 않는다. */
  merged: boolean;
}

/**
 * (표기, 읽기)가 같으면 같은 단어로 본다.
 * 중복을 막는 이유는 입력 실수가 아니라, 같은 단어에 SRS 스케줄이 2개 생겨
 * 복습량이 조용히 두 배가 되는 것을 막기 위해서다.
 * 대신 저장을 실패시키지 않고 뜻만 갱신해서 입력 흐름을 끊지 않는다.
 */
export async function insertWord(input: {
  surface: string;
  reading: string;
  meaning_ko: string;
  study_day: string;
  note?: string | null;
}): Promise<InsertResult> {
  const rows = (await db().query(
    `insert into words (surface, reading, meaning_ko, note, study_day)
     values ($1, $2, $3, $4, $5::date)
     on conflict (surface, reading) do update
        set meaning_ko = excluded.meaning_ko,
            note       = coalesce(excluded.note, words.note)
     returning ${WORD_COLS}, (xmax <> 0) as merged`,
    [input.surface, input.reading, input.meaning_ko, input.note ?? null, input.study_day],
  )) as unknown as (Word & { merged: boolean })[];
  const { merged, ...word } = rows[0];
  return { word: word as Word, merged };
}

/* ------------------------------------------------------------------ *
 * 단어 목록 / 오답노트
 * ------------------------------------------------------------------ */

export type WordStatus = "all" | "new" | "learning" | "review" | "stable";
export type WordFlag = "all" | "wrong" | "weak" | "suspended";

export interface WordFilter {
  q?: string;
  status?: WordStatus;
  flag?: WordFlag;
  day?: string;
  limit?: number;
  offset?: number;
}

const STATUS_SQL: Record<Exclude<WordStatus, "all">, string> = {
  new: "stage = 0",
  learning: "stage between 1 and 2",
  review: "stage between 3 and 5",
  stable: "stage >= 6",
};

export async function searchWords(
  filter: WordFilter,
): Promise<{ rows: Word[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.q?.trim()) {
    params.push(`%${filter.q.trim()}%`);
    const i = params.length;
    where.push(`(surface ilike $${i} or reading ilike $${i} or meaning_ko ilike $${i})`);
  }
  if (filter.status && filter.status !== "all") where.push(STATUS_SQL[filter.status]);
  if (filter.day) {
    params.push(filter.day);
    where.push(`study_day = $${params.length}::date`);
  }
  switch (filter.flag) {
    case "wrong":
      where.push("wrong_count > 0 and suspended = false");
      break;
    case "weak":
      where.push(
        `wrong_count >= ${WEAK_WRONG_THRESHOLD} and streak <= ${WEAK_STREAK_MAX} and suspended = false`,
      );
      break;
    case "suspended":
      where.push("suspended = true");
      break;
    default:
      where.push("suspended = false");
  }

  const clause = where.length > 0 ? `where ${where.join(" and ")}` : "";
  // 오답/취약 목록은 "많이 틀린 순", 나머지는 "최근 추가 순"이 쓸모 있다.
  const order =
    filter.flag === "wrong" || filter.flag === "weak"
      ? "wrong_count desc, streak asc, created_at desc"
      : "study_day desc, created_at desc";

  const limit = Math.min(filter.limit ?? 100, 500);
  const offset = Math.max(filter.offset ?? 0, 0);

  const [rows, count] = await Promise.all([
    db().query(
      `select ${WORD_COLS} from words ${clause} order by ${order} limit ${limit} offset ${offset}`,
      params,
    ),
    db().query(`select count(*) as n from words ${clause}`, params),
  ]);

  return {
    rows: rows as unknown as Word[],
    total: Number((count as { n: string }[])[0]?.n ?? 0),
  };
}

export async function updateWordRow(
  id: string,
  /** study_day 가 null 이면 기존 값을 유지한다. */
  patch: { surface: string; reading: string; meaning_ko: string; study_day: string | null },
): Promise<Word | null> {
  const rows = await db().query(
    `update words
        set surface = $2, reading = $3, meaning_ko = $4,
            study_day = coalesce($5::date, study_day)
      where id = $1::uuid
      returning ${WORD_COLS}`,
    [id, patch.surface, patch.reading, patch.meaning_ko, patch.study_day],
  );
  return (rows as unknown as Word[])[0] ?? null;
}

export async function deleteWordRow(id: string): Promise<void> {
  await db().query(`delete from words where id = $1::uuid`, [id]);
}

export async function setSuspendedRow(id: string, suspended: boolean): Promise<void> {
  await db().query(`update words set suspended = $2 where id = $1::uuid`, [id, suspended]);
}

export async function fetchWordsByIds(ids: string[]): Promise<Word[]> {
  if (ids.length === 0) return [];
  const rows = await db().query(
    `select ${WORD_COLS} from words where id = any($1::uuid[]) and suspended = false`,
    [ids],
  );
  return rows as unknown as Word[];
}

/** 오답노트 대상. 한 번이라도 틀린 단어. */
export async function fetchWrongNoteWords(limit = 200): Promise<Word[]> {
  const rows = await db().query(
    `select ${WORD_COLS} from words
      where suspended = false and wrong_count > 0
      order by wrong_count desc, streak asc, created_at desc
      limit $1`,
    [limit],
  );
  return rows as unknown as Word[];
}

export async function fetchWrongTotal(): Promise<number> {
  const rows = (await db().query(
    `select count(*) as n from words where suspended = false and wrong_count > 0`,
  )) as { n: string }[];
  return Number(rows[0]?.n ?? 0);
}

export interface SrsRow {
  id: string;
  stage: number;
  correct_count: number;
  wrong_count: number;
  streak: number;
  last_wrong_type: PromptType | null;
}

export async function fetchSrsStates(ids: string[]): Promise<SrsRow[]> {
  if (ids.length === 0) return [];
  const rows = await db().query(
    `select id, stage, correct_count, wrong_count, streak, last_wrong_type
       from words where id = any($1::uuid[])`,
    [ids],
  );
  return rows as unknown as SrsRow[];
}

export async function fetchReviewLogsSince(since: string) {
  const rows = await db().query(
    `select word_id,
            to_char(reviewed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as reviewed_at,
            prompt_type, correct, in_session_retry
       from reviews where reviewed_at >= $1::timestamptz
       order by reviewed_at asc`,
    [since],
  );
  return rows as unknown as {
    word_id: string;
    reviewed_at: string;
    prompt_type: string;
    correct: boolean;
    in_session_retry: boolean;
  }[];
}
