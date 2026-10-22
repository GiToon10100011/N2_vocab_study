import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { diffSyllables } from "@/lib/syllable-diff";
import type { TestQuestion } from "@/lib/types";
import { QuestionFace } from "./QuestionFace";

const q: TestQuestion = {
  wordId: "w1",
  surface: "抽象的",
  reading: "ちゅうしょうてき",
  meaning_ko: "추상적",
};

/** 어긋난 음절 표시(<mark>) 안의 글자만 순서대로 꺼낸다. */
const marks = (html: string) => [...html.matchAll(/<mark[^>]*>([^<]*)<\/mark>/g)].map((m) => m[1]);

describe("실전 테스트 문제 누출 방지", () => {
  it("답을 내기 전에는 표기만 보이고 읽기도 뜻도 DOM 에 없다", () => {
    const html = renderToStaticMarkup(<QuestionFace question={q} verdict={null} />);
    expect(html).toContain("抽象的");
    expect(html).not.toContain("ちゅうしょうてき");
    expect(html).not.toContain("추상적");
  });

  it("맞힌 뒤에는 읽기와 뜻이 보이고 음절 대조는 없다", () => {
    const html = renderToStaticMarkup(<QuestionFace question={q} verdict={{ correct: true, blocks: [] }} />);
    expect(html).toContain("맞았습니다");
    expect(html).toContain("ちゅうしょうてき");
    expect(html).toContain("추상적");
    expect(html).not.toContain("내 답");
  });

  it("틀린 뒤에는 읽기 · 뜻과 어긋난 음절이 나란히 보인다", () => {
    const blocks = diffSyllables("ちゅうそうてき", "ちゅうしょうてき");
    const html = renderToStaticMarkup(<QuestionFace question={q} verdict={{ correct: false, blocks }} />);
    expect(html).toContain("틀렸습니다");
    expect(html).toContain("ちゅうしょうてき");
    expect(html).toContain("추상적");
    // 같은 음절과 어긋난 음절은 조각으로 나뉘어 렌더된다. 어긋난 쪽만 [ ] 로 감싸 짚는다.
    expect(marks(html)).toEqual(["[そ]", "[しょ]"]); // 내 답 → 정답 순서
    expect(html).toContain("<span>ちゅう</span>");
    expect(html).toContain("<span>うてき</span>");
  });

  it("빠뜨린 음절은 자리표시로 보인다", () => {
    const blocks = diffSyllables("がこう", "がっこう");
    const html = renderToStaticMarkup(
      <QuestionFace
        question={{ ...q, surface: "学校", reading: "がっこう", meaning_ko: "학교" }}
        verdict={{ correct: false, blocks }}
      />,
    );
    expect(marks(html)).toEqual(["[＿]", "[っ]"]); // 내 답에는 っ 가 없다 → 자리표시
  });
});
