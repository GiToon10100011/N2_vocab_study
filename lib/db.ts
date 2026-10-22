import { neon } from "@neondatabase/serverless";

type Sql = ReturnType<typeof neon>;

let client: Sql | undefined;

/**
 * Neon HTTP 드라이버. DATABASE_URL 은 서버에서만 읽으며 클라이언트 번들로 나가지 않는다.
 * 빌드 타임에 터지지 않도록 지연 초기화한다.
 */
export function db(): Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL 이 없습니다. .env.example 을 참고해 .env.local 을 만드세요.",
      );
    }
    client = neon(url);
  }
  return client;
}

/** Postgres 오류 코드. 드라이버 오류 객체의 code 를 꺼낸다. */
export function pgCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * 표(42P01)나 열(42703)이 아직 없는 DB 인가. 스키마보다 코드가 먼저 올라간 동안
 * 새 기능만 조용히 빠지고 기존 화면은 죽지 않게 할 때 쓴다.
 */
export function isMissingSchema(err: unknown): boolean {
  const code = pgCode(err);
  return code === "42P01" || code === "42703";
}
