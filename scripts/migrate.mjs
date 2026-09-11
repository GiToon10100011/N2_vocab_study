/**
 * db/schema.sql 을 Neon 에 적용한다. 멱등하므로 몇 번 돌려도 안전하다.
 *   npm run db:migrate
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 이 없습니다. .env.local 을 확인하세요.");
  process.exit(1);
}
const sql = neon(url);

// HTTP 드라이버는 한 번에 한 문장만 받는다. 주석을 제거하고 문장 단위로 쪼갠다.
const statements = readFileSync("db/schema.sql", "utf8")
  .split("\n")
  .map((line) => (line.trim().startsWith("--") ? "" : line))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`applying ${statements.length} statements`);
for (const stmt of statements) {
  await sql.query(stmt);
  console.log("  ok  " + stmt.replace(/\s+/g, " ").slice(0, 70));
}

const tables = await sql.query(
  `select table_name from information_schema.tables
    where table_schema = 'public' order by table_name`,
);
console.log("\ntables:", tables.map((t) => t.table_name).join(", "));
