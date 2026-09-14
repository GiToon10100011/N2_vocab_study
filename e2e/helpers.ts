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
  await sql().query(`truncate reviews, words restart identity cascade`);
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

export async function wordRow(surface: string) {
  const rows = (await sql().query(
    `select stage, to_char(next_review,'YYYY-MM-DD') as next_review,
            correct_count, wrong_count, streak, last_wrong_type
       from words where surface = $1`,
    [surface],
  )) as Record<string, unknown>[];
  return rows[0];
}
