import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { diffSyllables } from "@/lib/syllable-diff";
import type { TestQuestion } from "@/lib/types";
import { MeaningVerdictLine, QuestionFace, VerdictLine } from "./QuestionFace";

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
  const face = (readingShown: boolean, meaningShown: boolean) =>
    renderToStaticMarkup(<QuestionFace question={q} readingShown={readingShown} meaningShown={meaningShown} />);

  it("답을 내기 전에는 표기만 보이고 읽기도 뜻도 DOM 에 없다", () => {
    const html = face(false, false);
    expect(html).toContain("抽象的");
    expect(html).not.toContain("ちゅうしょうてき");
    expect(html).not.toContain("추상적");
  });

  it("읽기를 낸 뒤에는 읽기만 보이고 뜻은 DOM 에 없다 — 뜻을 묻는 동안 답이 드러나지 않게", () => {
    const html = face(true, false);
    expect(html).toContain("ちゅうしょうてき");
    expect(html).not.toContain("추상적");
  });

  it("읽기 · 뜻 자리는 답하기 전에도 잡아 둔다 — 단계가 바뀌어도 표기가 움직이지 않게", () => {
    const before = shape(face(false, false));
    expect(shape(face(true, false))).toBe(before);
    expect(shape(face(true, true))).toBe(before);
  });

  it("뜻을 낸 뒤에는 읽기와 뜻이 모두 보인다", () => {
    const html = face(true, true);
    expect(html).toContain("ちゅうしょうてき");
    expect(html).toContain("추상적");
  });

  it("읽기를 맞힌 판정 줄은 맞았다고만 한다", () => {
    const line = renderToStaticMarkup(<VerdictLine verdict={{ correct: true, blocks: [] }} />);
    expect(line).toContain("읽기");
    expect(line).toContain("맞았습니다");
    expect(line).not.toContain("내 답");
    expect(line).not.toContain("추상적"); // 뜻은 판정 줄에도 없다
    expect(marks(line)).toEqual([]);
  });

  it("뜻 판정 줄: 정답은 맞았다고만, 부분 정답은 0.5점과 내 답, 오답은 내 답을 보여 준다", () => {
    const full = renderToStaticMarkup(<MeaningVerdictLine verdict={{ credit: 1, typed: "추상" }} />);
    expect(full).toContain("뜻");
    expect(full).toContain("맞았습니다");
    expect(full).not.toContain("내 답");

    const partial = renderToStaticMarkup(<MeaningVerdictLine verdict={{ credit: 0.5, typed: "추상하다" }} />);
    expect(partial).toContain("부분 정답");
    expect(partial).toContain("0.5");
    expect(partial).toContain("추상하다");

    const wrong = renderToStaticMarkup(<MeaningVerdictLine verdict={{ credit: 0, typed: "구체적" }} />);
    expect(wrong).toContain("틀렸습니다");
    expect(wrong).toContain("구체적");
  });

  it("틀린 뒤에는 판정 줄에 어긋난 음절이 내 답 → 정답 순서로 보인다", () => {
    const blocks = diffSyllables("ちゅうそうてき", "ちゅうしょうてき");
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
