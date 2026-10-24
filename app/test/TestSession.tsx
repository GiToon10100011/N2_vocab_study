"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createUndoBuffer, releaseUndoBuffer } from "@/lib/grade-client";
import type { UndoBuffer } from "@/lib/grade-outbox";
import { convertAnswer, judgeReading } from "@/lib/reading-answer";
import { diffSyllables, type DiffBlock } from "@/lib/syllable-diff";
import type { TestAnswered, TestQuestion } from "@/lib/types";
import { RecoveryNotice } from "../RecoveryNotice";
import { useGradeRecovery } from "../useGradeRecovery";
import { isSubmitKey } from "./keys";
import { DiffLine, QuestionFace, VerdictLine, type Verdict } from "./QuestionFace";
import { useVisibleViewport } from "./useVisibleViewport";

/** 답 몇 개마다 서버로 보낼까. 문제마다 왕복하지 않되, 앱이 죽어도 이 기기에서만 쥐고 있는 양을 줄인다. */
const FLUSH_EVERY = 10;

interface Miss {
  question: TestQuestion;
  blocks: DiffBlock[];
}

/** 이전에 푼 문제의 대조. 지금의 읽기로 다시 맞춰 보되 판정할 수 없으면 대조 없이 둔다. */
function missOf(a: TestAnswered): Miss {
  const j = judgeReading(a.typed, a);
  return { question: a, blocks: j.result === "invalid" ? [] : diffSyllables(j.compare.typed, j.compare.expected) };
}

export function TestSession({
  testDay,
  questions,
  answered,
}: {
  testDay: string;
  /** 아직 안 푼 문제 */
  questions: TestQuestion[];
  /** 이미 푼 문제. 끝 화면에서 전체를 세는 데만 쓴다. */
  answered: TestAnswered[];
}) {
  const router = useRouter();
  const { recovery, unsent, blockedRef, recover, skip } = useGradeRecovery();
  const viewport = useVisibleViewport();

  const [index, setIndex] = useState(0);
  const [input, setInput] = useState("");
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [finished, setFinished] = useState(questions.length === 0);
  const [results, setResults] = useState<{ correct: number; misses: Miss[] }>({
    correct: 0,
    misses: [],
  });

  /** 아직 보내지 않은 답. 저장소 백업과 전송은 여기서 맡는다(lib/grade-outbox.ts). 되돌리기는 없다. */
  const bufferRef = useRef<UndoBuffer | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const submittedRef = useRef(0);

  useEffect(() => {
    // undoSeconds 0 = 타이머로는 보내지 않고 close() 할 때만 보낸다. 되돌리기 버튼이 없으니 창이 필요 없다.
    const buffer = createUndoBuffer({ undoSeconds: 0, practice: false, test: testDay, onClose: () => undefined });
    bufferRef.current = buffer;
    return () => {
      // 앱 안에서 다른 화면으로 넘어가는 경우다. 탭을 닫을 때는 아무것도 보내지 않는다 —
      // 그 순간의 전송은 도착했는지 알 수 없어서, 저장소에 남은 것을 다음 진입 때 보낸다.
      void releaseUndoBuffer(buffer).catch(() => undefined);
      bufferRef.current = null;
    };
  }, [testDay]);

  // 다음 문제로 넘어가도 입력칸은 그대로 두고 포커스만 돌려준다(아이폰에서 키보드가 내려가지 않게).
  useEffect(() => {
    // 화면은 보이는 영역에 맞춰 고정돼 있다. 포커스 때문에 사파리가 페이지를 밀지 않게 한다.
    if (!finished && recovery === "none") inputRef.current?.focus({ preventScroll: true });
  }, [index, finished, recovery]);

  const question: TestQuestion | undefined = questions[index];

  function submit() {
    if (!question || verdict || blockedRef.current) return;
    const j = judgeReading(input, question);
    if (j.result === "invalid") {
      // 한자가 섞였거나 로마자가 남았다. 채점하지 않고 같은 문제에 머문다. 빈 입력은 아무것도 하지 않는다.
      if (j.reason === "not-kana") {
        setMessage("가나로 다시 입력하세요 — 한자나 로마자가 남아 있습니다");
      }
      return;
    }
    const correct = j.result === "correct";
    const blocks = correct ? [] : diffSyllables(j.compare.typed, j.compare.expected);
    setMessage(null);
    setVerdict({ correct, blocks });
    setResults((r) => ({
      correct: r.correct + (correct ? 1 : 0),
      misses: correct ? r.misses : [...r.misses, { question, blocks }],
    }));
    // 서버가 같은 함수로 다시 채점하므로 정오가 아니라 확정된 가나를 보낸다(typed).
    bufferRef.current?.add({ wordId: question.wordId, kind: "s2r", correct, retry: false, typed: j.kana });
    submittedRef.current += 1;
    if (submittedRef.current % FLUSH_EVERY === 0) void bufferRef.current?.close().catch(() => undefined);
  }

  function next() {
    if (!verdict || blockedRef.current) return;
    if (index + 1 >= questions.length) {
      setFinished(true);
      // 끝내고 바로 앱을 닫는 것이 가장 흔한 경로라, 미루면 답이 이 기기에만 남는다.
      void bufferRef.current?.close().catch(() => undefined);
      return;
    }
    setIndex(index + 1);
    setInput("");
    setVerdict(null);
    setMessage(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (blockedRef.current) return;
    const key = {
      key: e.key,
      isComposing: e.nativeEvent.isComposing,
      keyCode: e.keyCode,
      repeat: e.repeat,
    };
    // IME 확정 Enter 는 제출이 아니다. 조합 내용을 가로채거나 고치지 않는다.
    if (!isSubmitKey(key, composingRef.current)) return;
    e.preventDefault();
    if (verdict) next();
    else submit();
  }

  /** 앱 안에서 테스트를 떠나는 경로. 확실히 보내고 이동한다. */
  async function leave() {
    await bufferRef.current?.close().catch(() => undefined);
    router.push("/");
  }

  if (recovery !== "none") {
    return (
      <RecoveryNotice
        failed={recovery === "failed" ? unsent : null}
        onRetry={() => void recover()}
        onSkip={skip}
      />
    );
  }

  const total = answered.length + questions.length;

  if (finished || !question) {
    const correct = answered.filter((a) => a.correct).length + results.correct;
    const misses = [...answered.filter((a) => !a.correct).map(missOf), ...results.misses];
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-6 py-12">
        <section className="rounded-2xl border border-border bg-surface px-6 py-12 text-center">
          <p className="text-2xl font-semibold">실전 테스트 완료</p>
          <p data-testid="result-summary" className="mt-4 text-4xl font-semibold tabular-nums">
            {total}문제 중 {correct}개
          </p>
          <p className="mt-2 text-xs text-muted">틀린 단어는 내일 복습에 다시 나옵니다.</p>
        </section>

        {misses.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm text-muted">틀린 단어 {misses.length}개</h2>
            <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
              {misses.map(({ question: q, blocks }) => (
                <li key={q.wordId} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-4">
                    <span className="jp-md" lang="ja">
                      {q.surface}
                    </span>
                    <span className="text-base text-muted" lang="ja">
                      {q.reading}
                    </span>
                    <span className="text-base">{q.meaning_ko}</span>
                  </div>
                  <div className="flex items-baseline gap-2 text-sm text-muted">
                    <span>내 답</span>
                    <DiffLine blocks={blocks} side="typed" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-10">
          <Link
            href="/"
            className="block rounded-xl bg-accent px-6 py-4 text-center text-base font-semibold text-accent-fg"
          >
            홈으로
          </Link>
        </div>
      </main>
    );
  }

  const position = answered.length + index + 1;
  const progress = Math.round((position / total) * 100);

  return (
    /*
      화면 전체를 지금 보이는 영역(visualViewport)에 맞춰 고정하고, 입력칸을 그 맨 아래 — 키보드 바로 위에 붙인다.
      아이폰은 키보드가 올라와도 레이아웃 높이(dvh)를 줄이지 않아서, dvh 기준으로 그리면 아래쪽이 키보드 밑에 깔리고
      사파리가 페이지를 밀어 올려 문제가 화면 밖으로 나간다. 남는 높이는 문제 칸이 갖고, 화면 어디에도 스크롤이 없다.
      e2e/typing-test.spec.ts 「키보드가 열린 화면」 이 지킨다.
    */
    <main
      className={`fixed inset-x-0 top-0 mx-auto flex max-w-2xl flex-col px-5 pt-[env(safe-area-inset-top)] ${
        viewport ? "" : "h-dvh"
      } ${viewport?.keyboard ? "pb-2.5" : "pb-[calc(10px+env(safe-area-inset-bottom))]"}`}
      style={
        viewport
          ? { height: viewport.height, transform: viewport.top ? `translateY(${viewport.top}px)` : undefined }
          : undefined
      }
    >
      <header className="no-select flex min-h-11 items-center justify-between text-sm text-muted">
        <button onClick={() => void leave()} className="py-2">
          <span aria-hidden>‹ </span>나가기
        </button>
        <span className="tabular-nums">
          {position} / {total}
        </span>
      </header>
      <div className="h-1 w-full overflow-hidden rounded-full bg-border">
        <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div data-testid={verdict ? "verdict" : undefined} className="flex min-h-0 flex-1 flex-col">
        <section
          data-testid="question-stage"
          data-keyboard={viewport?.keyboard ? "open" : undefined}
          className="test-stage min-h-0 flex-1 py-2"
        >
          <QuestionFace question={question} verdict={verdict} />
        </section>

        {/* 판정 줄: 두 줄 자리를 늘 잡아 둔다. 판정이 한 줄을 넘겨도 아래 칸 높이가 그대로라 문제가 움직이지 않는다.
            입력하는 동안에는 아랫줄(입력칸 바로 위)에 미리보기나 안내가 나온다. */}
        <div className="flex min-h-12 flex-col items-center justify-end text-center leading-normal">
          {verdict ? (
            <VerdictLine verdict={verdict} />
          ) : message ? (
            <p role="alert" className="text-sm text-danger">
              {message}
            </p>
          ) : (
            input.trim() !== "" && (
              <p data-testid="reading-preview" lang="ja" className="text-base text-muted">
                → {convertAnswer(input)}
              </p>
            )
          )}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        {/* 입력칸은 친 그대로 둔다. 가나로 어떻게 읽히는지는 바로 위 미리보기 줄에만 보여 준다. */}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setMessage(null);
          }}
          onKeyDown={onKeyDown}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          readOnly={verdict !== null}
          aria-label="읽기"
          lang="ja"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          placeholder="읽기를 가나로"
          // 초록 · 붉은 테두리는 판정에만 쓴다. 입력하는 동안의 포커스는 회색이다(초록 포커스가 오답과 헷갈렸다).
          className={`h-11 min-w-0 flex-1 rounded-[10px] border-[1.5px] bg-surface px-3 text-center text-xl outline-none ${
            verdict ? (verdict.correct ? "border-accent" : "border-danger") : "border-border focus:border-muted"
          }`}
        />
        <button
          // 눌러도 입력칸 포커스를 잃지 않게 한다. 잃으면 아이폰에서 키보드가 내려가고 화면 높이가 다시 바뀐다.
          onPointerDown={(e) => e.preventDefault()}
          onClick={verdict ? next : submit}
          className="h-11 min-w-[72px] shrink-0 rounded-[10px] bg-accent px-4 text-base font-semibold text-accent-fg"
        >
          {verdict ? "다음" : "제출"}
        </button>
      </div>
    </main>
  );
}
