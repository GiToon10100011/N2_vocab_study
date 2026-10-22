/**
 * 채점 반영의 공용 조각. /api/grades(카드 채점)와 /api/test-answers(실전 테스트 답)가 같이 쓴다.
 * 문장을 실행하지는 않는다. 트랜잭션에 넣을 쿼리를 만들어 줄 뿐이고, 묶는 순서는 호출하는 쪽이 정한다.
 */
import { createHash } from "node:crypto";
import type { db } from "./db";
import type { GradePlanItem } from "./srs";

type Sql = ReturnType<typeof db>;
type Query = ReturnType<Sql["query"]>;

/** 묶음 id 로 받아 줄 모양. 그 밖의 값은 id 없는 요청으로 다룬다. */
export const BATCH_ID = /^[A-Za-z0-9._:-]{6,80}$/;
/** 이보다 오래된 기록은 지운다. 그때까지 같은 묶음을 쥐고 있는 기기는 없다고 본다. */
export const RECEIPT_DAYS = 180;

/**
 * 같은 요청을 알아보는 열쇠. 묶음 id 만으로는 부족하다. 큰 묶음은 나눠서 오고 조각마다 내용이
 * 다른데, id 만 보면 둘째 조각을 「이미 받았다」고 건너뛰어 채점을 잃는다. 내용까지 같아야 같은 요청이다.
 *
 * payload 는 그 요청의 채점 내용이다. 카드 채점의 payload 모양을 바꾸면 이미 보낸 묶음의 열쇠가 달라져
 * 배포 순간에 재전송된 묶음이 두 번 반영된다 — lib/grade-apply.test.ts 가 고정해 둔다.
 */
export function receiptKey(batchId: unknown, payload: unknown): string | null {
  if (typeof batchId !== "string" || !BATCH_ID.test(batchId)) return null;
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `${batchId}:${digest.slice(0, 32)}`;
}

/**
 * 채점과 한 트랜잭션에 넣는다. 반영이 실패하면 이 기록도 함께 취소되어, 다시 보냈을 때 반영된다.
 * 따로 먼저 적어 두면 반영에 실패한 묶음이 「이미 받았다」로 건너뛰어져 채점이 사라진다.
 */
export function receiptQueries(sql: Sql, key: string): Query[] {
  return [
    sql.query(`insert into grade_batches (id) values ($1)`, [key]),
    sql.query(`delete from grade_batches where applied_at < now() - make_interval(days => $1)`, [
      RECEIPT_DAYS,
    ]),
  ];
}

/** 카운터가 있는 항목만 단어를 갱신한다. 주기(schedule)가 있을 때만 stage · next_review 를 바꾼다. */
export function wordUpdateQueries(sql: Sql, plan: GradePlanItem[]): Query[] {
  const queries: Query[] = [];
  for (const item of plan) {
    if (!item.counters) continue;
    const c = item.counters;
    if (item.schedule) {
      queries.push(
        sql.query(
          `update words
              set stage = $1, next_review = $2::date, correct_count = $3,
                  wrong_count = $4, streak = $5, last_wrong_type = $6, last_reviewed = now()
            where id = $7`,
          [
            item.schedule.stage,
            item.schedule.next_review,
            c.correct_count,
            c.wrong_count,
            c.streak,
            c.last_wrong_type,
            item.wordId,
          ],
        ),
      );
    } else {
      // 연습 퀴즈 · 정답 테스트: 오답 기록만 남기고 복습 주기(stage / next_review)는 손대지 않는다.
      queries.push(
        sql.query(
          `update words
              set correct_count = $1, wrong_count = $2, streak = $3, last_wrong_type = $4
            where id = $5`,
          [c.correct_count, c.wrong_count, c.streak, c.last_wrong_type, item.wordId],
        ),
      );
    }
  }
  return queries;
}

/**
 * 리뷰 로그 한 문장. 실전 테스트(opts.test)일 때만 test 열을 더한다. 카드 채점은 예전 문장 그대로라
 * test 열이 없는 DB 에서도 동작한다.
 */
export function reviewInsertQuery(
  sql: Sql,
  plan: GradePlanItem[],
  opts: { test?: boolean } = {},
): Query {
  const width = opts.test ? 6 : 5;
  const logParams: unknown[] = [];
  const logRows = plan.map((item, i) => {
    const base = i * width;
    logParams.push(
      item.wordId,
      item.log.promptType,
      item.log.correct,
      item.log.retry,
      item.log.practice,
    );
    if (opts.test) logParams.push(true);
    return `($${base + 1}::uuid, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}${
      opts.test ? `, $${base + 6}` : ""
    })`;
  });
  const columns = opts.test
    ? "word_id, prompt_type, correct, in_session_retry, practice, test"
    : "word_id, prompt_type, correct, in_session_retry, practice";
  return sql.query(
    `insert into reviews (${columns})
       values ${logRows.join(", ")}`,
    logParams,
  );
}
