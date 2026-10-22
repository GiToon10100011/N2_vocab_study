import { createHmac } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { BrowserContext } from "@playwright/test";

/**
 * E2E 는 격리된 데이터베이스(n2v_e2e)에서 돌아가므로 실제 어휘를 그대로 쓴다.
 * 오히려 ＺＺ 같은 접두사는 가나가 아니라서 읽기 검증에 걸려 실제 동작과 달라진다.
 * (통합 테스트 lib/*.itest.ts 는 실제 DB 를 쓰므로 여전히 ＺＺ 네임스페이스가 필요하다)
 */
export const MARK = "__e2e__";

export function sql() {
  const url = process.env.DATABASE_URL!;
  // 실수로 실제 DB 를 가리키면 즉시 멈춘다. 세션 테스트는 카드를 채점하므로
  // 진짜 단어의 복습 주기를 망가뜨릴 수 있다.
  if (!url.includes("/n2v_e2e")) {
    throw new Error("E2E 는 격리 데이터베이스(n2v_e2e)에서만 돌린다. 현재 대상이 다릅니다.");
  }
  return neon(url);
}

/** 격리 DB 를 통째로 비운다. 실제 데이터가 아니므로 안전하다. */
export async function resetDb() {
  await sql().query(
    `truncate reviews, words, mistakes, grade_batches, study_ranges, typing_test_items
       restart identity cascade`,
  );
}

/** 비밀번호 화면을 매번 통과하지 않도록 서명 쿠키를 직접 발급한다. */
export async function authenticate(context: BrowserContext, baseURL: string) {
  const exp = String(Date.now() + 86_400_000);
  const sig = createHmac("sha256", process.env.SESSION_SECRET!)
    .update(exp)
    .digest("base64url");
  await context.addCookies([
    {
      name: "n2v_session",
      value: `${exp}.${sig}`,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

export async function seed(
  rows: { surface: string; reading: string; meaning: string }[],
  studyDay: string,
) {
  for (const r of rows) {
    await sql().query(
      `insert into words (surface, reading, meaning_ko, note, study_day)
       values ($1, $2, $3, $4, $5::date)
       on conflict (surface, reading) do update set meaning_ko = excluded.meaning_ko`,
      [r.surface, r.reading, r.meaning, MARK, studyDay],
    );
  }
}

/** n일 전의 학습일 'YYYY-MM-DD' (04:00 경계, Asia/Seoul). */
export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000 - 4 * 3600_000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Seoul",
  });
}

/**
 * 실전 테스트 대상이 되는 단어를 심는다: 이미 학습했고(stage 3, 한 달 뒤 복습) 첫 리뷰 로그가 3일 전이다.
 * 오늘 처음 배운 단어는 테스트에서 빠지므로 로그 날짜가 오늘이면 안 된다.
 */
export async function seedTestable(
  rows: { surface: string; reading: string; meaning: string }[],
): Promise<void> {
  await seed(rows, daysAgo(10));
  await sql().query(
    `update words set stage = 3, next_review = current_date + 30 where note = $1`,
    [MARK],
  );
  await sql().query(
    `insert into reviews (word_id, prompt_type, correct, reviewed_at)
     select id, 'learn', true, now() - interval '3 days' from words where note = $1`,
    [MARK],
  );
}

export async function wordRow(surface: string) {
  const rows = (await sql().query(
    `select stage, to_char(next_review,'YYYY-MM-DD') as next_review,
            correct_count, wrong_count, streak, last_wrong_type
       from words where surface = $1`,
    [surface],
  )) as Record<string, unknown>[];
  return rows[0];
}
