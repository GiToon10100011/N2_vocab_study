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
import { DiffLine, QuestionFace, type Verdict } from "./QuestionFace";

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
    if (!finished && recovery === "none") inputRef.current?.focus();
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
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-5 py-4">
      <header className="no-select">
        <div className="flex items-baseline justify-between text-sm text-muted">
          <span>실전 테스트</span>
          <span className="tabular-nums">
            {position} / {total}
          </span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
        </div>
      </header>

      {/*
        입력칸을 화면 맨 아래에 두지 않고 문제 바로 아래에 붙인다. 아이폰은 키보드가 올라와도 레이아웃 높이(dvh)를
        줄이지 않고 키보드에 가린 입력칸이 보이게 페이지를 위로 밀어 올린다. 맨 아래에 있으면 그때 문제가
        화면 밖으로 나가서 위로 스크롤해야 했다. e2e/typing-test.spec.ts 「키보드가 열린 화면」 이 지킨다.
      */}
      <section className="flex flex-col items-center py-4 text-center">
        <QuestionFace question={question} verdict={verdict} />
      </section>

      <footer className="pb-[env(safe-area-inset-bottom)]">
        {/* 입력칸은 친 그대로 둔다. 가나로 어떻게 읽히는지는 바로 아래 미리보기 줄에만 보여 준다. */}
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
          className="w-full rounded-lg border border-border bg-bg px-4 py-3 text-center text-2xl"
        />
        <div className="mt-2 min-h-7 text-center">
          {input.trim() !== "" && (
            <p data-testid="reading-preview" lang="ja" className="text-lg text-muted">
              → {convertAnswer(input)}
            </p>
          )}
        </div>
        {message && (
          <p role="alert" className="text-center text-sm text-danger">
            {message}
          </p>
        )}

        <button
          onClick={verdict ? next : submit}
          className="mt-3 w-full rounded-xl bg-accent px-6 py-4 text-lg font-semibold text-accent-fg"
        >
          {verdict ? "다음" : "제출"} <span className="text-sm font-normal opacity-90">(Enter)</span>
        </button>

        <div className="no-select mt-4 flex items-center justify-between text-xs text-muted">
          <button onClick={() => void leave()} className="underline underline-offset-4">
            나가기
          </button>
        </div>
      </footer>
    </main>
  );
}
