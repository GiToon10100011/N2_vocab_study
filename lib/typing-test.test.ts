import { describe, expect, it } from "vitest";
import {
  finishedStudyDay,
  isTestEligible,
  markCaution,
  normalizeTestSize,
  parseTestAnswers,
  pickTestWords,
  testPhase,
  testStatus,
  testWeight,
  weightedOrder,
  type LatestTest,
  type TestCandidate,
} from "./typing-test";

const T = "2026-10-22";

/** 부를 때마다 값을 차례로 돌려주는 난수. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function cand(over: Partial<TestCandidate> = {}): TestCandidate {
  return {
    id: "w1",
    stage: 3,
    suspended: false,
    surface: "違反",
    reading: "いはん",
    study_day: T,
    firstReviewDay: "2026-10-19",
    s2rWrong: 0,
    history: [],
    lastAnsweredAt: null,
    ...over,
  };
}

describe("테스트 이력", () => {
  it("기록이 없으면 처음 보는 단어다", () => {
    expect(testStatus([])).toBe("untested");
  });

  it("틀린 뒤 두 번 연속 맞히면 통과다", () => {
    for (const h of [[true], [false, true, true], [false, true, false, true, true]]) {
      expect(testStatus(h)).toBe("passed");
    }
  });

  it("틀린 뒤 아직 두 번 연속 맞히지 못했으면 재시험이다", () => {
    for (const h of [[false], [false, true], [true, false], [false, true, true, false]]) {
      expect(testStatus(h)).toBe("retest");
    }
  });
});

describe("문제 수 설정", () => {
  it("숫자가 아니면 40, 범위 밖은 10~100 으로 자르고 반올림한다", () => {
    expect([
      normalizeTestSize(undefined),
      normalizeTestSize("x"),
      normalizeTestSize(5),
      normalizeTestSize(500),
      normalizeTestSize(39.6),
    ]).toEqual([40, 40, 10, 100, 40]);
  });
});

describe("출제 대상", () => {
  it("한자가 있고 이미 학습한 단어는 대상이다", () => {
    expect(isTestEligible(cand(), T)).toBe(true);
    expect(isTestEligible(cand({ firstReviewDay: null }), T)).toBe(true); // 로그가 없다고 빼지 않는다
  });

  it("신규 · 보류 · 가나 전용 · 오늘 처음 배운 단어 · 판정할 수 없는 읽기는 대상이 아니다", () => {
    expect(isTestEligible(cand({ stage: 0 }), T)).toBe(false);
    expect(isTestEligible(cand({ suspended: true }), T)).toBe(false);
    expect(isTestEligible(cand({ surface: "きっかけ", reading: "きっかけ" }), T)).toBe(false);
    expect(isTestEligible(cand({ firstReviewDay: T }), T)).toBe(false);
    expect(isTestEligible(cand({ reading: "ＺＺよみ" }), T)).toBe(false);
  });
});

describe("위험도 가중치", () => {
  it("아무 위험 요소가 없으면 1", () => {
    expect(testWeight(cand(), T)).toBe(1);
  });

  it("플래시카드 s2r 오답은 3회까지 센다", () => {
    expect(testWeight(cand({ s2rWrong: 2 }), T)).toBe(3);
    expect(testWeight(cand({ s2rWrong: 9 }), T)).toBe(4);
  });

  it("요음 · 장음 · 촉음이 있으면 한 번만 두 배", () => {
    for (const r of ["がっこう", "ちゅうしょうてき", "けいざい", "せいじ"]) {
      expect(testWeight(cand({ reading: r }), T)).toBe(2);
    }
  });

  it("오래된 단어일수록 무겁고 56일에서 멈춘다", () => {
    expect(testWeight(cand({ study_day: "2026-10-15" }), T)).toBe(2);
    expect(testWeight(cand({ study_day: "2026-08-01" }), T)).toBe(9);
    expect(testWeight(cand({ study_day: "2026-10-30" }), T)).toBe(1);
  });

  it("세 요소를 곱한다", () => {
    expect(testWeight(cand({ s2rWrong: 3, reading: "がっこう", study_day: "2026-08-01" }), T)).toBe(72);
  });
});

describe("가중 무작위 순서", () => {
  it("난수가 같으면 무거운 순이고 동률은 입력 순이다", () => {
    const w = { a: 1, b: 3, c: 3, d: 2 } as Record<string, number>;
    expect(weightedOrder(["a", "b", "c", "d"], (x) => w[x], () => 0.5)).toEqual(["b", "c", "d", "a"]);
  });

  it("가벼운 쪽이 이길 수도 있다 — 위험한 것부터 줄 세우지 않는다", () => {
    expect(weightedOrder(["a", "b"], (x) => (x === "a" ? 1 : 3), seq(0.01, 0.99))).toEqual(["a", "b"]);
  });
});

describe("출제 선택", () => {
  const at = (day: string) => `2026-10-${day}T00:00:00Z`;
  const sorted = (ids: string[]) => [...ids].sort();

  it("재시험 → 처음 보는 단어 → 통과한 단어 순으로 채운다", () => {
    const cands = [
      cand({ id: "P", history: [true], lastAnsweredAt: at("01") }),
      cand({ id: "U2" }),
      cand({ id: "U1", s2rWrong: 3 }),
      cand({ id: "R", history: [false], lastAnsweredAt: at("20") }),
    ];
    expect(sorted(pickTestWords(cands, T, 2, () => 0.5))).toEqual(["R", "U1"]);
  });

  it("재시험이 자리보다 많으면 오래 기다린 것부터", () => {
    const cands = ["05", "04", "03", "02", "01"].map((d, i) =>
      cand({ id: `R${i + 1}`, history: [false], lastAnsweredAt: at(d) }),
    );
    expect(sorted(pickTestWords(cands, T, 3, () => 0.5))).toEqual(["R3", "R4", "R5"]);
  });

  it("모두 통과했으면 통과한 지 오래된 것부터", () => {
    const cands = [
      cand({ id: "P1", history: [true], lastAnsweredAt: at("03") }),
      cand({ id: "P2", history: [true], lastAnsweredAt: at("01") }),
      cand({ id: "P3", history: [true], lastAnsweredAt: at("02") }),
    ];
    expect(sorted(pickTestWords(cands, T, 2, () => 0.5))).toEqual(["P2", "P3"]);
  });

  it("대상이 아닌 단어는 어떤 경우에도 나오지 않고, 후보가 모자라면 짧은 테스트가 된다", () => {
    const cands = [
      cand({ id: "S", suspended: true, history: [false], lastAnsweredAt: at("01") }),
      cand({ id: "K", surface: "きっかけ", reading: "きっかけ" }),
      cand({ id: "N", firstReviewDay: T }),
      cand({ id: "U" }),
    ];
    expect(pickTestWords(cands, T, 10, () => 0.5)).toEqual(["U"]);
  });

  it("처음 보는 단어 자리는 가중 무작위로 채운다", () => {
    const cands = [
      cand({ id: "U1", s2rWrong: 3, reading: "がっこう", study_day: "2026-08-01" }),
      cand({ id: "U2" }),
      cand({ id: "U3", s2rWrong: 3 }),
    ];
    expect(sorted(pickTestWords(cands, T, 2, () => 0.5))).toEqual(["U1", "U3"]);
  });

  it("뽑은 문제는 섞는다", () => {
    const cands = ["01", "02", "03"].map((d, i) =>
      cand({ id: `R${i + 1}`, history: [false], lastAnsweredAt: at(d) }),
    );
    const out = pickTestWords(cands, T, 3, () => 0);
    expect(out).not.toEqual(["R1", "R2", "R3"]);
    expect(sorted(out)).toEqual(["R1", "R2", "R3"]);
  });
});

describe("출현 판정", () => {
  const done = (at: string | null, day = "2026-10-20"): LatestTest => ({
    testDay: day,
    total: 40,
    remaining: 0,
    lastAnsweredAt: at,
  });

  it("테스트 기록이 없으면 바로 뜬다", () => {
    expect(testPhase(null, T)).toEqual({ phase: "ready" });
  });

  it("남은 문제가 있으면 진행 중이다", () => {
    expect(testPhase({ testDay: "2026-10-21", total: 40, remaining: 3, lastAnsweredAt: null }, T)).toEqual({
      phase: "active",
      testDay: "2026-10-21",
      remaining: 3,
      total: 40,
    });
  });

  it("끝낸 학습일로부터 2일이 지나야 뜨고, 몇 번을 건너뛰어도 1회분이다", () => {
    expect(testPhase(done("2026-10-20T10:00:00Z"), "2026-10-21")).toEqual({ phase: "wait", nextDay: "2026-10-22" });
    expect(testPhase(done("2026-10-20T10:00:00Z"), "2026-10-22")).toEqual({ phase: "ready" });
    expect(testPhase(done("2026-10-20T10:00:00Z"), "2026-11-30")).toEqual({ phase: "ready" });
  });

  it("03:59 에 끝낸 테스트는 전날로 센다 (04:00 경계)", () => {
    expect(finishedStudyDay(done("2026-10-20T18:59:00Z"))).toBe("2026-10-20"); // KST 10-21 03:59
    expect(finishedStudyDay(done("2026-10-20T19:00:00Z"))).toBe("2026-10-21"); // KST 10-21 04:00
    expect(testPhase(done("2026-10-20T18:59:00Z"), T)).toEqual({ phase: "ready" });
    expect(testPhase(done("2026-10-20T19:00:00Z"), T)).toEqual({ phase: "wait", nextDay: "2026-10-23" });
  });

  it("답이 하나도 없이 끝났으면 시작한 날을 끝낸 날로 본다", () => {
    expect(finishedStudyDay(done(null, "2026-10-20"))).toBe("2026-10-20");
  });
});

describe("읽기 주의 표시", () => {
  it("재시험이 필요한 단어의 카드에만 표시하고 입력은 바꾸지 않는다", () => {
    const cards = [{ word: { id: "a" } }, { word: { id: "b" } }];
    const marked = markCaution(cards, new Set(["a"]));
    expect(marked[0]).toEqual({ word: { id: "a" }, caution: true });
    expect(marked[1]).toEqual({ word: { id: "b" } });
    expect("caution" in marked[1]).toBe(false); // 표시가 없는 카드에는 키 자체가 없다
    expect(cards[0]).toEqual({ word: { id: "a" } });
  });

  it("같은 단어의 카드는 몇 장이든 모두 표시한다 (본 카드 · 재시도 카드)", () => {
    const cards = [{ word: { id: "a" } }, { word: { id: "a" } }, { word: { id: "b" } }];
    expect(markCaution(cards, new Set(["a"])).map((c) => "caution" in c)).toEqual([true, true, false]);
  });
});

describe("답 요청 파싱", () => {
  const id = (n: number) => `w-${String(n).padStart(10, "0")}`;

  it("배열이 아니면 빈 목록", () => {
    expect(parseTestAnswers(null)).toEqual([]);
    expect(parseTestAnswers({})).toEqual([]);
  });

  it("모양이 맞는 답만 받는다", () => {
    expect(
      parseTestAnswers([
        { wordId: id(1), typed: "ちゅう" },
        { wordId: "w1", typed: "ちゅう" },
        { wordId: id(2), typed: "" },
        { wordId: id(3), typed: "あ".repeat(65) },
        { wordId: id(4), typed: 5 },
        null,
      ]),
    ).toEqual([{ wordId: id(1), typed: "ちゅう" }]);
  });

  it("200건까지, 같은 단어는 첫 답만", () => {
    expect(parseTestAnswers(Array.from({ length: 250 }, (_, i) => ({ wordId: id(i), typed: "あ" })))).toHaveLength(200);
    expect(
      parseTestAnswers([
        { wordId: id(1), typed: "あ" },
        { wordId: id(1), typed: "い" },
      ]),
    ).toEqual([{ wordId: id(1), typed: "あ" }]);
  });
});
