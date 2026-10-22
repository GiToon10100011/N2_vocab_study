import { NextResponse } from "next/server";
import { db, pgCode } from "@/lib/db";
import {
  receiptKey,
  receiptQueries,
  reviewInsertQuery,
  wordUpdateQueries,
} from "@/lib/grade-apply";
import { fetchSrsStates, fetchTestWrongToday } from "@/lib/queries";
import { planGrades } from "@/lib/srs";
import { getSettingsAndToday } from "@/lib/settings";
import type { CardKind, GradeInput, SrsState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: CardKind[] = ["learn", "s2r", "s2m", "r2m"];
const MAX_BATCH = 500;

/** 이 요청의 채점 내용. 열쇠가 이 모양에 의존하므로 바꾸면 안 된다(lib/grade-apply.test.ts 가 고정한다). */
const payloadOf = (practice: boolean, grades: GradeInput[]) => [
  practice,
  grades.map((g) => [g.wordId, g.kind, g.correct, g.retry]),
];

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
  let key = receiptKey((body as { batchId?: unknown })?.batchId, payloadOf(practice, grades));
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

  const { settings, today } = await getSettingsAndToday();
  // 그날 실전 테스트에서 틀린 단어는 이 카드 채점으로 주기를 다시 올리지 않는다(로그만 남긴다).
  // 연습 퀴즈는 원래 주기를 바꾸지 않으므로 묻지 않는다.
  const testWrongToday = practice
    ? new Set<string>()
    : await fetchTestWrongToday(ids, today, settings.dayStartHour);
  // 삭제된 단어의 채점은 버린다(리뷰 로그 FK 위반 방지).
  const plan = planGrades(
    states,
    grades.filter((g) => known.has(g.wordId)),
    today,
    practice,
    testWrongToday,
  );
  if (plan.length === 0) return NextResponse.json({ ok: true, applied: 0 });

  // 영수증은 채점과 한 트랜잭션에 넣는다(lib/grade-apply.ts).
  const queries = [
    ...(key ? receiptQueries(sql, key) : []),
    ...wordUpdateQueries(sql, plan),
    reviewInsertQuery(sql, plan),
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
}
