/**
 * 전체 데이터를 CSV 로 덤프한다. GitHub Actions 가 매일 돌려 backups/ 에 커밋한다.
 *   node --env-file=.env.local scripts/backup.mjs [출력디렉터리]
 *
 * 컬럼 목록을 하드코딩하지 않고 information_schema 에서 읽는다.
 * 백업은 "손으로 관리하는 목록"이 아니라 "구조적으로 전부"여야 하기 때문이다.
 * 날짜/시각은 문자열로 고정해 출력이 바이트 단위로 안정적이다(= git diff 가 깨끗하다).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import Papa from "papaparse";

const outDir = process.argv[2] || "backups";
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 이 없습니다.");
  process.exit(1);
}
const sql = neon(url);

async function dump(table, orderBy) {
  const cols = await sql.query(
    `select column_name, data_type
       from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by ordinal_position`,
    [table],
  );
  if (cols.length === 0) throw new Error(`${table} 테이블이 없습니다.`);

  const select = cols
    .map(({ column_name: c, data_type: t }) => {
      if (t === "date") return `to_char("${c}", 'YYYY-MM-DD') as "${c}"`;
      if (t === "timestamp with time zone")
        return `to_char("${c}" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "${c}"`;
      return `"${c}"`;
    })
    .join(", ");

  const rows = await sql.query(`select ${select} from "${table}" order by ${orderBy}`);
  const header = cols.map((c) => c.column_name);
  const body = rows.length > 0 ? Papa.unparse(rows, { columns: header }) : header.join(",");
  writeFileSync(join(outDir, `${table}.csv`), "﻿" + body + "\n");
  return rows.length;
}

mkdirSync(outDir, { recursive: true });

const words = await dump("words", `created_at asc, id asc`);
const reviews = await dump("reviews", `id asc`);

writeFileSync(
  join(outDir, "meta.json"),
  JSON.stringify({ backed_up_at: new Date().toISOString(), words, reviews }, null, 2) + "\n",
);

console.log(`words ${words}행 · reviews ${reviews}행 -> ${outDir}/`);
