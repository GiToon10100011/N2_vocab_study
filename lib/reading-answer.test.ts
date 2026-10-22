import { describe, expect, it } from "vitest";
import { checkAnswer, convertAnswer, judgeReading } from "./reading-answer";

describe("입력을 가나로 확정한다", () => {
  it("로마자 - 는 ー 가 된다", () => {
    expect(convertAnswer("chu-shoteki")).toBe("ちゅーしょてき");
  });

  it("가타카나는 히라가나로 바꾸되 ー 는 남긴다 (장음 오류를 정답으로 만들지 않는다)", () => {
    expect(convertAnswer("チューショーテキ")).toBe("ちゅーしょーてき");
    expect(convertAnswer("チューショーテキ")).not.toBe("ちゅうしょうてき");
  });

  it("반각 가타카나와 전각 대문자 로마자도 같은 가나가 된다", () => {
    expect(convertAnswer("ﾁｭｳｼｮｳﾃｷ")).toBe("ちゅうしょうてき");
    expect(convertAnswer("ＣＨＵＵ")).toBe("ちゅう");
  });

  it("공백을 지운다", () => {
    expect(convertAnswer(" chuu shou ")).toBe("ちゅうしょう");
  });

  it("IME 관례 nn 을 ん 하나로 읽는다", () => {
    expect(convertAnswer("shinbunn")).toBe("しんぶん");
    expect(convertAnswer("annai")).toBe("あんない");
  });

  it("촉음과 ヴ 도 바꾼다", () => {
    expect(convertAnswer("gakkou")).toBe("がっこう");
    expect(convertAnswer("ヴァイオリン")).toBe("ゔぁいおりん");
  });

  it("두 번 바꿔도 같다 — 서버가 확정된 가나를 다시 판정한다", () => {
    for (const s of ["chu-shoteki", "チューショー", "ﾁｭｳ", "shinbunn", "desu."]) {
      expect(convertAnswer(convertAnswer(s))).toBe(convertAnswer(s));
    }
  });
});

describe("채점할 수 있는 입력인가", () => {
  it("가나로 확정되면 그 가나를 준다", () => {
    expect(checkAnswer("chuusouteki")).toEqual({ ok: true, kana: "ちゅうそうてき" });
  });

  it("빈 입력은 채점하지 않는다", () => {
    expect(checkAnswer("  ")).toEqual({ ok: false, reason: "empty" });
  });

  it("한자가 섞이거나 로마자 · 기호가 남으면 채점하지 않는다", () => {
    for (const s of ["抽象的", "ちゅう抽", "ch", "desu."]) {
      expect(checkAnswer(s)).toEqual({ ok: false, reason: "not-kana" });
    }
  });
});

describe("읽기 판정", () => {
  const W = { surface: "抽象的", reading: "ちゅうしょうてき" };

  it("로마자 · 가타카나로 친 정답을 맞힌 것으로 본다", () => {
    expect(judgeReading("chuushouteki", W).result).toBe("correct");
    expect(judgeReading("チュウショウテキ", W).result).toBe("correct");
  });

  it("한 글자라도 다르면 틀린 것이고, 친 가나를 돌려준다", () => {
    expect(judgeReading("chuusouteki", W)).toMatchObject({ result: "wrong", kana: "ちゅうそうてき" });
    expect(judgeReading("ちゅしょうてき", W).result).toBe("wrong");
  });

  it("장음을 ー 로 친 답은 틀린 것이다", () => {
    expect(judgeReading("チューショーテキ", W).result).toBe("wrong");
  });

  it("채점할 수 없는 입력은 판정하지 않는다", () => {
    expect(judgeReading("", W)).toEqual({ result: "invalid", reason: "empty" });
    expect(judgeReading("抽象的", W)).toEqual({ result: "invalid", reason: "not-kana" });
  });

  it("표기와 읽기가 둘 다 だ 로 끝나면 입력의 だ 는 있든 없든 맞힌 것이다", () => {
    const D = { surface: "哀れだ", reading: "あわれだ" };
    expect(judgeReading("aware", D).result).toBe("correct");
    expect(judgeReading("awareda", D).result).toBe("correct");
    expect(judgeReading("awaredaa", D).result).toBe("wrong");
    expect(judgeReading("aware", D)).toMatchObject({ compare: { typed: "あわれ", expected: "あわれ" } });
  });

  it("표기가 だ 로 끝나지 않으면 だ 를 덧붙인 답은 틀린 것이다", () => {
    expect(judgeReading("ゆうめいだ", { surface: "有名", reading: "ゆうめい" }).result).toBe("wrong");
  });

  it("정답 읽기도 같은 변환을 거친다 (가타카나로 저장된 읽기)", () => {
    expect(judgeReading("こーひー", { surface: "珈琲", reading: "コーヒー" }).result).toBe("correct");
  });
});
