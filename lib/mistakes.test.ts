import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MISTAKE_CATEGORIES,
  MISTAKE_REF_MAX,
  MISTAKE_SOURCES,
  MISTAKE_SOURCE_LABEL,
  MISTAKE_TEXT_MAX,
  validateMistake,
  type MistakeInput,
} from "./mistakes";

const base: MistakeInput = {
  source: "master1500",
  category: "개념 부족",
  ref: "19",
  question: "去年 / 去年に",
  chosen: "去年に",
  answer: "去年",
  why: "니를 붙이고 안 붙이는 게 쉼표 유무에 따라 다를 거라고 생각했다",
};

/** schema.sql 의 CHECK 제약에서 허용 값 목록을 뽑는다. */
function checkValues(constraint: string): string[] {
  const schema = readFileSync("db/schema.sql", "utf8");
  const body = new RegExp(`constraint ${constraint}\\s+check \\(\\w+ in \\(([^)]+)\\)\\)`).exec(schema);
  if (!body) throw new Error(`${constraint} 를 schema.sql 에서 찾지 못했습니다`);
  return [...body[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("고정 값", () => {
  it("분류는 7종이고 DB 제약과 순서까지 같다", () => {
    const names = MISTAKE_CATEGORIES.map((c) => c.name);
    expect(names).toHaveLength(7);
    expect(new Set(names).size).toBe(7);
    expect(names).toEqual(checkValues("mistakes_category_valid"));
  });

  it("출처는 3종이고 DB 제약과 같다", () => {
    expect([...MISTAKE_SOURCES]).toEqual(checkValues("mistakes_source_valid"));
    for (const s of MISTAKE_SOURCES) expect(MISTAKE_SOURCE_LABEL[s]).toBeTruthy();
  });

  it("분류마다 한 줄 설명이 있다", () => {
    for (const c of MISTAKE_CATEGORIES) {
      expect(c.when.trim(), c.name).not.toBe("");
      expect(c.when, c.name).not.toContain("\n");
    }
  });
});

describe("validateMistake", () => {
  it("다 채운 입력을 그대로 통과시킨다", () => {
    expect(validateMistake(base)).toEqual({ ok: true, value: base });
  });

  it("앞뒤 공백을 다듬고 빈 칸은 null 로 만든다", () => {
    const res = validateMistake({
      source: "grammar",
      category: "회상 실패",
      ref: "  Part A-3 ",
      question: "",
      chosen: "   ",
      answer: undefined,
      why: " 예외 1그룹이 생각 안 남 ",
    });
    expect(res).toEqual({
      ok: true,
      value: {
        source: "grammar",
        category: "회상 실패",
        ref: "Part A-3",
        question: null,
        chosen: null,
        answer: null,
        why: "예외 1그룹이 생각 안 남",
      },
    });
  });

  it("문항 번호와 분류만으로도 저장할 수 있다", () => {
    const res = validateMistake({ source: "reading", category: "해석 실패", ref: "12" });
    expect(res.ok).toBe(true);
  });

  it("7종 밖의 분류를 거부한다", () => {
    for (const category of ["", "개념부족", "기타", "개념 부족 ", "concept"]) {
      expect(validateMistake({ ...base, category }), category).toEqual({
        ok: false,
        reason: "category",
      });
    }
  });

  it("3종 밖의 출처를 거부한다", () => {
    for (const source of ["", "Master1500", "vocab"]) {
      expect(validateMistake({ ...base, source }), source).toEqual({
        ok: false,
        reason: "source",
      });
    }
  });

  it("내용이 하나도 없으면 거부한다", () => {
    const res = validateMistake({
      source: "master1500",
      category: "단순 실수",
      ref: " ",
      question: "",
      why: "\t",
    });
    expect(res).toEqual({ ok: false, reason: "empty" });
  });

  it("길이 상한을 넘으면 거부하고, 딱 상한이면 통과시킨다", () => {
    expect(validateMistake({ ...base, ref: "1".repeat(MISTAKE_REF_MAX) }).ok).toBe(true);
    expect(validateMistake({ ...base, ref: "1".repeat(MISTAKE_REF_MAX + 1) })).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(validateMistake({ ...base, why: "가".repeat(MISTAKE_TEXT_MAX) }).ok).toBe(true);
    expect(validateMistake({ ...base, question: "가".repeat(MISTAKE_TEXT_MAX + 1) })).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("문자열이 아닌 값이 와도 던지지 않는다", () => {
    // 서버 액션은 폼을 거치지 않은 POST 로도 호출된다.
    const hostile = { source: 1, category: null, ref: { a: 1 }, why: ["x"] } as unknown as MistakeInput;
    expect(validateMistake(hostile)).toEqual({ ok: false, reason: "source" });
    expect(validateMistake(null as unknown as MistakeInput)).toEqual({ ok: false, reason: "source" });
    expect(
      validateMistake({ ...base, ref: 12 as unknown as string, why: undefined, question: "q" }),
    ).toMatchObject({ ok: true, value: { ref: null, question: "q" } });
  });

  it("정해진 칸 밖의 값은 버린다", () => {
    const res = validateMistake({
      ...base,
      id: "999",
      resolved_at: "2026-01-01T00:00:00Z",
    } as MistakeInput);
    expect(res.ok && Object.keys(res.value).sort()).toEqual(
      ["answer", "category", "chosen", "question", "ref", "source", "why"].sort(),
    );
  });
});
