/**
 * 자동 백업 대상 테이블. scripts/backup.mjs 는 이 목록만 덤프한다.
 *
 * mistakes(오답 기록)는 의도적으로 없다. 빠뜨린 것이 아니다.
 * 이 저장소는 공개이고 backups/ 는 그대로 커밋되는데, 오답 기록에는 교재 문항 내용과
 * 개인 메모가 들어간다. 다시 넣지 말 것 — lib/backup.test.ts 가 막는다.
 *
 * study_ranges(풀이 범위)도 같은 이유로 없다. 공개 저장소에 새 종류의 기록을 올리지 않는다.
 *
 * typing_test_items(실전 테스트에서 친 답)도 없다. 테스트 정오는 reviews 의 test 열로 백업된다
 * — SRS 진도를 바꾸는 기록이라 복원에 필요하다.
 */
export const BACKUP_TABLES = [
  { table: "words", orderBy: "created_at asc, id asc" },
  { table: "reviews", orderBy: "id asc" },
];
