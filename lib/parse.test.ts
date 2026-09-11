import { describe, expect, it } from "vitest";
import { parsePasted } from "./parse";

function ok(rows: ReturnType<typeof parsePasted>) {
  return rows.map((r) => [r.surface, r.reading, r.meaning_ko, r.error]);
}

describe("붙여넣기 파서", () => {
  it("탭 / 콤마 / 슬래시 / 2칸 공백을 모두 받는다", () => {
    const rows = parsePasted(
      [
        "環境\tかんきょう\t환경",
        "改善,かいぜん,개선",
        "違反 / いはん / 위반",
        "協力    きょうりょく    협력",
      ].join("\n"),
    );
    expect(ok(rows)).toEqual([
      ["環境", "かんきょう", "환경", null],
      ["改善", "かいぜん", "개선", null],
      ["違反", "いはん", "위반", null],
      ["協力", "きょうりょく", "협력", null],
    ]);
  });

  it("괄호 표기를 받는다", () => {
    expect(ok(parsePasted("協力(きょうりょく) 협력\n維持[いじ] 유지"))).toEqual([
      ["協力", "きょうりょく", "협력", null],
      ["維持", "いじ", "유지", null],
    ]);
  });

  it("로마자로 친 읽기를 통째로 변환한다", () => {
    expect(ok(parsePasted("普及\tfukyuu\t보급"))).toEqual([["普及", "ふきゅう", "보급", null]]);
  });

  it("가나 전용 단어는 읽기를 표기와 같게 확정한다", () => {
    expect(ok(parsePasted("きっかけ\t계기"))).toEqual([["きっかけ", "きっかけ", "계기", null]]);
    expect(ok(parsePasted("バランス\tバランス\t밸런스, 균형"))).toEqual([
      ["バランス", "バランス", "밸런스, 균형", null],
    ]);
  });

  it("뜻에 쉼표가 있어도 4칸 이상이면 뒤를 합쳐 뜻으로 본다", () => {
    expect(ok(parsePasted("誤り,あやまり,오류,잘못,실수"))).toEqual([
      ["誤り", "あやまり", "오류, 잘못, 실수", null],
    ]);
  });

  it("부족한 줄은 오류로 표시하되 버리지 않는다", () => {
    const rows = parsePasted("普及\t보급\n環境");
    expect(rows[0].error).toBe("읽기가 없습니다");
    expect(rows[1].error).toBe("칸을 나눌 수 없습니다");
    expect(rows).toHaveLength(2);
  });

  it("빈 줄은 건너뛴다", () => {
    expect(parsePasted("\n\n環境\tかんきょう\t환경\n\n")).toHaveLength(1);
  });
});
