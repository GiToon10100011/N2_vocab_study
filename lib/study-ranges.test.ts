import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MISTAKE_SOURCES } from "./mistakes";
import {
  RANGE_SKIPPED_TEXT,
  STUDY_RANGE_MAX,
  draftStudyRange,
  planFormSave,
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

describe("저장 버튼 하나 — 오답과 범위 중 무엇을 저장하는가", () => {
  // 핸드오프의 표 네 줄. 오답이 채워졌는지(mistakeBlank)와 범위 칸 둘로 정한다.
  it("오답이 채워지고 범위가 둘 다 채워지면 둘 다 저장한다", () => {
    expect(planFormSave({ mistakeBlank: false, from: "11", to: "20" })).toEqual({
      mistake: true,
      range: true,
      rangeSkipped: null,
    });
  });

  it("오답이 채워지고 끝 번호가 비었으면 오답만 저장하고 이유를 알린다 — 막지 않는다", () => {
    // 풀면서 하나씩 적을 때 모르는 끝 번호로 범위를 덮어쓰지 않으려는 것이다.
    expect(planFormSave({ mistakeBlank: false, from: "11", to: "" })).toEqual({
      mistake: true,
      range: false,
      rangeSkipped: "no-end",
    });
    expect(RANGE_SKIPPED_TEXT["no-end"]).toBe("범위는 저장하지 않았습니다 (끝 번호 없음)");
  });

  it("오답이 비고 범위가 둘 다 채워지면 범위만 저장한다 (오답이 없는 날)", () => {
    expect(planFormSave({ mistakeBlank: true, from: "11", to: "20" })).toEqual({
      mistake: false,
      range: true,
      rangeSkipped: null,
    });
  });

  it("오답도 범위도 비었으면 아무것도 저장하지 않는다 — 오답 저장의 빈 칸 처리로 넘긴다", () => {
    // mistake: true 는 저장한다는 뜻이 아니라, 오늘의 오답 저장이 하던 대로 검증해 안내를 띄우라는 뜻이다.
    expect(planFormSave({ mistakeBlank: true, from: "", to: "" })).toEqual({
      mistake: true,
      range: false,
      rangeSkipped: null,
    });
  });

  // 표가 말하지 않은 사이의 경우
  it("오답이 채워지고 범위 칸이 둘 다 비었으면 오답만 저장하고 안내는 하지 않는다", () => {
    expect(planFormSave({ mistakeBlank: false, from: "", to: "" })).toEqual({
      mistake: true,
      range: false,
      rangeSkipped: null,
    });
  });

  it("오답이 채워지고 시작 번호만 비었으면 오답만 저장하고 이유를 알린다", () => {
    expect(planFormSave({ mistakeBlank: false, from: "", to: "20" })).toEqual({
      mistake: true,
      range: false,
      rangeSkipped: "no-start",
    });
  });

  it("오답이 비고 범위가 한쪽만 채워졌으면 범위를 저장하려는 것이므로 범위 검증이 안내하게 한다", () => {
    for (const [from, to] of [["11", ""], ["", "20"]]) {
      expect(planFormSave({ mistakeBlank: true, from, to })).toEqual({
        mistake: false,
        range: true,
        rangeSkipped: null,
      });
    }
  });

  it("공백만 있는 칸은 빈 칸이다", () => {
    expect(planFormSave({ mistakeBlank: false, from: "11", to: "  " })).toMatchObject({
      range: false,
      rangeSkipped: "no-end",
    });
    expect(planFormSave({ mistakeBlank: true, from: " ", to: " " })).toMatchObject({
      mistake: true,
      range: false,
    });
  });
});
