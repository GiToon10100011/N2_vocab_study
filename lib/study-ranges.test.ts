import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MISTAKE_SOURCES } from "./mistakes";
import {
  STUDY_RANGE_MAX,
  draftStudyRange,
  validateStudyRange,
  type StudyRange,
} from "./study-ranges";

const schema = readFileSync("db/schema.sql", "utf8");

describe("validateStudyRange", () => {
  it("시작과 끝 번호를 정수로 읽는다", () => {
    expect(validateStudyRange({ source: "master1500", from: "11", to: "20" })).toEqual({
      ok: true,
      value: { source: "master1500", from_no: 11, to_no: 20 },
    });
  });

  it("한 문항만 풀었으면 시작과 끝이 같다", () => {
    expect(validateStudyRange({ source: "grammar", from: "7", to: "7" })).toMatchObject({
      ok: true,
      value: { from_no: 7, to_no: 7 },
    });
  });

  it("앞뒤 공백과 전각 숫자를 받아들인다", () => {
    expect(validateStudyRange({ source: "reading", from: " １２ ", to: 15 })).toMatchObject({
      ok: true,
      value: { from_no: 12, to_no: 15 },
    });
  });

  it("번호가 아니거나 범위 밖이면 거부한다", () => {
    for (const bad of ["", "abc", "0", "-3", "4.5", "12a", String(STUDY_RANGE_MAX + 1)]) {
      expect(validateStudyRange({ source: "master1500", from: bad, to: "20" }), bad).toEqual({
        ok: false,
        reason: "number",
      });
      expect(validateStudyRange({ source: "master1500", from: "1", to: bad }), bad).toEqual({
        ok: false,
        reason: "number",
      });
    }
    expect(
      validateStudyRange({ source: "master1500", from: "1", to: String(STUDY_RANGE_MAX) }).ok,
    ).toBe(true);
  });

  it("끝 번호가 시작 번호보다 앞이면 거부한다", () => {
    expect(validateStudyRange({ source: "master1500", from: "20", to: "11" })).toEqual({
      ok: false,
      reason: "order",
    });
  });

  it("3종 밖의 교재를 거부한다", () => {
    expect(validateStudyRange({ source: "vocab", from: "1", to: "2" })).toEqual({
      ok: false,
      reason: "source",
    });
  });
});

describe("DB 제약과의 일치", () => {
  it("교재는 오답 기록과 같은 3종이다", () => {
    const body = /constraint study_ranges_source_valid\s+check \(source in \(([^)]+)\)\)/.exec(schema);
    expect([...(body?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([
      ...MISTAKE_SOURCES,
    ]);
  });

  it("번호 상한이 같다", () => {
    const body = /constraint study_ranges_numbers\s+check \(([^)]+)\)/.exec(schema);
    expect(body?.[1]).toBe(`from_no >= 1 and to_no >= from_no and to_no <= ${STUDY_RANGE_MAX}`);
  });
});

describe("draftStudyRange", () => {
  const ranges: StudyRange[] = [
    { source: "master1500", study_day: "2026-01-03", from_no: 21, to_no: 30 },
    { source: "master1500", study_day: "2026-01-02", from_no: 11, to_no: 20 },
    { source: "grammar", study_day: "2026-01-03", from_no: 3, to_no: 7 },
  ];

  it("그날 저장한 범위가 있으면 그것을 넣어 고쳐 쓰게 한다", () => {
    expect(draftStudyRange(ranges, "master1500", "2026-01-02")).toEqual({ from: "11", to: "20" });
  });

  it("없으면 그 교재에서 직전에 푼 범위의 다음 번호에서 시작한다", () => {
    expect(draftStudyRange(ranges, "master1500", "2026-01-04")).toEqual({ from: "31", to: "" });
    expect(draftStudyRange(ranges, "grammar", "2026-01-04")).toEqual({ from: "8", to: "" });
  });

  it("그날보다 뒤에 푼 범위는 보지 않는다", () => {
    expect(draftStudyRange(ranges, "master1500", "2026-01-01")).toEqual({ from: "", to: "" });
  });

  it("그 교재를 푼 적이 없으면 비워 둔다", () => {
    expect(draftStudyRange(ranges, "reading", "2026-01-04")).toEqual({ from: "", to: "" });
    expect(draftStudyRange([], "master1500", "2026-01-04")).toEqual({ from: "", to: "" });
  });
});
