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
import { BACKUP_TABLES } from "./backup-tables.mjs";

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
  // 마지막 줄도 Papa.unparse 가 쓰는 CRLF 로 끝내야 한다. LF 로 끝내면 파서가 그 LF 를
  // 마지막 칸의 값으로 읽어서(study_day = "2026-09-22\n") 복원 때 날짜 캐스팅이 깨진다.
  writeFileSync(join(outDir, `${table}.csv`), "﻿" + body + "\r\n");
  return rows.length;
}

mkdirSync(outDir, { recursive: true });

// 대상 테이블은 backup-tables.mjs 의 목록뿐이다. 여기서 테이블 이름을 직접 적어 덤프하지 않는다.
const counts = {};
for (const { table, orderBy } of BACKUP_TABLES) {
  counts[table] = await dump(table, orderBy);
}

writeFileSync(
  join(outDir, "meta.json"),
  JSON.stringify({ backed_up_at: new Date().toISOString(), ...counts }, null, 2) + "\n",
);

// 앱이 "마지막 백업" 을 보고 경고할 수 있도록 심장박동을 남긴다.
await sql.query(`update settings set last_backup_at = now() where id = 1`);

const summary = Object.entries(counts)
  .map(([table, n]) => `${table} ${n}행`)
  .join(" · ");
console.log(`${summary} -> ${outDir}/`);
