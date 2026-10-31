import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MEANING_PASS_MIN,
  expectedForms,
  judgeMeaning,
  meaningPassed,
  rootsClose,
  similarity,
} from "./meaning-answer";

const credit = (typed: string, meaning: string) => {
  const j = judgeMeaning(typed, meaning);
  return j.result === "invalid" ? null : j.credit;
};

describe("쉼표로 여러 뜻이 붙은 정답은 하나만 맞혀도 정답이다", () => {
  const meaning = "외견, 겉모습, 외관";

  it("목록의 어느 항목이든 정답이다", () => {
    for (const typed of ["외견", "겉모습", "외관"]) expect(credit(typed, meaning), typed).toBe(1);
  });

  it("전각 쉼표 · 모점 · 세미콜론 · 슬래시도 구분자다", () => {
    for (const m of ["외견，겉모습", "외견、겉모습", "외견;겉모습", "외견/겉모습"]) {
      expect(credit("겉모습", m), m).toBe(1);
    }
  });

  it("공백과 문장부호는 무시한다", () => {
    expect(credit("겉 모습", meaning)).toBe(1);
    expect(credit(" 겉모습. ", meaning)).toBe(1);
    expect(credit("기분이좋다", "기분이 좋다")).toBe(1);
    // 조사 하나 차이는 정답이 아니다(부분 점수는 받는다)
    expect(credit("기분 좋다", "기분이 좋다")).toBe(0.5);
  });

  it("입력에도 쉼표로 여러 조각을 쓸 수 있고, 가장 잘 맞는 조각이 점수를 정한다", () => {
    expect(credit("겉모습, 외관", meaning)).toBe(1);
    expect(credit("엉뚱, 외관", meaning)).toBe(1);
  });

  it("입력 조각은 앞의 세 개만 본다 — 아는 낱말을 줄줄이 적어 한 개가 걸리게 하지 못한다", () => {
    expect(credit("가나, 다라, 마바, 외관", meaning)).toBe(0);
    expect(credit("가나, 다라, 외관", meaning)).toBe(1);
  });
});

describe("괄호 안 내용은 적어도 되고 안 적어도 된다", () => {
  const meaning = "(자리를) 떠나다, 물러가다";

  it("괄호 안을 빼고 적어도 정답이다", () => {
    expect(credit("떠나다", meaning)).toBe(1);
  });

  it("괄호 안을 풀어서 적어도 정답이다 — 괄호 기호를 쳐도 마찬가지다", () => {
    expect(credit("자리를 떠나다", meaning)).toBe(1);
    expect(credit("(자리를) 떠나다", meaning)).toBe(1);
    expect(credit("（자리를）떠나다", meaning)).toBe(1);
  });

  it("괄호 안의 쉼표는 구분자가 아니다", () => {
    const m = "(자리를, 직장을) 떠나다";
    expect(expectedForms(m)).toEqual(["떠나다", "자리를직장을떠나다"]);
    expect(credit("떠나다", m)).toBe(1);
    expect(credit("자리를 직장을 떠나다", m)).toBe(1);
    expect(credit("직장을", m)).toBe(0);
  });

  it("괄호 안의 설명만 적어서는 점수를 받지 못한다", () => {
    expect(credit("자리를", meaning)).toBe(0);
  });

  it("뒤에 붙은 괄호도 같다", () => {
    expect(credit("공부", "공부(학습)")).toBe(1);
    expect(credit("공부학습", "공부(학습)")).toBe(1);
  });

  it("항목이 통째로 괄호이면 괄호를 푼 꼴이 기준이다", () => {
    expect(credit("비격식", "(비격식), 편하게")).toBe(1);
    expect(credit("편하게", "(비격식), 편하게")).toBe(1);
  });
});

describe("같은 말의 다른 꼴", () => {
  it("-하다 · -되다 · -다 어미는 있든 없든 정답이다", () => {
    expect(credit("유쾌", "기분이 좋다, 유쾌하다")).toBe(1);
    expect(credit("유쾌하다", "유쾌")).toBe(1);
    expect(credit("건조", "마르다, 건조되다")).toBe(1);
    expect(credit("초대하다", "초대")).toBe(1);
  });

  it("어근이 한 글자면 우연의 일치일 수 있어 부분 점수만 준다", () => {
    expect(credit("줄", "줄다, 감소하다")).toBe(0.5);
    expect(credit("줄다", "줄다, 감소하다")).toBe(1); // 철자가 그대로 같으면 정답
  });
});

describe("뜻이 비슷하면 부분 점수", () => {
  it("한쪽 어근이 다른 쪽에 들어 있고 길이가 절반 이상이면 부분 점수다", () => {
    expect(credit("모습", "겉모습, 외관")).toBe(0.5);
    expect(credit("역할", "역할을 맡다")).toBe(0.5);
  });

  it("철자가 아주 비슷하면(받침 하나 차이 정도) 부분 점수다", () => {
    expect(credit("기부", "기분")).toBe(0.5);
    expect(credit("순조로", "순조롭다")).toBe(0.5);
    // 모음이 틀린 오타는 겹침이 모자라 부분 점수가 아니다.
    expect(credit("겹처지다", "겹쳐지다")).toBe(0);
  });

  it("어미가 같다는 것만으로는 비슷하지 않다", () => {
    expect(credit("해당하다", "당황하다")).toBe(0);
    expect(credit("공급하다", "취급하다")).toBe(0);
  });

  it("어중간하게 닮은 철자는 뜻이 가깝다는 근거가 못 된다", () => {
    expect(credit("보충", "고충")).toBe(0);
    expect(credit("세상", "상세하다")).toBe(0);
  });

  it("한 글자 입력은 철자가 같을 때만 인정한다", () => {
    expect(credit("다", "다르다")).toBe(0);
    expect(credit("팔", "팔, 기술, 솜씨")).toBe(1);
    expect(credit("팔", "팔목")).toBe(0);
  });

  it("전혀 다른 답은 오답이다", () => {
    expect(credit("사과", "외견, 겉모습, 외관")).toBe(0);
  });

  it("부분 점수는 맞힌 것으로 치는 기준 이상이다", () => {
    expect(meaningPassed(1)).toBe(true);
    expect(meaningPassed(0.5)).toBe(true);
    expect(meaningPassed(0)).toBe(false);
    // 뜻을 묻지 않은 옛 답은 읽기만 본다.
    expect(meaningPassed(null)).toBe(true);
    expect(meaningPassed(undefined)).toBe(true);
    expect(MEANING_PASS_MIN).toBe(0.5);
  });
});

describe("판정할 수 없는 입력", () => {
  it("비었거나 공백 · 문장부호뿐이면 판정하지 않는다", () => {
    for (const typed of ["", "   ", "...", " , ; ", "()"]) {
      expect(judgeMeaning(typed, "겉모습"), JSON.stringify(typed)).toEqual({ result: "invalid" });
    }
  });

  it("저장할 입력은 앞뒤 공백을 걷은 것이다", () => {
    expect(judgeMeaning("  겉모습 ", "겉모습")).toEqual({ result: "correct", credit: 1, typed: "겉모습" });
  });
});

describe("철자 유사도", () => {
  it("같으면 1, 겹치는 것이 없으면 0", () => {
    expect(similarity("겉모습", "겉모습")).toBe(1);
    expect(similarity("가", "나")).toBe(0);
  });

  it("어근이 한 글자면 가깝다고 보지 않는다", () => {
    expect(rootsClose("쌓다", "쌓이다")).toBe(false);
  });
});

describe("실제 단어장", () => {
  /** backups/words.csv 의 meaning_ko 칸을 읽는다(따옴표 안의 쉼표를 지킨다). */
  function meanings(): string[] {
    const text = readFileSync("backups/words.csv", "utf8").replace(/^﻿/, "");
    const rows: string[][] = [];
    let row: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else if (c !== "\r") cur += c;
    }
    const at = rows[0].indexOf("meaning_ko");
    return rows
      .slice(1)
      .map((r) => r[at])
      .filter(Boolean);
  }

  it("모든 뜻은 자기 자신에게 정답이고, 쉼표로 나뉜 항목 하나하나도 정답이다", () => {
    const all = meanings();
    expect(all.length).toBeGreaterThan(300);
    for (const m of all) {
      expect(credit(m, m), m).toBe(1);
      // 괄호 밖의 쉼표로만 나눈다.
      for (const item of m.split(/[,，、;；/／](?![^(（]*[)）])/)) {
        if (item.trim()) expect(credit(item, m), `${m} → ${item}`).toBe(1);
      }
    }
  });

  it("괄호가 든 뜻은 괄호 안을 빼고 적어도 정답이다", () => {
    const withParen = meanings().filter((m) => /[(（]/.test(m));
    expect(withParen.length).toBeGreaterThan(0);
    for (const m of withParen) {
      const stripped = m.replace(/[(（][^()（）]*[)）]/g, "").trim();
      if (stripped.replace(/[\s,]/g, "")) expect(credit(stripped, m), `${m} → ${stripped}`).toBe(1);
    }
  });
});
