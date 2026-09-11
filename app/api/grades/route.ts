import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchSrsStates } from "@/lib/queries";
import { planGrades, studyDate } from "@/lib/srs";
import type { CardKind, GradeInput, SrsState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: CardKind[] = ["learn", "s2r", "s2m", "r2m"];
const MAX_BATCH = 500;

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
 * 채점 배치. 세션 중에는 낙관적으로 화면을 넘기고 여기로 5장씩 모아 보낸다.
 * SRS 계산은 서버에서만 한다(lib/srs.ts 단일 출처).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const grades = parseGrades((body as { grades?: unknown })?.grades);
  if (grades.length === 0) return NextResponse.json({ ok: true, applied: 0 });

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

  const today = studyDate();
  // 삭제된 단어의 채점은 버린다(리뷰 로그 FK 위반 방지).
  const plan = planGrades(
    states,
    grades.filter((g) => known.has(g.wordId)),
    today,
  );
  if (plan.length === 0) return NextResponse.json({ ok: true, applied: 0 });

  const sql = db();
  const queries = [];

  for (const item of plan) {
    if (!item.patch) continue;
    const p = item.patch;
    queries.push(
      sql.query(
        `update words
            set stage = $1, next_review = $2::date, correct_count = $3,
                wrong_count = $4, streak = $5, last_wrong_type = $6, last_reviewed = now()
          where id = $7`,
        [
          p.stage,
          p.next_review,
          p.correct_count,
          p.wrong_count,
          p.streak,
          p.last_wrong_type,
          item.wordId,
        ],
      ),
    );
  }

  const logParams: unknown[] = [];
  const logRows = plan.map((item, i) => {
    const base = i * 4;
    logParams.push(item.wordId, item.log.promptType, item.log.correct, item.log.retry);
    return `($${base + 1}::uuid, $${base + 2}, $${base + 3}, $${base + 4})`;
  });
  queries.push(
    sql.query(
      `insert into reviews (word_id, prompt_type, correct, in_session_retry)
       values ${logRows.join(", ")}`,
      logParams,
    ),
  );

  await sql.transaction(queries);
  return NextResponse.json({ ok: true, applied: plan.length });
}
