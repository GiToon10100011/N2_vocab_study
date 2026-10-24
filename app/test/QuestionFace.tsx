import type { DiffBlock } from "@/lib/syllable-diff";
import type { TestQuestion } from "@/lib/types";

/** 답을 낸 뒤의 결과. null 이면 아직 답하기 전이다. blocks 는 틀렸을 때만 채운다. */
export type Verdict = { correct: boolean; blocks: DiffBlock[] } | null;

/* ------------------------------------------------------------------ *
 * 문제 칸과 판정 줄 — 표시 전용
 *
 * 중요: 답을 내기 전에는 정답 읽기와 한국어 뜻을 DOM 에 넣지 않는다(절대 규칙 3과 같은 취지).
 * 숨기는 게 아니라 렌더하지 않는 것이다. app/test/QuestionFace.test.tsx 가 이를 검증한다.
 * ------------------------------------------------------------------ */

/** 어긋난 곳을 [ ] 로 감싼다. 색을 못 보더라도 짚인다. 비어 있으면 빠진 자리라 ＿ 를 둔다. */
export function DiffLine({
  blocks,
  side,
  className = "jp-md",
}: {
  blocks: DiffBlock[];
  side: "typed" | "expected";
  className?: string;
}) {
  return (
    <span lang="ja" className={className}>
      {blocks.map((b, i) =>
        b.kind === "same" ? (
          <span key={i}>{b.text}</span>
        ) : (
          <mark key={i} className="rounded bg-warn-bg px-0.5 font-semibold text-warn">
            {`[${(side === "typed" ? b.typed : b.expected) || "＿"}]`}
          </mark>
        ),
      )}
    </span>
  );
}

/**
 * 문제 칸의 세 줄: 읽기 · 표기 · 뜻. 답하기 전에도 읽기와 뜻 자리는 비워 둔 채 잡아 둔다 — 판정이 나왔을 때
 * 표기가 움직이지 않게 하려는 것이다. 표기를 가운데 줄에 고정하는 것은 app/globals.css 의 .test-stage 다.
 */
export function QuestionFace({ question, verdict }: { question: TestQuestion; verdict: Verdict }) {
  return (
    <>
      <div className="test-reading text-muted" lang="ja">
        {verdict ? question.reading : null}
      </div>
      <div className="test-kanji no-select" lang="ja" data-testid="question-surface">
        {question.surface}
      </div>
      <div className="test-meaning">{verdict ? question.meaning_ko : null}</div>
    </>
  );
}

/** 판정 줄. 윗줄에 맞음 · 틀림, 틀렸으면 아랫줄에 내 답 → 정답 대조. 입력칸 바로 위의 두 줄 자리에 들어간다. */
export function VerdictLine({ verdict }: { verdict: NonNullable<Verdict> }) {
  return (
    <>
      <p className={`text-[15px] font-semibold ${verdict.correct ? "text-accent" : "text-danger"}`}>
        {verdict.correct ? "맞았습니다" : "틀렸습니다"}
      </p>
      {!verdict.correct && (
        <p className="text-base">
          <span className="sr-only">내 답 </span>
          <DiffLine blocks={verdict.blocks} side="typed" className="" />
          <span aria-hidden className="mx-1 text-muted">
            →
          </span>
          <span className="sr-only">정답 </span>
          <DiffLine blocks={verdict.blocks} side="expected" className="" />
        </p>
      )}
    </>
  );
}
