import { describe, expect, it } from "vitest";
import { diffSyllables, toSyllables } from "./syllable-diff";

describe("음절 나누기", () => {
  it("작은 ゃゅょ 는 앞 글자와 한 음절이다", () => {
    expect(toSyllables("ちゅうしょうてき")).toEqual(["ちゅ", "う", "しょ", "う", "て", "き"]);
  });

  it("っ · ー · ん 은 따로 한 음절이다", () => {
    expect(toSyllables("がっこう")).toEqual(["が", "っ", "こ", "う"]);
    expect(toSyllables("こーひー")).toEqual(["こ", "ー", "ひ", "ー"]);
    expect(toSyllables("しんぶん")).toEqual(["し", "ん", "ぶ", "ん"]);
  });
});

describe("음절 대조", () => {
  it("요음이 다른 곳을 음절로 짚는다", () => {
    expect(diffSyllables("ちゅうそうてき", "ちゅうしょうてき")).toEqual([
      { kind: "same", text: "ちゅう" },
      { kind: "diff", typed: "そ", expected: "しょ" },
      { kind: "same", text: "うてき" },
    ]);
  });

  it("빠진 촉음을 짚는다", () => {
    expect(diffSyllables("がこう", "がっこう")).toEqual([
      { kind: "same", text: "が" },
      { kind: "diff", typed: "", expected: "っ" },
      { kind: "same", text: "こう" },
    ]);
  });

  it("빠진 장음을 짚는다 (가운데와 끝)", () => {
    expect(diffSyllables("どぶつ", "どうぶつ")).toEqual([
      { kind: "same", text: "ど" },
      { kind: "diff", typed: "", expected: "う" },
      { kind: "same", text: "ぶつ" },
    ]);
    expect(diffSyllables("ふきゅ", "ふきゅう")).toEqual([
      { kind: "same", text: "ふきゅ" },
      { kind: "diff", typed: "", expected: "う" },
    ]);
  });

  it("같으면 한 덩어리다", () => {
    expect(diffSyllables("かんき", "かんき")).toEqual([{ kind: "same", text: "かんき" }]);
  });
});
