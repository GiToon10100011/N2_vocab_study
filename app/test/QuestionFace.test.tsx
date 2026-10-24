import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { diffSyllables } from "@/lib/syllable-diff";
import type { TestQuestion } from "@/lib/types";
import { QuestionFace, VerdictLine } from "./QuestionFace";

const q: TestQuestion = {
  wordId: "w1",
  surface: "抽象的",
  reading: "ちゅうしょうてき",
  meaning_ko: "추상적",
};

/** 어긋난 음절 표시(<mark>) 안의 글자만 순서대로 꺼낸다. */
const marks = (html: string) => [...html.matchAll(/<mark[^>]*>([^<]*)<\/mark>/g)].map((m) => m[1]);

/** 글자를 걷어낸 태그 모양. 판정 전후로 같으면 자리가 그대로라 표기가 움직이지 않는다. */
const shape = (html: string) => html.replace(/>[^<]*</g, "><");

describe("실전 테스트 문제 누출 방지", () => {
  it("답을 내기 전에는 표기만 보이고 읽기도 뜻도 DOM 에 없다", () => {
    const html = renderToStaticMarkup(<QuestionFace question={q} verdict={null} />);
    expect(html).toContain("抽象的");
    expect(html).not.toContain("ちゅうしょうてき");
    expect(html).not.toContain("추상적");
  });

  it("읽기 · 뜻 자리는 답하기 전에도 잡아 둔다 — 판정이 나와도 표기가 움직이지 않게", () => {
    const before = renderToStaticMarkup(<QuestionFace question={q} verdict={null} />);
    const after = renderToStaticMarkup(<QuestionFace question={q} verdict={{ correct: false, blocks: [] }} />);
    expect(shape(after)).toBe(shape(before));
  });

  it("맞힌 뒤에는 읽기와 뜻이 보이고, 판정 줄은 맞았다고만 한다", () => {
    const face = renderToStaticMarkup(<QuestionFace question={q} verdict={{ correct: true, blocks: [] }} />);
    expect(face).toContain("ちゅうしょうてき");
    expect(face).toContain("추상적");
    const line = renderToStaticMarkup(<VerdictLine verdict={{ correct: true, blocks: [] }} />);
    expect(line).toContain("맞았습니다");
    expect(line).not.toContain("내 답");
    expect(marks(line)).toEqual([]);
  });

  it("틀린 뒤에는 읽기 · 뜻이 보이고, 판정 줄에 어긋난 음절이 내 답 → 정답 순서로 보인다", () => {
    const blocks = diffSyllables("ちゅうそうてき", "ちゅうしょうてき");
    const face = renderToStaticMarkup(<QuestionFace question={q} verdict={{ correct: false, blocks }} />);
    expect(face).toContain("ちゅうしょうてき");
    expect(face).toContain("추상적");
    const line = renderToStaticMarkup(<VerdictLine verdict={{ correct: false, blocks }} />);
    expect(line).toContain("틀렸습니다");
    // 같은 음절과 어긋난 음절은 조각으로 나뉘어 렌더된다. 어긋난 쪽만 [ ] 로 감싸 짚는다.
    expect(marks(line)).toEqual(["[そ]", "[しょ]"]); // 내 답 → 정답 순서
    expect(line).toContain("<span>ちゅう</span>");
    expect(line).toContain("<span>うてき</span>");
  });

  it("빠뜨린 음절은 자리표시로 보인다", () => {
    const blocks = diffSyllables("がこう", "がっこう");
    const line = renderToStaticMarkup(<VerdictLine verdict={{ correct: false, blocks }} />);
    expect(marks(line)).toEqual(["[＿]", "[っ]"]); // 내 답에는 っ 가 없다 → 자리표시
  });
});
