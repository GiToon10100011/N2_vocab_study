import type { DiffBlock } from "@/lib/syllable-diff";
import type { TestQuestion } from "@/lib/types";

/** 읽기를 낸 뒤의 결과. null 이면 아직 답하기 전이다. blocks 는 틀렸을 때만 채운다. */
export type Verdict = { correct: boolean; blocks: DiffBlock[] } | null;

/** 뜻을 낸 뒤의 결과. credit: 1 정답, 0.5 부분 정답, 0 오답. typed 는 친 뜻이다. */
export type MeaningVerdict = { credit: 0 | 0.5 | 1; typed: string } | null;

/* ------------------------------------------------------------------ *
 * 문제 칸과 판정 줄 — 표시 전용
 *
 * 중요: 정답 읽기는 읽기를 낸 뒤에, 한국어 뜻은 뜻을 낸 뒤에야 DOM 에 넣는다(절대 규칙 3과 같은 취지).
 * 읽기를 낸 뒤에도 뜻은 없다 — 뜻을 묻는 동안 답이 드러나면 안 된다.
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
 * 문제 칸의 세 줄: 읽기 · 표기 · 뜻. 답하기 전에도 읽기와 뜻 자리는 비워 둔 채 잡아 둔다 — 단계가 바뀌어도
 * 표기가 움직이지 않게 하려는 것이다. 표기를 가운데 줄에 고정하는 것은 app/globals.css 의 .test-stage 다.
 * readingShown: 읽기를 냈다(정답 읽기가 나온다). meaningShown: 뜻을 냈다(정답 뜻이 나온다).
 */
export function QuestionFace({
  question,
  readingShown,
  meaningShown,
}: {
  question: TestQuestion;
  readingShown: boolean;
  meaningShown: boolean;
}) {
  return (
    <>
      <div className="test-reading text-muted" lang="ja">
        {readingShown ? question.reading : null}
      </div>
      <div className="test-kanji no-select" lang="ja" data-testid="question-surface">
        {question.surface}
      </div>
      <div className="test-meaning">{meaningShown ? question.meaning_ko : null}</div>
    </>
  );
}

/** 뜻 판정 줄. 윗줄에 맞음 · 부분 정답 · 틀림, 정답이 아니면 아랫줄에 내 답(정답 뜻은 위 문제 칸에 나와 있다). */
export function MeaningVerdictLine({ verdict }: { verdict: NonNullable<MeaningVerdict> }) {
  const tone = verdict.credit === 1 ? "text-accent" : verdict.credit === 0.5 ? "text-warn" : "text-danger";
  const label =
    verdict.credit === 1 ? "맞았습니다" : verdict.credit === 0.5 ? "부분 정답 (0.5점)" : "틀렸습니다";
  return (
    <>
      <p className={`text-[15px] font-semibold ${tone}`}>
        <span className="font-normal text-muted">뜻 · </span>
        {label}
      </p>
      {verdict.credit < 1 && (
        <p className="max-w-full truncate text-base">
          <span className="sr-only">내 답 </span>
          <span className="text-muted" aria-hidden>
            내 답{" "}
          </span>
          {verdict.typed}
        </p>
      )}
    </>
  );
}

/** 읽기 판정 줄. 윗줄에 맞음 · 틀림, 틀렸으면 아랫줄에 내 답 → 정답 대조. 입력칸 바로 위의 두 줄 자리에 들어간다. */
export function VerdictLine({ verdict }: { verdict: NonNullable<Verdict> }) {
  return (
    <>
      <p className={`text-[15px] font-semibold ${verdict.correct ? "text-accent" : "text-danger"}`}>
        <span className="font-normal text-muted">읽기 · </span>
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
