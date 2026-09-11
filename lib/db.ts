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
