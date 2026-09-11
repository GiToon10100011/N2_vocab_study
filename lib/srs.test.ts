import { describe, expect, it } from "vitest";
import {
  LADDER,
  MAX_STAGE,
  addDays,
  allowedTypes,
  buildPracticeQueue,
  buildQueue,
  diffDays,
  gradeWord,
  isWeak,
  pickPromptType,
  planGrades,
  studyDate,
  studyDayStart,
} from "./srs";
import type { GradeInput, PromptType, SrsState, Word } from "./types";

const TODAY = "2026-09-11";

function state(over: Partial<SrsState> = {}): SrsState {
  return {
    stage: 0,
    correct_count: 0,
    wrong_count: 0,
    streak: 0,
    last_wrong_type: null,
    ...over,
  };
}

function word(over: Partial<Word> = {}): Word {
  return {
    id: over.id ?? "w1",
    surface: "環境",
    reading: "かんきょう",
    meaning_ko: "환경",
    note: null,
    study_day: TODAY,
    created_at: "2026-09-01T00:00:00Z",
    stage: 0,
    next_review: TODAY,
    last_reviewed: null,
    correct_count: 0,
    wrong_count: 0,
    streak: 0,
    last_wrong_type: null,
    suspended: false,
    ...over,
  };
}

describe("날짜 유틸", () => {
  it("addDays 는 월말을 넘겨도 맞는다", () => {
    expect(addDays("2026-09-11", 30)).toBe("2026-10-11");
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // 윤년
  });

  it("diffDays 는 미래를 양수로 준다", () => {
    expect(diffDays("2026-09-12", "2026-09-11")).toBe(1);
    expect(diffDays("2026-09-11", "2026-09-18")).toBe(-7);
  });

  it("하루 경계는 04:00 이라 새벽 공부는 전날로 집계된다", () => {
    // 2026-09-12 02:00 KST = 2026-09-11 17:00 UTC
    expect(studyDate(new Date("2026-09-11T17:00:00Z"), "Asia/Seoul")).toBe("2026-09-11");
    // 2026-09-12 05:00 KST = 2026-09-11 20:00 UTC
    expect(studyDate(new Date("2026-09-11T20:00:00Z"), "Asia/Seoul")).toBe("2026-09-12");
  });
});

describe("전이 규칙", () => {
  it("알았음은 사다리를 한 칸 올린다", () => {
    const table: Array<[number, number, string]> = [
      [0, 1, addDays(TODAY, 1)],
      [1, 2, addDays(TODAY, 3)],
      [2, 3, addDays(TODAY, 7)],
      [3, 4, addDays(TODAY, 14)],
      [4, 5, addDays(TODAY, 30)],
      [5, 6, addDays(TODAY, 60)],
      [6, 7, addDays(TODAY, 120)],
      [7, 7, addDays(TODAY, 120)], // 상한
    ];
    for (const [from, to, due] of table) {
      const p = gradeWord(state({ stage: from }), "s2r", true, TODAY);
      expect(p.stage).toBe(to);
      expect(p.next_review).toBe(due);
      expect(p.streak).toBe(1);
      expect(p.correct_count).toBe(1);
      expect(p.last_wrong_type).toBeNull();
    }
  });

  it("몰랐음은 어느 단계에서든 stage 1 / 내일로 떨어진다", () => {
    for (let s = 0; s <= MAX_STAGE; s++) {
      const p = gradeWord(state({ stage: s, streak: 9 }), "s2r", false, TODAY);
      expect(p.stage).toBe(1);
      expect(p.next_review).toBe(addDays(TODAY, 1));
      expect(p.streak).toBe(0);
      expect(p.wrong_count).toBe(1);
      expect(p.last_wrong_type).toBe("s2r");
    }
  });

  it("정답을 맞히면 약점 유형 기록이 해제된다", () => {
    const p = gradeWord(state({ stage: 3, last_wrong_type: "s2r" }), "s2r", true, TODAY);
    expect(p.last_wrong_type).toBeNull();
  });

  it("사다리 간격은 기획서와 같다", () => {
    expect([...LADDER]).toEqual([0, 1, 3, 7, 14, 30, 60, 120]);
  });
});

describe("세션 내 재시도 / 학습 카드", () => {
  it("재시도 성공은 stage 를 올리지 않고 로그만 남긴다", () => {
    const states = new Map<string, SrsState>([["w1", state({ stage: 4 })]]);
    const grades: GradeInput[] = [
      { wordId: "w1", kind: "s2r", correct: false, retry: false },
      { wordId: "w1", kind: "s2r", correct: true, retry: true },
    ];
    const plan = planGrades(states, grades, TODAY);
    expect(plan[0].schedule?.stage).toBe(1);
    expect(plan[1].schedule).toBeNull();
    expect(plan[1].counters).toBeNull();
    expect(plan[1].log.retry).toBe(true);
    expect(states.get("w1")!.stage).toBe(1); // 재시도로 되돌아가지 않는다
  });

  it("학습 카드는 스케줄을 건드리지 않는다", () => {
    const states = new Map<string, SrsState>([["w1", state()]]);
    const plan = planGrades(
      states,
      [{ wordId: "w1", kind: "learn", correct: true, retry: false }],
      TODAY,
    );
    expect(plan[0].schedule).toBeNull();
    expect(plan[0].counters).toBeNull();
    expect(states.get("w1")!.stage).toBe(0);
  });
});

describe("출제 유형 선택", () => {
  const normal = { surface: "環境", reading: "かんきょう", stage: 3 };

  it("가나 전용 단어는 항상 표기 -> 뜻", () => {
    const kana = { surface: "ちゃんと", reading: "ちゃんと", stage: 3 };
    expect(allowedTypes(kana, false)).toEqual(["s2m"]);
    for (let i = 0; i < 50; i++) {
      const t = pickPromptType({
        word: kana,
        hasHomophone: false,
        lastWrongType: "s2r",
        rand: i / 50,
      });
      expect(t).toBe("s2m");
    }
  });

  it("동음 충돌 단어는 읽기 -> 뜻이 절대 나오지 않는다", () => {
    for (let i = 0; i < 1000; i++) {
      const t = pickPromptType({
        word: { surface: "以外", reading: "いがい", stage: 3 },
        hasHomophone: true,
        lastWrongType: null,
        rand: i / 1000,
      });
      expect(t).not.toBe("r2m");
    }
  });

  it("약점 유형이 있으면 강제로 그 유형이 나온다", () => {
    for (const forced of ["s2r", "s2m", "r2m"] as PromptType[]) {
      const t = pickPromptType({
        word: normal,
        hasHomophone: false,
        lastWrongType: forced,
        rand: 0.99,
      });
      expect(t).toBe(forced);
    }
  });

  it("신규 단어의 첫 퀴즈는 항상 한자 -> 읽기", () => {
    for (let i = 0; i < 100; i++) {
      const t = pickPromptType({
        word: { ...normal, stage: 0 },
        hasHomophone: false,
        lastWrongType: null,
        rand: i / 100,
      });
      expect(t).toBe("s2r");
    }
  });

  it("가중 추첨 분포가 60 / 25 / 15 에 맞는다", () => {
    const N = 10_000;
    const count: Record<string, number> = { s2r: 0, s2m: 0, r2m: 0 };
    for (let i = 0; i < N; i++) {
      count[
        pickPromptType({
          word: normal,
          hasHomophone: false,
          lastWrongType: null,
          rand: (i + 0.5) / N,
        })
      ]++;
    }
    expect(count.s2r / N).toBeCloseTo(0.6, 2);
    expect(count.s2m / N).toBeCloseTo(0.25, 2);
    expect(count.r2m / N).toBeCloseTo(0.15, 2);
  });

  it("동음 충돌 시 남은 두 유형으로 재정규화된다 (60:25 -> 0.706:0.294)", () => {
    const N = 10_000;
    let s2r = 0;
    for (let i = 0; i < N; i++) {
      if (
        pickPromptType({
          word: { surface: "以外", reading: "いがい", stage: 3 },
          hasHomophone: true,
          lastWrongType: null,
          rand: (i + 0.5) / N,
        }) === "s2r"
      )
        s2r++;
    }
    expect(s2r / N).toBeCloseTo(60 / 85, 2);
  });
});

describe("취약 단어 판정", () => {
  it("3회 이상 틀렸고 연속 정답이 1 이하면 취약", () => {
    expect(isWeak({ wrong_count: 3, streak: 0 })).toBe(true);
    expect(isWeak({ wrong_count: 3, streak: 1 })).toBe(true);
    expect(isWeak({ wrong_count: 3, streak: 2 })).toBe(false); // 회복함
    expect(isWeak({ wrong_count: 2, streak: 0 })).toBe(false);
  });
});

describe("오늘의 큐", () => {
  const readingCounts = {};

  it("취약/오답을 앞에, 신규는 5개씩 묶어 사이에 끼운다", () => {
    const words: Word[] = [
      word({ id: "weak", stage: 1, wrong_count: 4, streak: 0, next_review: "2026-09-05" }),
      word({ id: "due1", stage: 4, next_review: "2026-09-09" }),
      word({ id: "due2", stage: 5, next_review: "2026-09-10" }),
      ...Array.from({ length: 6 }, (_, i) =>
        word({ id: `new${i}`, stage: 0, created_at: `2026-09-11T0${i}:00:00Z` }),
      ),
    ];
    const q = buildQueue({ words, today: TODAY, readingCounts, rand: () => 0.5 });

    // 복습 3장 + 신규 6장 x (학습 + 퀴즈) = 15장
    expect(q).toHaveLength(15);
    // 취약 단어가 일반 복습보다 먼저
    const ids = q.map((c) => c.word.id);
    expect(ids.indexOf("weak")).toBeLessThan(ids.indexOf("due1"));
    // 신규는 학습 카드가 퀴즈보다 먼저, 그 사이에 간격이 있다
    const learnIdx = q.findIndex((c) => c.key === "new0:learn");
    const quizIdx = q.findIndex((c) => c.key === "new0:q");
    expect(learnIdx).toBeGreaterThanOrEqual(0);
    expect(quizIdx - learnIdx).toBeGreaterThanOrEqual(5);
  });

  it("신규 첫 퀴즈는 한자 -> 읽기다", () => {
    const words = [word({ id: "n1", stage: 0 })];
    const q = buildQueue({ words, today: TODAY, readingCounts, rand: () => 0.99 });
    expect(q.map((c) => c.kind)).toEqual(["learn", "s2r"]);
  });

  it("상한과 보류를 지킨다", () => {
    const words: Word[] = [
      ...Array.from({ length: 40 }, (_, i) =>
        word({ id: `n${i}`, stage: 0, created_at: `2026-09-0${(i % 9) + 1}T00:00:00Z` }),
      ),
      ...Array.from({ length: 200 }, (_, i) =>
        word({ id: `r${i}`, stage: 3, next_review: "2026-09-10" }),
      ),
      word({ id: "sus", stage: 0, suspended: true }),
    ];
    const q = buildQueue({ words, today: TODAY, readingCounts, rand: () => 0.5 });
    const newCards = q.filter((c) => c.kind === "learn");
    expect(newCards).toHaveLength(30); // newLimit
    const reviewCards = q.filter((c) => c.word.id.startsWith("r"));
    expect(reviewCards).toHaveLength(150); // reviewLimit
    expect(q.some((c) => c.word.id === "sus")).toBe(false);
  });

  it("skipNew 면 복습만 나온다", () => {
    const words = [
      word({ id: "n1", stage: 0 }),
      word({ id: "r1", stage: 3, next_review: "2026-09-10" }),
    ];
    const q = buildQueue({ words, today: TODAY, readingCounts, skipNew: true, rand: () => 0.5 });
    expect(q).toHaveLength(1);
    expect(q[0].word.id).toBe("r1");
  });

  it("아직 기한이 안 된 복습은 나오지 않는다", () => {
    const words = [word({ id: "future", stage: 3, next_review: "2026-09-20" })];
    const q = buildQueue({ words, today: TODAY, readingCounts, rand: () => 0.5 });
    expect(q).toHaveLength(0);
  });
});

describe("학습일 경계 시각", () => {
  it("2026-09-11 학습일은 KST 09-11 04:00 에 시작한다", () => {
    const start = studyDayStart("2026-09-11", "Asia/Seoul");
    expect(start.toISOString()).toBe("2026-09-10T19:00:00.000Z");
    // 그 직전/직후가 각각 전날/당일로 집계되는지 교차 확인
    expect(studyDate(new Date(start.getTime() - 1), "Asia/Seoul")).toBe("2026-09-10");
    expect(studyDate(start, "Asia/Seoul")).toBe("2026-09-11");
  });
});

describe("연습 퀴즈 큐", () => {
  const readingCounts = {};
  const words = Array.from({ length: 8 }, (_, i) =>
    word({ id: `w${i}`, surface: `語${i}`, reading: `ご${i}`, stage: i % 8 }),
  );

  it("단어당 카드 하나이고 학습 카드는 없다", () => {
    const q = buildPracticeQueue({ words, readingCounts, rand: () => 0.5 });
    expect(q).toHaveLength(words.length);
    expect(q.some((c) => c.kind === "learn")).toBe(false);
    expect(new Set(q.map((c) => c.word.id)).size).toBe(words.length);
  });

  it("돌릴 때마다 순서가 달라진다", () => {
    const a = buildPracticeQueue({ words, readingCounts }).map((c) => c.word.id);
    const orders = new Set<string>();
    for (let i = 0; i < 30; i++) {
      orders.add(buildPracticeQueue({ words, readingCounts }).map((c) => c.word.id).join(","));
    }
    expect(orders.size).toBeGreaterThan(1);
    expect(a).toHaveLength(words.length);
  });

  it("보류한 단어는 빠진다", () => {
    const q = buildPracticeQueue({
      words: [...words, word({ id: "sus", suspended: true })],
      readingCounts,
      rand: () => 0.5,
    });
    expect(q.some((c) => c.word.id === "sus")).toBe(false);
  });

  it("가나 전용/동음 충돌 예외는 연습에서도 그대로 지켜진다", () => {
    const special = [
      word({ id: "kana", surface: "ちゃんと", reading: "ちゃんと" }),
      word({ id: "h1", surface: "以外", reading: "いがい" }),
      word({ id: "h2", surface: "意外", reading: "いがい" }),
    ];
    for (let i = 0; i < 50; i++) {
      const q = buildPracticeQueue({ words: special, readingCounts: { いがい: 2 } });
      expect(q.find((c) => c.word.id === "kana")!.kind).toBe("s2m");
      expect(q.filter((c) => c.word.surface === "以外")[0].kind).not.toBe("r2m");
    }
  });
});

describe("연습 퀴즈 채점", () => {
  it("복습 주기는 그대로 두고 오답 기록만 남긴다", () => {
    const states = new Map<string, SrsState>([
      ["w1", state({ stage: 5, streak: 4, correct_count: 9 })],
    ]);
    const plan = planGrades(
      states,
      [{ wordId: "w1", kind: "s2r", correct: false, retry: false }],
      TODAY,
      true, // practice
    );
    expect(plan[0].schedule).toBeNull(); // 주기 미변경
    expect(plan[0].counters).toEqual({
      correct_count: 9,
      wrong_count: 1,
      streak: 0,
      last_wrong_type: "s2r",
    });
    expect(plan[0].log.practice).toBe(true);
    expect(states.get("w1")!.stage).toBe(5); // 단계 유지
  });

  it("연습에서 맞히면 연속 정답이 이어져 취약에서 벗어날 수 있다", () => {
    const states = new Map<string, SrsState>([
      ["w1", state({ stage: 3, wrong_count: 4, streak: 1 })],
    ]);
    const plan = planGrades(
      states,
      [{ wordId: "w1", kind: "s2m", correct: true, retry: false }],
      TODAY,
      true,
    );
    expect(plan[0].counters!.streak).toBe(2);
    expect(plan[0].counters!.last_wrong_type).toBeNull();
    expect(isWeak({ wrong_count: 4, streak: 2 })).toBe(false);
    expect(plan[0].schedule).toBeNull();
  });

  it("SRS 세션은 주기까지 바꾼다 (대조군)", () => {
    const states = new Map<string, SrsState>([["w1", state({ stage: 5 })]]);
    const plan = planGrades(
      states,
      [{ wordId: "w1", kind: "s2r", correct: false, retry: false }],
      TODAY,
      false,
    );
    expect(plan[0].schedule).toEqual({ stage: 1, next_review: addDays(TODAY, 1) });
  });
});
