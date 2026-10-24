import type { DiffBlock } from "@/lib/syllable-diff";
import type { TestQuestion } from "@/lib/types";

/** 답을 낸 뒤의 결과. null 이면 아직 답하기 전이다. blocks 는 틀렸을 때만 채운다. */
export type Verdict = { correct: boolean; blocks: DiffBlock[] } | null;

/* ------------------------------------------------------------------ *
 * 문제 면 — 표시 전용
 *
 * 중요: 답을 내기 전에는 정답 읽기와 한국어 뜻을 DOM 에 넣지 않는다(절대 규칙 3과 같은 취지).
 * 숨기는 게 아니라 렌더하지 않는 것이다. app/test/QuestionFace.test.tsx 가 이를 검증한다.
 * ------------------------------------------------------------------ */

/** 어긋난 곳을 [ ] 로 감싼다. 색을 못 보더라도 짚인다. 비어 있으면 빠진 자리라 ＿ 를 둔다. */
export function DiffLine({ blocks, side }: { blocks: DiffBlock[]; side: "typed" | "expected" }) {
  return (
    <span lang="ja" className="jp-md">
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

export function QuestionFace({ question, verdict }: { question: TestQuestion; verdict: Verdict }) {
  if (!verdict) {
    return (
      <div className="flex flex-col items-center gap-5">
        <div className="jp-xl no-select" lang="ja" data-testid="question-surface">
          {question.surface}
        </div>
        <p className="text-base text-muted">읽기를 가나로 입력하세요</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4" data-testid="verdict">
      <p className={`text-lg font-semibold ${verdict.correct ? "text-accent" : "text-danger"}`}>
        {verdict.correct ? "맞았습니다" : "틀렸습니다"}
      </p>
      <ruby className="jp-xl" lang="ja" data-testid="question-surface">
        {question.surface}
        <rt>{question.reading}</rt>
      </ruby>
      <div className="text-2xl text-muted">{question.meaning_ko}</div>
      {!verdict.correct && (
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-left">
          <dt className="text-sm text-muted">내 답</dt>
          <dd>
            <DiffLine blocks={verdict.blocks} side="typed" />
          </dd>
          <dt className="text-sm text-muted">정답</dt>
          <dd>
            <DiffLine blocks={verdict.blocks} side="expected" />
          </dd>
        </dl>
      )}
    </div>
  );
}
