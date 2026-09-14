import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
  if (m && !line.trim().startsWith("#")) process.env[m[1]] = m[2];
}
// 부하 테스트는 운영과 분리된 Neon 브랜치에서 돌린다.
process.env.DATABASE_URL = readFileSync("/tmp/loadtest_url", "utf8").trim();
if (!process.env.DATABASE_URL.startsWith("postgresql://")) {
  throw new Error("부하 테스트 브랜치 연결 문자열이 없습니다.");
}
