/**
 * db/schema.sql 을 적용한다. 멱등하므로 몇 번 돌려도 안전하다.
 *   npm run db:migrate          운영 DB
 *   npm run db:migrate -- --all  운영 DB + E2E 격리 DB(n2v_e2e)
 *
 * 스키마를 바꿨으면 --all 로 돌린다. E2E 는 별도 데이터베이스를 쓰므로
 * 한쪽만 갱신하면 브라우저 테스트가 통째로 깨진다.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 이 없습니다. .env.local 을 확인하세요.");
  process.exit(1);
}
// HTTP 드라이버는 한 번에 한 문장만 받는다. 주석을 제거하고 문장 단위로 쪼갠다.
const statements = readFileSync("db/schema.sql", "utf8")
  .split("\n")
  .map((line) => (line.trim().startsWith("--") ? "" : line))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

const targets = [["운영", url]];
if (process.argv.includes("--all")) {
  const e2e = url.replace(/\/neondb(\?|$)/, "/n2v_e2e$1");
  if (e2e !== url) targets.push(["E2E", e2e]);
}

for (const [label, target] of targets) {
  const sql = neon(target);
  console.log(`\n[${label}] ${statements.length}개 문장 적용`);
  for (const stmt of statements) {
    await sql.query(stmt);
  }
  const tables = await sql.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`,
  );
  console.log(`  ok  tables: ${tables.map((t) => t.table_name).join(", ")}`);
}
