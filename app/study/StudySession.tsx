"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RETRY_GAP } from "@/lib/srs";
import { suspendWordAction } from "@/lib/actions/words";
import { CardFace, type SessionCard } from "./CardFace";
import type { GradeInput, PromptType, QueueCard, QueueWord } from "@/lib/types";

const FLUSH_AT = 5;
const FAILED_KEY = "n2v_pending_grades";

/* ---------- 전송 실패분 보관 (네트워크가 끊겨도 채점을 잃지 않는다) ---------- */

function loadFailed(): GradeInput[] {
  try {
    const raw = localStorage.getItem(FAILED_KEY);
    return raw ? (JSON.parse(raw) as GradeInput[]) : [];
  } catch {
    return [];
  }
}
function saveFailed(batch: GradeInput[]) {
  try {
    localStorage.setItem(FAILED_KEY, JSON.stringify(batch.slice(-500)));
  } catch {
    /* 저장 실패는 무시 */
  }
}
function clearFailed() {
  try {
    localStorage.removeItem(FAILED_KEY);
  } catch {
    /* noop */
  }
}

interface Handlers {
  reveal(): void;
  grade(correct: boolean): void;
  undo(): void;
  suspend(): void;
}

interface Snapshot {
  queue: SessionCard[];
  index: number;
  answered: number;
  correct: number;
  missed: QueueWord[];
  pendingLen: number;
}

export function StudySession({
  initialCards,
  practice = false,
  title,
}: {
  initialCards: QueueCard[];
  /** 일차/주차 퀴즈. 채점 결과를 서버로 보내지 않는다(SRS 미반영). */
  practice?: boolean;
  title?: string;
}) {
  const [queue, setQueue] = useState<SessionCard[]>(initialCards);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [missed, setMissed] = useState<QueueWord[]>([]);
  const [finished, setFinished] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [busy, setBusy] = useState(false);

  const pendingRef = useRef<GradeInput[]>([]);
  const snapsRef = useRef<Snapshot[]>([]);
  const retryCountRef = useRef(0);

  /** 순수 전송. 상태를 건드리지 않으므로 effect 안에서도 안전하다. */
  const sendGrades = useCallback(async (batch: GradeInput[], keepalive = false) => {
    if (batch.length === 0) return;
    clearFailed();
    try {
      const res = await fetch("/api/grades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grades: batch }),
        keepalive,
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      saveFailed(batch);
    }
  }, []);

  /** 모아둔 채점을 비우고 보낸다. 되돌리기는 여기서 끝난다. */
  const flushPending = useCallback(
    (keepalive = false) => {
      const batch = [...loadFailed(), ...pendingRef.current];
      pendingRef.current = [];
      snapsRef.current = [];
      void sendGrades(batch, keepalive);
    },
    [sendGrades],
  );

  // 지난 세션에서 못 보낸 채점이 있으면 먼저 올린다.
  useEffect(() => {
    if (practice) return;
    const failed = loadFailed();
    if (failed.length > 0) void sendGrades(failed);
  }, [sendGrades, practice]);

  // 탭을 닫거나 백그라운드로 보낼 때도 채점을 잃지 않게 한다.
  useEffect(() => {
    if (practice) return;
    const onHide = () => flushPending(true);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      flushPending(true);
    };
  }, [flushPending, practice]);

  const card: SessionCard | undefined = queue[index];

  function snapshot() {
    snapsRef.current.push({
      queue,
      index,
      answered,
      correct,
      missed,
      pendingLen: pendingRef.current.length,
    });
    if (snapsRef.current.length > 10) snapsRef.current.shift();
  }

  function record(g: GradeInput) {
    if (practice) return; // 연습 퀴즈는 아무것도 기록하지 않는다
    pendingRef.current.push(g);
    if (pendingRef.current.length >= FLUSH_AT) {
      flushPending();
      setCanUndo(false);
    } else {
      setCanUndo(true);
    }
  }

  function advance(nextQueue: SessionCard[], nextIndex: number) {
    setQueue(nextQueue);
    if (nextIndex >= nextQueue.length) {
      setFinished(true);
      flushPending();
      setCanUndo(false);
      return;
    }
    setIndex(nextIndex);
    setRevealed(false);
  }

  function onLearnNext() {
    if (!card) return;
    snapshot();
    record({ wordId: card.word.id, kind: "learn", correct: true, retry: false });
    advance(queue, index + 1);
  }

  function onGrade(isCorrect: boolean) {
    if (!card || card.kind === "learn" || !revealed) return;
    snapshot();
    record({
      wordId: card.word.id,
      kind: card.kind as PromptType,
      correct: isCorrect,
      retry: card.retry === true,
    });

    if (!card.retry) {
      setAnswered((a) => a + 1);
      if (isCorrect) setCorrect((c) => c + 1);
    }

    let nextQueue = queue;
    if (!isCorrect) {
      // 같은 세션 안에서 몇 장 뒤에 다시 세운다. 이때는 SRS 를 건드리지 않는다.
      retryCountRef.current += 1;
      const retryCard: SessionCard = {
        ...card,
        key: `${card.word.id}:r${retryCountRef.current}`,
        retry: true,
      };
      const at = Math.min(index + 1 + RETRY_GAP, queue.length);
      nextQueue = [...queue.slice(0, at), retryCard, ...queue.slice(at)];
      if (!card.retry) {
        setMissed((m) => (m.some((w) => w.id === card.word.id) ? m : [...m, card.word]));
      }
    }
    advance(nextQueue, index + 1);
  }

  function onUndo() {
    const snap = snapsRef.current.pop();
    if (!snap) return;
    pendingRef.current = pendingRef.current.slice(0, snap.pendingLen);
    setQueue(snap.queue);
    setIndex(snap.index);
    setAnswered(snap.answered);
    setCorrect(snap.correct);
    setMissed(snap.missed);
    setFinished(false);
    setRevealed(true);
    setCanUndo(snapsRef.current.length > 0);
  }

  async function onSuspend() {
    if (!card || busy || practice) return;
    setBusy(true);
    try {
      await suspendWordAction(card.word.id);
      const wordId = card.word.id;
      const nextQueue = queue.filter((c, i) => i <= index || c.word.id !== wordId);
      snapsRef.current = [];
      setCanUndo(false);
      advance(nextQueue, index + 1);
    } finally {
      setBusy(false);
    }
  }

  /* 최신 핸들러를 ref 에 담아 키 리스너는 한 번만 등록한다. */
  const handlers = useRef<Handlers>({
    reveal() {},
    grade() {},
    undo() {},
    suspend() {},
  });

  useEffect(() => {
    handlers.current = {
      reveal: () => {
        if (!card) return;
        if (card.kind === "learn") onLearnNext();
        else if (!revealed) setRevealed(true);
      },
      grade: onGrade,
      undo: onUndo,
      suspend: () => void onSuspend(),
    };
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case " ":
        case "Enter":
          e.preventDefault();
          handlers.current.reveal();
          break;
        case "1":
        case "j":
          e.preventDefault();
          handlers.current.grade(true);
          break;
        case "2":
        case "f":
          e.preventDefault();
          handlers.current.grade(false);
          break;
        case "u":
          e.preventDefault();
          handlers.current.undo();
          break;
        case "s":
          e.preventDefault();
          handlers.current.suspend();
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (finished || !card) {
    return (
      <Done answered={answered} correct={correct} missed={missed} practice={practice} />
    );
  }

  const total = queue.length;
  const progress = Math.round(((index + 1) / total) * 100);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-5 py-6">
      <header className="no-select">
        <div className="flex items-baseline justify-between text-sm text-muted">
          <span className="flex items-center gap-2">
            <span>
              {card.retry
                ? "다시"
                : card.kind === "learn"
                  ? "새 단어"
                  : (title ?? "복습")}
            </span>
            {practice && (
              <span className="rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn">
                연습 · 진도 반영 안 됨
              </span>
            )}
            {card.weak && <span className="text-warn">★</span>}
          </span>
          <span className="tabular-nums">
            {index + 1} / {total}
          </span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center py-10 text-center">
        <CardFace card={card} revealed={revealed} />
      </section>

      <footer className="no-select safe-b">
        {card.kind === "learn" ? (
          <button
            onClick={onLearnNext}
            className="w-full rounded-xl bg-accent px-6 py-5 text-lg font-semibold text-accent-fg"
          >
            다음 <span className="text-sm font-normal opacity-70">(Space)</span>
          </button>
        ) : !revealed ? (
          <button
            onClick={() => setRevealed(true)}
            className="w-full rounded-xl bg-accent px-6 py-5 text-lg font-semibold text-accent-fg"
          >
            정답 보기 <span className="text-sm font-normal opacity-70">(Space)</span>
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => onGrade(true)}
              className="rounded-xl bg-accent px-4 py-5 text-lg font-semibold text-accent-fg"
            >
              알았음 <span className="text-sm font-normal opacity-70">(1)</span>
            </button>
            <button
              onClick={() => onGrade(false)}
              className="rounded-xl border border-border bg-surface px-4 py-5 text-lg font-semibold"
            >
              몰랐음 <span className="text-sm font-normal text-muted">(2)</span>
            </button>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-muted">
          <Link href="/" className="underline underline-offset-4">
            나가기
          </Link>
          <span className="flex gap-4">
            <button onClick={onUndo} disabled={!canUndo} className="underline underline-offset-4 disabled:opacity-30">
              되돌리기 (U)
            </button>
            {!practice && (
              <button onClick={() => void onSuspend()} className="underline underline-offset-4">
                보류 (S)
              </button>
            )}
          </span>
        </div>
      </footer>
    </main>
  );
}

function Done({
  answered,
  correct,
  missed,
  practice,
}: {
  answered: number;
  correct: number;
  missed: QueueWord[];
  practice: boolean;
}) {
  const rate = answered > 0 ? Math.round((correct / answered) * 100) : null;
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-6 py-12">
      <section className="rounded-2xl border border-border bg-surface px-6 py-12 text-center">
        <p className="text-2xl font-semibold">{practice ? "연습 완료" : "오늘의 학습 완료"}</p>
        {practice && (
          <p className="mt-1 text-xs text-muted">복습 주기에는 반영되지 않았습니다</p>
        )}
        <p className="mt-4 text-5xl font-semibold tabular-nums">
          {correct} / {answered}
        </p>
        {rate !== null && <p className="mt-2 text-sm text-muted">정답률 {rate}%</p>}
      </section>

      {missed.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm text-muted">몰랐던 단어 {missed.length}개</h2>
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
            {missed.map((w) => (
              <li key={w.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
                <span className="jp-md" lang="ja">
                  {w.surface}
                </span>
                <span className="text-base text-muted" lang="ja">
                  {w.reading}
                </span>
                <span className="text-base">{w.meaning_ko}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-10 flex gap-3">
        {practice && (
          <button
            onClick={() => window.location.reload()}
            className="flex-1 rounded-xl border border-border bg-surface px-6 py-4 text-base font-semibold"
          >
            다시 (순서 섞기)
          </button>
        )}
        <Link
          href="/"
          className="flex-1 rounded-xl bg-accent px-6 py-4 text-center text-base font-semibold text-accent-fg"
        >
          홈으로
        </Link>
      </div>
    </main>
  );
}
