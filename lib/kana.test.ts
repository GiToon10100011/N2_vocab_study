import { describe, expect, it } from "vitest";
import {
  hasNonKana,
  isAllKana,
  normalizeReading,
  pushRomajiKey,
  readingFromRomaji,
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


/** 물리 키 코드 열로 실제 타이핑을 흉내낸다. */
function type(keys: string): string {
  return keys.split(" ").reduce(pushRomajiKey, "");
}

describe("키 입력으로 읽기 추정", () => {
  it("눌린 물리 키를 로마자로 모은다", () => {
    expect(type("KeyF KeyU KeyK KeyY KeyU KeyU")).toBe("fukyuu");
    expect(type("KeyK KeyY KeyO KeyU KeyR KeyY KeyO KeyK KeyU")).toBe("kyouryoku");
  });

  it("변환/이동 키는 버린다 (라이브 변환이 끼어들어도 로마자는 온전하다)", () => {
    expect(type("KeyF KeyU KeyK KeyY KeyU KeyU Space Enter")).toBe("fukyuu");
    expect(type("KeyF KeyU Space KeyK KeyY KeyU KeyU ArrowLeft Enter")).toBe("fukyuu");
  });

  it("백스페이스는 되돌린다", () => {
    expect(type("KeyF KeyU KeyX Backspace KeyK KeyY KeyU KeyU")).toBe("fukyuu");
  });

  it("모아둔 로마자를 가나로 확정한다", () => {
    expect(readingFromRomaji("fukyuu", "普及")).toBe("ふきゅう");
    expect(readingFromRomaji("kyouryoku", "協力")).toBe("きょうりょく");
    expect(readingFromRomaji("torikumu", "取り組む")).toBe("とりくむ");
    expect(readingFromRomaji("toiawaseru", "問い合わせる")).toBe("といあわせる");
  });

  it("가나로 확정된 단어는 제안하지 않는다", () => {
    expect(readingFromRomaji("kikkake", "きっかけ")).toBeNull();
    expect(readingFromRomaji("baransu", "バランス")).toBeNull();
  });

  it("키를 놓쳐 자음으로 끝나면 제안하지 않는다 (어설픈 추정보다 빈 칸이 낫다)", () => {
    expect(readingFromRomaji("fukyuk", "普及")).toBeNull();
    expect(readingFromRomaji("", "普及")).toBeNull();
  });
});
