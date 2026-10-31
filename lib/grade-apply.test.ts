import { describe, expect, it } from "vitest";
import { receiptKey, receiptQueries, reviewInsertQuery, wordUpdateQueries } from "./grade-apply";
import type { GradePlanItem } from "./srs";

/** 문장을 실행하지 않고 받은 그대로 돌려주는 가짜 드라이버. */
const fakeSql = {
  query: (text: string, params: unknown[]) => ({ text, params }),
} as unknown as Parameters<typeof reviewInsertQuery>[0];

type Recorded = { text: string; params: unknown[] };
const rec = (q: unknown) => q as Recorded;

const G = [
  { wordId: "w-0123456789", kind: "s2r", correct: true, retry: false },
  { wordId: "w-9876543210", kind: "learn", correct: false, retry: true },
];
const payload = (practice: boolean) => [practice, G.map((g) => [g.wordId, g.kind, g.correct, g.retry])];

describe("영수증 열쇠", () => {
  it("채점 묶음의 열쇠는 이 파일로 옮기기 전과 같다 — 배포 순간 재전송 묶음이 두 번 반영되지 않게", () => {
    expect(receiptKey("batch-abc123", payload(false))).toBe(
      "batch-abc123:b0dce3a40c0fa4d4e70c6349982ef3dc",
    );
    expect(receiptKey("batch-abc123", payload(true))).toBe(
      "batch-abc123:180317579b0eb1721444e4fb73296725",
    );
  });

  it("묶음 id 모양이 아니면 열쇠가 없다 (예전 화면의 요청)", () => {
    for (const bad of ["short", "has space xx", 12345, undefined, "x".repeat(81)]) {
      expect(receiptKey(bad, payload(false))).toBeNull();
    }
  });

  it("테스트 답 묶음은 같은 id 라도 채점 묶음과 다른 열쇠다", () => {
    expect(receiptKey("batch-abc123", ["test", "2026-10-22", [["w-0123456789", "ちゅう"]]])).not.toBe(
      receiptKey("batch-abc123", payload(false)),
    );
  });

  it("영수증은 기록과 오래된 기록 정리 두 문장이다", () => {
    const [insert, cleanup] = receiptQueries(fakeSql, "k1").map(rec);
    expect(insert.text).toContain("insert into grade_batches");
    expect(insert.params).toEqual(["k1"]);
    expect(cleanup.text).toContain("delete from grade_batches");
    expect(cleanup.params).toEqual([180]);
  });
});

const counters = { correct_count: 3, wrong_count: 1, streak: 2, last_wrong_type: null };
const log = { promptType: "s2r" as const, correct: true, retry: false, practice: false };
const item = (over: Partial<GradePlanItem>): GradePlanItem => ({
  wordId: "w-0123456789",
  counters,
  schedule: null,
  log,
  ...over,
});

describe("리뷰 로그", () => {
  it("평소에는 다섯 열을 넣는다 (예전과 같다)", () => {
    const q = rec(reviewInsertQuery(fakeSql, [item({}), item({ wordId: "w-9876543210" })]));
    expect(q.text).toContain("(word_id, prompt_type, correct, in_session_retry, practice)");
    expect(q.text).not.toContain("test");
    expect(q.params).toHaveLength(10);
  });

  it("실전 테스트는 test 열을 더해 true 로 넣는다", () => {
    const q = rec(reviewInsertQuery(fakeSql, [item({})], { test: true }));
    expect(q.text).toContain("(word_id, prompt_type, correct, in_session_retry, practice, test)");
    expect(q.params).toEqual(["w-0123456789", "s2r", true, false, false, true]);
  });

  it("뜻 로그가 딸린 항목은 한 문장에 읽기 줄 다음 뜻 줄을 넣는다", () => {
    const meaning = { promptType: "s2m" as const, correct: false, retry: false, practice: false, test: true };
    const q = rec(
      reviewInsertQuery(
        fakeSql,
        [item({ log: { ...log, test: true }, extraLogs: [meaning] }), item({ wordId: "w-9876543210" })],
        { test: true },
      ),
    );
    expect(q.params).toEqual([
      "w-0123456789", "s2r", true, false, false, true,
      "w-0123456789", "s2m", false, false, false, true,
      "w-9876543210", "s2r", true, false, false, true,
    ]);
    // 값 자리표시는 줄마다 이어 붙는다: ($1..$6), ($7..$12), ($13..$18)
    expect(q.text).toContain("($13::uuid, $14, $15, $16, $17, $18)");
  });
});

describe("단어 갱신", () => {
  it("카운터가 없는 항목(학습 카드 · 재시도 · 가드)은 문장을 만들지 않는다", () => {
    expect(wordUpdateQueries(fakeSql, [item({ counters: null })])).toEqual([]);
  });

  it("주기가 있으면 stage · next_review 까지, 없으면 카운터만 바꾼다", () => {
    const [withSchedule, countersOnly] = wordUpdateQueries(fakeSql, [
      item({ schedule: { stage: 1, next_review: "2026-10-23" } }),
      item({ wordId: "w-9876543210" }),
    ]).map(rec);
    expect(withSchedule.text).toContain("set stage = $1, next_review = $2::date");
    expect(withSchedule.params).toEqual([1, "2026-10-23", 3, 1, 2, null, "w-0123456789"]);
    expect(countersOnly.text).not.toContain("stage");
    expect(countersOnly.params).toEqual([3, 1, 2, null, "w-9876543210"]);
  });
});
