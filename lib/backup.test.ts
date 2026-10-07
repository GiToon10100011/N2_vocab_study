import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BACKUP_TABLES } from "../scripts/backup-tables.mjs";

/**
 * 오답 기록(mistakes)은 자동 백업에 넣지 않는다. 빠뜨린 것이 아니다.
 * 저장소가 공개이고 backups/ 가 그대로 커밋되는데, 오답 기록에는 교재 문항 내용과
 * 개인 메모가 들어간다. 이 테스트가 깨졌다면 빠진 백업을 채운 것이 아니라
 * 공개 저장소로 새는 길을 연 것이다.
 */
describe("자동 백업 대상", () => {
  it("테이블 목록에 mistakes 가 없다", () => {
    const tables = BACKUP_TABLES.map((t) => t.table);
    expect(tables).toContain("words"); // 빈 목록을 읽고 통과하는 일이 없게
    expect(tables).not.toContain("mistakes");
  });

  it("목록 밖의 테이블을 따로 덤프하지 않고, 파일이 생겨도 커밋되지 않는다", () => {
    const script = readFileSync("scripts/backup.mjs", "utf8");
    expect(script).toContain("of BACKUP_TABLES");
    expect(script).not.toMatch(/dump\(\s*["'`]/); // 테이블 이름을 직접 적은 호출

    const ignored = readFileSync(".gitignore", "utf8").split("\n").map((l) => l.trim());
    expect(ignored).toContain("backups/mistakes.csv");

    expect(readFileSync(".github/workflows/backup.yml", "utf8")).not.toContain("mistakes");
  });
});
