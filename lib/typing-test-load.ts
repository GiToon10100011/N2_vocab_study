/**
 * 실전 테스트의 서버 쪽 조회와 시작. 규칙은 lib/typing-test.ts(순수)에 있고, 여기는 거기에 DB 를 붙인다.
 *
 * 표나 열이 아직 없는 DB(스키마보다 코드가 먼저 올라간 경우)에서는 홈이 죽지 않게 「없음」으로 답한다.
 * date / timestamptz 는 다른 조회와 같이 문자열로 고정해서 받는다.
 */
import { db, isMissingSchema } from "./db";
import { MEANING_PASS_MIN } from "./meaning-answer";
import { APP_TIMEZONE, shuffle } from "./srs";
import {
  isTestEligible,
  pickTestWords,
  testPhase,
  testStatus,
  type LatestTest,
  type TestCandidate,
} from "./typing-test";
import type { AppSettings, TestAnswered, TestQuestion } from "./types";

type TestSettings = Pick<AppSettings, "testSize" | "dayStartHour">;

/** 홈 카드와 /test 가 무엇을 보여 줄지. hidden · wait 는 카드가 없다. */
export type TestOverview =
  | { kind: "hidden" } // 낼 수 있는 단어가 없거나 스키마가 아직 없다
  | { kind: "wait"; nextDay: string } // 끝낸 지 이틀이 안 됐다
  | { kind: "due"; count: number } // 새로 시작할 때다
  | { kind: "active"; testDay: string; remaining: number; total: number }; // 이어서 푼다

/** 가장 최근 테스트 하나. 옛 테스트가 되살아나지 않도록 이것만 본다. */
async function fetchLatestTest(): Promise<LatestTest | null> {
  const rows = (await db().query(
    `select to_char(i.test_day, 'YYYY-MM-DD') as test_day,
            count(*)::int as total,
            count(*) filter (where i.answered_at is null and w.suspended = false
                               and w.surface <> w.reading)::int as remaining,
            to_char(max(i.answered_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_answered_at
       from typing_test_items i join words w on w.id = i.word_id
      where i.test_day = (select max(test_day) from typing_test_items)
      group by i.test_day`,
  )) as { test_day: string; total: number; remaining: number; last_answered_at: string | null }[];
  const r = rows[0];
  return r
    ? { testDay: r.test_day, total: r.total, remaining: r.remaining, lastAnsweredAt: r.last_answered_at }
    : null;
}

/**
 * 출제 후보(한자가 있고 학습한 단어)와 각자의 위험 요소. 첫 리뷰의 학습일은 DB 가 하루 경계(dayStartHour)를
 * 반영해 계산한다 — 그날 처음 배운 단어를 가려내는 데 쓴다.
 */
async function fetchCandidates(dayStartHour: number): Promise<TestCandidate[]> {
  const rows = (await db().query(
    `select w.id, w.surface, w.reading, w.stage, w.suspended,
            to_char(w.study_day, 'YYYY-MM-DD') as study_day,
            to_char(((r.first_at at time zone $1::text) - make_interval(hours => $2::int))::date,
                    'YYYY-MM-DD') as first_review_day,
            coalesce(r.s2r_wrong, 0)::int as s2r_wrong,
            coalesce(h.history, '') as history,
            to_char(h.last_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_answered_at
       from words w
       left join (select word_id, min(reviewed_at) as first_at,
                         count(*) filter (where prompt_type = 's2r' and not correct
                                            and not in_session_retry and not practice
                                            and not test) as s2r_wrong
                    from reviews group by word_id) r on r.word_id = w.id
       left join (select word_id,
                         -- 읽기를 틀렸거나 뜻 점수가 모자라면 0. 뜻을 묻지 않던 때의 답(null)은 읽기만 본다.
                         string_agg(case when correct
                                          and coalesce((to_jsonb(i) ->> 'meaning_credit')::float8, 1) >= ${MEANING_PASS_MIN}
                                         then '1' else '0' end, '' order by answered_at) as history,
                         max(answered_at) as last_at
                    from typing_test_items i where answered_at is not null group by word_id) h
              on h.word_id = w.id
      where w.suspended = false and w.stage > 0 and w.surface <> w.reading`,
    [APP_TIMEZONE, dayStartHour],
  )) as {
    id: string;
    surface: string;
    reading: string;
    stage: number;
    suspended: boolean;
    study_day: string;
    first_review_day: string | null;
    s2r_wrong: number;
    history: string;
    last_answered_at: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    surface: r.surface,
    reading: r.reading,
    study_day: r.study_day,
    stage: r.stage,
    suspended: r.suspended,
    firstReviewDay: r.first_review_day,
    s2rWrong: r.s2r_wrong,
    history: [...r.history].map((c) => c === "1"),
    lastAnsweredAt: r.last_answered_at,
  }));
}

export async function loadTestOverview(today: string, s: TestSettings): Promise<TestOverview> {
  try {
    const phase = testPhase(await fetchLatestTest(), today, s.dayStartHour);
    if (phase.phase === "active") {
      return { kind: "active", testDay: phase.testDay, remaining: phase.remaining, total: phase.total };
    }
    if (phase.phase === "wait") return { kind: "wait", nextDay: phase.nextDay };

    const eligible = (await fetchCandidates(s.dayStartHour)).filter((c) => isTestEligible(c, today));
    if (eligible.length === 0) return { kind: "hidden" };
    return { kind: "due", count: Math.min(s.testSize, eligible.length) };
  } catch (err) {
    if (isMissingSchema(err)) return { kind: "hidden" };
    throw err;
  }
}

export interface TestSessionData {
  testDay: string;
  /** 아직 안 푼 문제. 매번 섞는다. 보류된 단어와 가나 전용이 된 단어는 뺀다. */
  questions: TestQuestion[];
  /** 이미 푼 문제. 이어서 푼 테스트의 끝 화면에 전체를 보여 주려고 함께 준다. */
  answered: TestAnswered[];
}

export async function loadTestSession(testDay: string): Promise<TestSessionData> {
  const rows = (await db().query(
    // 뜻 답 열은 to_jsonb 로 읽는다. 열이 아직 없는 DB 에서도 테스트 화면이 열리게 하려는 것이다.
    `select i.word_id, w.surface, w.reading, w.meaning_ko, w.suspended,
            i.typed, i.correct, i.answered_at is not null as answered,
            to_jsonb(i) ->> 'typed_meaning' as typed_meaning,
            (to_jsonb(i) ->> 'meaning_credit')::float8 as meaning_credit
       from typing_test_items i join words w on w.id = i.word_id
      where i.test_day = $1::date`,
    [testDay],
  )) as {
    word_id: string;
    surface: string;
    reading: string;
    meaning_ko: string;
    suspended: boolean;
    typed: string | null;
    correct: boolean | null;
    answered: boolean;
    typed_meaning: string | null;
    meaning_credit: number | null;
  }[];

  const question = (r: (typeof rows)[number]): TestQuestion => ({
    wordId: r.word_id,
    surface: r.surface,
    reading: r.reading,
    meaning_ko: r.meaning_ko,
  });
  return {
    testDay,
    questions: shuffle(
      rows.filter((r) => !r.answered && !r.suspended && r.surface !== r.reading).map(question),
    ),
    answered: rows
      .filter((r) => r.answered)
      .map((r) => ({
        ...question(r),
        typed: r.typed ?? "",
        correct: r.correct === true,
        typedMeaning: r.typed_meaning,
        meaningCredit: r.meaning_credit === null ? null : Number(r.meaning_credit),
      })),
  };
}

/**
 * 「읽기 주의」를 달 단어. 테스트에서 틀린 뒤 아직 두 번 연속 맞히지 못한 단어(재시험 대상과 같은 조건)다.
 * 학습 큐를 만들 때마다 부르므로 오답이 있었던 단어의 이력만 읽는다. 스키마가 아직 없으면 빈 집합이다.
 */
export async function readingCautionIds(): Promise<Set<string>> {
  try {
    const rows = (await db().query(
      `select word_id,
              string_agg(case when correct then '1' else '0' end, '' order by answered_at) as history
         from typing_test_items
        where answered_at is not null
          and word_id in (select word_id from typing_test_items where correct = false)
        group by word_id`,
    )) as { word_id: string; history: string }[];
    return new Set(
      rows
        .filter((r) => testStatus([...r.history].map((c) => c === "1")) === "retest")
        .map((r) => r.word_id),
    );
  } catch (err) {
    if (isMissingSchema(err)) return new Set();
    throw err;
  }
}

/**
 * 오늘의 테스트를 만든다. 지금이 시작할 때(due)가 아니면 아무것도 하지 않는다 — 열어 둔 화면에서
 * 늦게 눌렀거나 두 번 눌러도 한 번만 만든다. 두 번째 방어선으로 같은 날 문항이 이미 있으면 넣지 않는다.
 */
export async function startTypingTest(today: string, s: TestSettings): Promise<"started" | "not-due"> {
  try {
    const phase = testPhase(await fetchLatestTest(), today, s.dayStartHour);
    if (phase.phase !== "ready") return "not-due";

    const ids = pickTestWords(await fetchCandidates(s.dayStartHour), today, s.testSize);
    if (ids.length === 0) return "not-due";

    await db().query(
      `insert into typing_test_items (test_day, word_id)
       select $1::date, unnest($2::uuid[])
        where not exists (select 1 from typing_test_items where test_day = $1::date)`,
      [today, ids],
    );
    return "started";
  } catch (err) {
    if (isMissingSchema(err)) return "not-due";
    throw err;
  }
}
