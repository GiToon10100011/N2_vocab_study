import { describe, expect, it } from "vitest";
import {
  composedReading,
  hasNonKana,
  isAllKana,
  normalizeReading,
  toKatakanaReading,
} from "./kana";

describe("읽기 확정 변환", () => {
  it("로마자를 통째로 변환한다 (부분 변환으로 끝이 잘리지 않는다)", () => {
    expect(normalizeReading("fukyuu")).toBe("ふきゅう");
    expect(normalizeReading("kyouryoku")).toBe("きょうりょく");
    expect(normalizeReading("toiawaseru")).toBe("といあわせる");
    expect(normalizeReading("shinbun")).toBe("しんぶん");
    expect(normalizeReading("kitte")).toBe("きって");
    expect(normalizeReading("hakki")).toBe("はっき");
  });

  it("대문자가 섞여도 가타카나로 새지 않는다", () => {
    expect(normalizeReading("KYOURYOKU")).toBe("きょうりょく");
    expect(normalizeReading("Fukyuu")).toBe("ふきゅう");
    expect(normalizeReading("fuKYUu")).toBe("ふきゅう");
  });

  it("이미 가나면 그대로 둔다 (카타카나 단어를 뭉개지 않는다)", () => {
    expect(normalizeReading("バランス")).toBe("バランス");
    expect(normalizeReading("アレンジ")).toBe("アレンジ");
    expect(normalizeReading("きっかけ")).toBe("きっかけ");
    expect(normalizeReading("コーヒー")).toBe("コーヒー");
  });

  it("공백을 지우고 앞뒤를 다듬는다", () => {
    expect(normalizeReading("  fukyuu  ")).toBe("ふきゅう");
    expect(normalizeReading("kyou ryoku")).toBe("きょうりょく");
    expect(normalizeReading("")).toBe("");
  });

  it("가타카나 변환 버튼", () => {
    expect(toKatakanaReading("baransu")).toBe("バランス");
    expect(toKatakanaReading("ばらんす")).toBe("バランス");
  });

  it("가나 판정", () => {
    expect(isAllKana("ふきゅう")).toBe(true);
    expect(isAllKana("バランス")).toBe(true);
    expect(isAllKana("コーヒー")).toBe(true);
    expect(isAllKana("ふきゅu")).toBe(false);
    expect(isAllKana("普及")).toBe(false);
    expect(hasNonKana("ふきゅu")).toBe(true);
    expect(hasNonKana("ふきゅう")).toBe(false);
  });
});

describe("IME 조합에서 읽기 추정", () => {
  it("한자로 확정되면 변환 전 가나를 제안한다", () => {
    expect(composedReading("ふきゅう", "普及")).toBe("ふきゅう");
    expect(composedReading("きょうりょく", "協力")).toBe("きょうりょく");
    expect(composedReading("とりくむ", "取り組む")).toBe("とりくむ");
    expect(composedReading("といあわせる", "問い合わせる")).toBe("といあわせる");
  });

  it("가나로 확정되면 제안하지 않는다 (표기 == 읽기라서 불필요)", () => {
    expect(composedReading("きっかけ", "きっかけ")).toBeNull();
    expect(composedReading("バランス", "バランス")).toBeNull();
  });

  it("가나를 못 잡았으면 제안하지 않는다", () => {
    expect(composedReading("", "普及")).toBeNull();
    expect(composedReading("fukyuu", "普及")).toBeNull();
  });
});
