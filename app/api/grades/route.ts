import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchSrsStates } from "@/lib/queries";
import { planGrades } from "@/lib/srs";
import { getSettingsAndToday } from "@/lib/settings";
import type { CardKind, GradeInput, SrsState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: CardKind[] = ["learn", "s2r", "s2m", "r2m"];
const MAX_BATCH = 500;

/** 묶음 id 로 받아 줄 모양. 그 밖의 값은 id 없는 요청으로 다룬다. */
const BATCH_ID = /^[A-Za-z0-9._:-]{6,80}$/;
/** 이보다 오래된 기록은 지운다. 그때까지 같은 묶음을 쥐고 있는 기기는 없다고 본다. */
const RECEIPT_DAYS = 180;

/**
 * 같은 요청을 알아보는 열쇠. 묶음 id 만으로는 부족하다. 큰 묶음은 나눠서 오고 조각마다 내용이
 * 다른데, id 만 보면 둘째 조각을 「이미 받았다」고 건너뛰어 채점을 잃는다. 내용까지 같아야 같은 요청이다.
 */
function receiptKey(batchId: unknown, practice: boolean, grades: GradeInput[]): string | null {
  if (typeof batchId !== "string" || !BATCH_ID.test(batchId)) return null;
  const digest = createHash("sha256")
    .update(JSON.stringify([practice, grades.map((g) => [g.wordId, g.kind, g.correct, g.retry])]))
    .digest("hex");
  return `${batchId}:${digest.slice(0, 32)}`;
}

const pgCode = (err: unknown) => (err as { code?: unknown } | null)?.code;

function parseGrades(raw: unknown): GradeInput[] {
  if (!Array.isArray(raw)) return [];
  const out: GradeInput[] = [];
  for (const item of raw.slice(0, MAX_BATCH)) {
    if (typeof item !== "object" || item === null) continue;
    const g = item as Record<string, unknown>;
    if (typeof g.wordId !== "string" || g.wordId.length < 10) continue;
    if (!KINDS.includes(g.kind as CardKind)) continue;
    out.push({
      wordId: g.wordId,
      kind: g.kind as CardKind,
      correct: g.correct === true,
      retry: g.retry === true,
    });
  }
  return out;
}

/**
 * 채점 배치. 세션 중에는 낙관적으로 화면을 넘기고, 되돌리기 시간이 지난 채점을 모아 여기로 보낸다.
 * SRS 계산은 서버에서만 한다(lib/srs.ts 단일 출처).
 *
 * 같은 묶음은 한 번만 반영한다. 서버가 반영했는데 응답이 닿기 전에 앱이 닫히면 클라이언트는 그 묶음을
 * 다시 보낸다. 요청에 묶음 id 가 있으면 반영과 같은 트랜잭션에서 기록해 두고, 다시 오면 반영하지 않는다.
 * id 가 없는 요청(예전 화면)은 그대로 반영한다.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const practice = (body as { practice?: unknown })?.practice === true;
  const grades = parseGrades((body as { grades?: unknown })?.grades);
  if (grades.length === 0) return NextResponse.json({ ok: true, applied: 0 });

  const sql = db();
  let key = receiptKey((body as { batchId?: unknown })?.batchId, practice, grades);
  if (key) {
    try {
      const seen = (await sql.query(`select 1 from grade_batches where id = $1`, [key])) as unknown[];
      // 이미 반영한 요청이다. 클라이언트가 지난번 응답을 받지 못해 다시 보냈다.
      if (seen.length > 0) return NextResponse.json({ ok: true, applied: 0, duplicate: true });
    } catch (err) {
      // 표가 아직 없는 DB(스키마보다 코드가 먼저 올라간 경우)에서는 예전처럼 그대로 반영한다.
      if (pgCode(err) !== "42P01") throw err;
      key = null;
    }
  }

  const ids = [...new Set(grades.map((g) => g.wordId))];
  const rows = await fetchSrsStates(ids);
  const known = new Set(rows.map((r) => r.id));
  const states = new Map<string, SrsState>(
    rows.map((r) => [
      r.id,
      {
        stage: r.stage,
        correct_count: r.correct_count,
        wrong_count: r.wrong_count,
        streak: r.streak,
        last_wrong_type: r.last_wrong_type,
      },
    ]),
  );

  const { today } = await getSettingsAndToday();
  // 삭제된 단어의 채점은 버린다(리뷰 로그 FK 위반 방지).
  const plan = planGrades(
    states,
    grades.filter((g) => known.has(g.wordId)),
    today,
    practice,
  );
  if (plan.length === 0) return NextResponse.json({ ok: true, applied: 0 });

  const queries = [];

  if (key) {
    // 채점과 한 트랜잭션에 넣는다. 반영이 실패하면 이 기록도 함께 취소되어, 다시 보냈을 때 반영된다.
    // 따로 먼저 적어 두면 반영에 실패한 묶음이 「이미 받았다」로 건너뛰어져 채점이 사라진다.
    queries.push(sql.query(`insert into grade_batches (id) values ($1)`, [key]));
    queries.push(
      sql.query(`delete from grade_batches where applied_at < now() - make_interval(days => $1)`, [
        RECEIPT_DAYS,
      ]),
    );
  }

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
      // 연습 퀴즈: 오답 기록만 남기고 복습 주기(stage / next_review)는 손대지 않는다.
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

  const logParams: unknown[] = [];
  const logRows = plan.map((item, i) => {
    const base = i * 5;
    logParams.push(
      item.wordId,
      item.log.promptType,
      item.log.correct,
      item.log.retry,
      item.log.practice,
    );
    return `($${base + 1}::uuid, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });
  queries.push(
    sql.query(
      `insert into reviews (word_id, prompt_type, correct, in_session_retry, practice)
       values ${logRows.join(", ")}`,
      logParams,
    ),
  );

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
}
