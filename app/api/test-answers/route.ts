import { NextResponse } from "next/server";
import { db, isMissingSchema, pgCode } from "@/lib/db";
import {
  receiptKey,
  receiptQueries,
  reviewInsertQuery,
  wordUpdateQueries,
} from "@/lib/grade-apply";
import { fetchTestWordRows, fetchUnansweredTestWordIds } from "@/lib/queries";
import { judgeReading } from "@/lib/reading-answer";
import { getSettingsAndToday } from "@/lib/settings";
import { planTestGrades } from "@/lib/srs";
import { parseTestAnswers } from "@/lib/typing-test";
import type { SrsState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 실전 테스트 답 배치. 클라이언트는 화면에서 한 즉시 판정을 보내지 않고 친 가나(typed)만 보낸다.
 * 정오는 여기서 같은 함수(judgeReading)로 다시 채점한다 — 화면과 서버가 어긋나도 서버 판정이 기록된다.
 *
 * 같은 답은 한 번만 반영한다.
 *  - 같은 묶음이 다시 오면(응답 유실 뒤 재전송) 영수증이 알아본다. /api/grades 와 같은 규칙이다.
 *  - 다른 묶음 id 로 같은 답이 오면(두 기기) 안 푼 문항에만 반영하므로 건너뛴다.
 *
 * 스키마가 아직 없는 DB 에서는 503 으로 답한다. ok 로 답하면 클라이언트가 답을 지운다.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const testDay = (body as { testDay?: unknown })?.testDay;
  if (typeof testDay !== "string" || !DAY.test(testDay)) {
    return NextResponse.json({ ok: false, error: "bad testDay" }, { status: 400 });
  }
  const answers = parseTestAnswers((body as { answers?: unknown })?.answers);
  if (answers.length === 0) return NextResponse.json({ ok: true, applied: 0 });

  const sql = db();
  try {
    let key = receiptKey(
      (body as { batchId?: unknown })?.batchId,
      ["test", testDay, answers.map((a) => [a.wordId, a.typed])],
    );
    if (key) {
      try {
        const seen = (await sql.query(`select 1 from grade_batches where id = $1`, [key])) as unknown[];
        if (seen.length > 0) return NextResponse.json({ ok: true, applied: 0, duplicate: true });
      } catch (err) {
        // 영수증 표만 없는 DB 에서는 예전 채점처럼 영수증 없이 반영한다.
        if (pgCode(err) !== "42P01") throw err;
        key = null;
      }
    }

    const ids = answers.map((a) => a.wordId);
    const open = await fetchUnansweredTestWordIds(testDay, ids);
    const rows = await fetchTestWordRows(ids.filter((id) => open.has(id)));
    const byId = new Map(rows.map((r) => [r.id, r]));

    // 서버가 다시 채점한다. 채점할 수 없는 답(한자가 섞인 것)은 건너뛰어 그 문항을 안 푼 채로 둔다.
    const judged = new Map<string, { kana: string; correct: boolean }>();
    for (const a of answers) {
      const word = byId.get(a.wordId);
      if (!word) continue;
      const j = judgeReading(a.typed, word);
      if (j.result === "invalid") continue;
      judged.set(a.wordId, { kana: j.kana, correct: j.result === "correct" });
    }

    const states = new Map<string, SrsState>(
      [...judged.keys()].map((id) => {
        const r = byId.get(id)!;
        return [
          id,
          {
            stage: r.stage,
            correct_count: r.correct_count,
            wrong_count: r.wrong_count,
            streak: r.streak,
            last_wrong_type: r.last_wrong_type,
          },
        ];
      }),
    );
    const { today } = await getSettingsAndToday();
    const plan = planTestGrades(
      states,
      [...judged].map(([wordId, j]) => ({ wordId, correct: j.correct })),
      today,
    );
    if (plan.length === 0) return NextResponse.json({ ok: true, applied: 0 });

    // 영수증 · 문항 · 단어 · 로그를 한 트랜잭션에 넣는다. 하나라도 실패하면 모두 취소되어 다시 보냈을 때 반영된다.
    const queries = [
      ...(key ? receiptQueries(sql, key) : []),
      ...plan.map((item) => {
        const j = judged.get(item.wordId)!;
        return sql.query(
          `update typing_test_items
              set typed = $3, correct = $4, answered_at = now()
            where test_day = $1::date and word_id = $2::uuid and answered_at is null`,
          [testDay, item.wordId, j.kana, j.correct],
        );
      }),
      ...wordUpdateQueries(sql, plan),
      reviewInsertQuery(sql, plan, { test: true }),
    ];

    try {
      await sql.transaction(queries);
    } catch (err) {
      // 같은 요청이 겹쳐 들어와 다른 쪽이 먼저 반영했다. 기본 키가 겹쳐 이쪽은 전부 취소됐다.
      if (key && pgCode(err) === "23505") {
        return NextResponse.json({ ok: true, applied: 0, duplicate: true });
      }
      throw err;
    }
    return NextResponse.json({ ok: true, applied: plan.length });
  } catch (err) {
    if (isMissingSchema(err)) {
      return NextResponse.json({ ok: false, error: "schema" }, { status: 503 });
    }
    throw err;
  }
}
