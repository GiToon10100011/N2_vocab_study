import { describe, expect, it } from "vitest";
import { isMissingSchema, pgCode } from "./db";

describe("Postgres 오류 코드", () => {
  it("오류 객체의 code 를 꺼낸다", () => {
    expect(pgCode({ code: "42P01" })).toBe("42P01");
    expect(pgCode(null)).toBeUndefined();
    expect(pgCode("x")).toBeUndefined();
  });

  it("표나 열이 아직 없는 DB 를 알아본다 (스키마보다 코드가 먼저 올라간 경우)", () => {
    expect(isMissingSchema({ code: "42P01" })).toBe(true); // undefined_table
    expect(isMissingSchema({ code: "42703" })).toBe(true); // undefined_column
    expect(isMissingSchema({ code: "23505" })).toBe(false);
    expect(isMissingSchema(new Error("x"))).toBe(false);
  });
});
