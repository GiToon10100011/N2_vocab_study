import { describe, expect, it } from "vitest";
import { isSubmitKey } from "./keys";

const key = (over: Partial<Parameters<typeof isSubmitKey>[0]> = {}) => ({
  key: "Enter",
  isComposing: false,
  keyCode: 13,
  repeat: false,
  ...over,
});

describe("제출 · 다음으로 칠 Enter", () => {
  it("평범한 Enter 는 제출이다", () => {
    expect(isSubmitKey(key(), false)).toBe(true);
  });

  it("IME 조합 중의 Enter 는 제출이 아니다", () => {
    expect(isSubmitKey(key({ isComposing: true }), false)).toBe(false);
  });

  it("조합 중이라는 표시가 남아 있으면 제출이 아니다", () => {
    expect(isSubmitKey(key(), true)).toBe(false);
  });

  it("Safari 가 compositionend 뒤에 보내는 확정 Enter(keyCode 229)는 제출이 아니다", () => {
    expect(isSubmitKey(key({ keyCode: 229 }), false)).toBe(false);
  });

  it("꾹 눌러 반복되는 Enter 는 제출이 아니다 — 정답 대조를 보지 못하고 넘어가지 않게", () => {
    expect(isSubmitKey(key({ repeat: true }), false)).toBe(false);
  });

  it("다른 키는 제출이 아니다", () => {
    expect(isSubmitKey(key({ key: "a" }), false)).toBe(false);
  });
});
