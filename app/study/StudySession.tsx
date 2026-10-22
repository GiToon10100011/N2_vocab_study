"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RETRY_GAP } from "@/lib/srs";
import { suspendWordAction, updateWordAction } from "@/lib/actions/words";
import { hasNonKana, normalizeReading } from "@/lib/kana";
import { OUTBOX_KEY, type UndoBuffer } from "@/lib/grade-outbox";
import { createUndoBuffer, releaseUndoBuffer } from "@/lib/grade-client";
import { RecoveryNotice } from "../RecoveryNotice";
import { useGradeRecovery } from "../useGradeRecovery";
import { CardFace, type SessionCard } from "./CardFace";
import type { GradeInput, PromptType, QueueCard, QueueWord } from "@/lib/types";

interface Handlers {
  reveal(): void;
  grade(correct: boolean): void;
  undo(): void;
  suspend(): void;
  edit(): void;
}

/** 되돌리면 돌아갈 화면 상태. 채점 하나에 하나씩 쌓인다. */
interface Snapshot {
  queue: SessionCard[];
  index: number;
  answered: number;
  correct: number;
  missed: QueueWord[];
}

export function StudySession({
  initialCards,
  practice = false,
  title,
  undoSeconds,
}: {
  initialCards: QueueCard[];
  /** 일차/주차 퀴즈. 복습 주기는 건드리지 않고 오답 기록만 남긴다. */
  practice?: boolean;
  title?: string;
  /** 되돌리기 시간(초). 0 = 상시 */
  undoSeconds: number;
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
  const [editing, setEditing] = useState(false);
  const router = useRouter();

  const snapsRef = useRef<Snapshot[]>([]);
  const retryCountRef = useRef(0);
  /** 아직 보내지 않은 채점. 되돌리기 창과 저장소 백업은 여기서 맡는다(lib/grade-outbox.ts). */
  const bufferRef = useRef<UndoBuffer | null>(null);

  /**
   * 지난 세션에서 서버에 가지 못한 채점이 남아 있으면 그것부터 보낸다. 방금 받은 큐는 그 채점이
   * 반영되기 전에 만들어진 것이라, 그대로 시작하면 이미 푼 카드가 다시 나오고 두 번 반영된다.
   */
  const { recovery, unsent, blockedRef, recover, skip } = useGradeRecovery();

  useEffect(() => {
    const buffer = createUndoBuffer({
      undoSeconds,
      practice,
      onClose: () => {
        snapsRef.current = [];
        setCanUndo(false);
      },
    });
    bufferRef.current = buffer;

    // 다른 탭이 이 세션의 채점을 가져가 보냈거나, 화면을 떠나 있는 사이 되돌리기 시간이 지났을 수 있다.
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === OUTBOX_KEY) buffer.sync();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") buffer.sync();
    };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      // 앱 안에서 다른 화면으로 넘어가는 경우다. 페이지는 살아 있으니 보통의 요청으로 보낸다.
      // 탭을 닫을 때는 아무것도 보내지 않는다. 그 순간의 전송은 도착했는지 알 수 없어서,
      // 보냈다고 치면 잃고 남겨 두면 두 번 반영된다. 저장소에 남은 것을 다음 진입 때 보낸다.
      void releaseUndoBuffer(buffer).catch(() => undefined);
      bufferRef.current = null;
    };
  }, [undoSeconds, practice]);

  const card: SessionCard | undefined = queue[index];

  function snapshot() {
    snapsRef.current.push({ queue, index, answered, correct, missed });
  }

  function record(g: GradeInput) {
    // 연습 퀴즈도 기록은 한다. 복습 주기는 안 바뀌지만 오답은 오답노트에 남아야 한다.
    bufferRef.current?.add(g);
    setCanUndo(true);
  }

  function advance(nextQueue: SessionCard[], nextIndex: number) {
    setQueue(nextQueue);
    if (nextIndex >= nextQueue.length) {
      setFinished(true);
      // 세션이 끝났다. 되돌리기 시간이 남아 있어도 여기서 확정하고 보낸다. 끝내고 바로 앱을
      // 닫는 것이 가장 흔한 경로라, 미루면 채점이 이 기기에만 남는다.
      void bufferRef.current?.close().catch(() => undefined);
      return;
    }
    setIndex(nextIndex);
    setRevealed(false);
  }

  function onLearnNext() {
    if (!card || blockedRef.current) return;
    snapshot();
    record({ wordId: card.word.id, kind: "learn", correct: true, retry: false });
    advance(queue, index + 1);
  }

  function onGrade(isCorrect: boolean) {
    if (!card || card.kind === "learn" || !revealed || blockedRef.current) return;
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
    const snap = snapsRef.current[snapsRef.current.length - 1];
    if (!snap) return;
    // 창이 이미 닫혔으면(그 사이 시간이 지났거나 다른 탭이 보냈다) 되돌리지 않는다.
    if (!bufferRef.current?.undo()) {
      snapsRef.current = [];
      setCanUndo(false);
      return;
    }
    snapsRef.current.pop();
    setQueue(snap.queue);
    setIndex(snap.index);
    setAnswered(snap.answered);
    setCorrect(snap.correct);
    setMissed(snap.missed);
    setFinished(false);
    setRevealed(true);
    setCanUndo(snapsRef.current.length > 0);
  }

  /** 앱 안에서 세션을 떠나는 경로. 확실히 보내고 이동한다. */
  async function leave() {
    await bufferRef.current?.close().catch(() => undefined);
    router.push("/");
  }

  /**
   * 연습을 다시 푼다. 방금 끝낸 채점이 서버에 닿은 것을 확인한 뒤에 새로 받는다. 보내는 도중에
   * 새로고침하면 서버는 받았는데 저장소에는 남아, 다시 열렸을 때 한 번 더 보낸다.
   */
  async function again() {
    await bufferRef.current?.close().catch(() => undefined);
    window.location.reload();
  }

  async function onSuspend() {
    if (!card || busy || practice) return;
    setBusy(true);
    try {
      await suspendWordAction(card.word.id);
      const wordId = card.word.id;
      const nextQueue = queue.filter((c, i) => i <= index || c.word.id !== wordId);
      // 큐에서 카드를 빼므로 그 앞으로는 되돌릴 수 없다. 여기까지의 채점을 확정한다.
      void bufferRef.current?.close().catch(() => undefined);
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
    edit() {},
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
      edit: () => setEditing(true),
    };
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || blockedRef.current) return;
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
        case "e":
          e.preventDefault();
          handlers.current.edit();
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // blockedRef 는 훅이 돌려주는 ref 라 린트가 안정된 값인지 모른다. 정체가 바뀌지 않으므로 리스너는 한 번만 등록된다.
  }, [blockedRef]);

  if (recovery !== "none") {
    return (
      <RecoveryNotice
        failed={recovery === "failed" ? unsent : null}
        onRetry={() => void recover()}
        onSkip={skip}
      />
    );
  }

  if (finished || !card) {
    return (
      <Done
        answered={answered}
        correct={correct}
        missed={missed}
        practice={practice}
        onAgain={() => void again()}
      />
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
                연습 · 주기 영향 없음
              </span>
            )}
            {card.weak && <span className="text-warn">★</span>}
            {/* 실전 테스트에서 틀린 뒤 아직 두 번 연속 맞히지 못했다. 카드면(CardFace)은 건드리지 않는다. */}
            {card.caution && (
              <span className="rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn">읽기 주의</span>
            )}
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

      {editing && (
        <EditOverlay
          card={card}
          onClose={() => setEditing(false)}
          onSaved={(w) => {
            // 큐에 남아 있는 같은 단어의 카드를 모두 갱신한다.
            setQueue((q) =>
              q.map((c) =>
                c.word.id === w.id
                  ? {
                      ...c,
                      word: {
                        ...c.word,
                        surface: w.surface,
                        reading: w.reading,
                        meaning_ko: w.meaning_ko,
                      },
                    }
                  : c,
              ),
            );
            setEditing(false);
          }}
        />
      )}

      <footer className="no-select pb-[env(safe-area-inset-bottom)]">
        {card.kind === "learn" ? (
          <button
            onClick={onLearnNext}
            className="w-full rounded-xl bg-accent px-6 py-5 text-lg font-semibold text-accent-fg"
          >
            다음 <span className="text-sm font-normal opacity-90">(Space)</span>
          </button>
        ) : !revealed ? (
          <button
            onClick={() => setRevealed(true)}
            className="w-full rounded-xl bg-accent px-6 py-5 text-lg font-semibold text-accent-fg"
          >
            정답 보기 <span className="text-sm font-normal opacity-90">(Space)</span>
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => onGrade(true)}
              className="rounded-xl bg-accent px-4 py-5 text-lg font-semibold text-accent-fg"
            >
              알았음 <span className="text-sm font-normal opacity-90">(1)</span>
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
          <button
            onClick={() => void leave()}
            className="underline underline-offset-4"
          >
            나가기
          </button>
          <span className="flex gap-4">
            <button onClick={onUndo} disabled={!canUndo} className="underline underline-offset-4 disabled:opacity-30">
              되돌리기 (U)
            </button>
            <button onClick={() => setEditing(true)} className="underline underline-offset-4">
              수정 (E)
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

/** 세션 중 오타 수정. 흐름을 끊지 않도록 오버레이로 띄운다. */
function EditOverlay({
  card,
  onClose,
  onSaved,
}: {
  card: SessionCard;
  onClose: () => void;
  onSaved: (w: { id: string; surface: string; reading: string; meaning_ko: string }) => void;
}) {
  const [surface, setSurface] = useState(card.word.surface);
  const [reading, setReading] = useState(card.word.reading);
  const [meaning, setMeaning] = useState(card.word.meaning_ko);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const readingKana = normalizeReading(reading) || surface.trim();

  async function save() {
    if (busy) return;
    if (hasNonKana(readingKana)) {
      setErr(`읽기에 가나가 아닌 문자가 남아 있습니다: ${readingKana}`);
      return;
    }
    setBusy(true);
    const res = await updateWordAction(card.word.id, {
      surface: surface.trim(),
      reading: readingKana,
      meaning_ko: meaning.trim(),
      study_day: "",
    });
    setBusy(false);
    if (res.ok) {
      onSaved({
        id: res.word.id,
        surface: res.word.surface,
        reading: res.word.reading,
        meaning_ko: res.word.meaning_ko,
      });
    } else {
      setErr(res.reason === "duplicate" ? "같은 표기·읽기의 단어가 이미 있습니다." : "저장 실패");
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">이 단어 수정</h2>
        <div className="mt-4 flex flex-col gap-3">
          <input
            autoFocus
            value={surface}
            onChange={(e) => setSurface(e.target.value)}
            lang="ja"
            className="rounded-lg border border-border bg-bg px-3 py-2.5 text-xl"
          />
          <input
            value={reading}
            onChange={(e) => setReading(e.target.value)}
            onBlur={() => setReading(readingKana)}
            lang="ja"
            autoCapitalize="none"
            spellCheck={false}
            className="rounded-lg border border-border bg-bg px-3 py-2.5 text-xl"
          />
          <input
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
            lang="ko"
            className="rounded-lg border border-border bg-bg px-3 py-2.5"
          />
        </div>
        {readingKana !== reading && reading.trim() && (
          <p className="mt-2 text-sm">
            → <b lang="ja">{readingKana}</b>
          </p>
        )}
        {err && <p className="mt-2 text-sm text-danger">{err}</p>}
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => void save()}
            disabled={busy}
            className="flex-1 rounded-lg bg-accent px-4 py-3 font-semibold text-accent-fg disabled:opacity-50"
          >
            저장
          </button>
          <button onClick={onClose} className="rounded-lg border border-border px-5 py-3">
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

function Done({
  answered,
  correct,
  missed,
  practice,
  onAgain,
}: {
  answered: number;
  correct: number;
  missed: QueueWord[];
  practice: boolean;
  onAgain: () => void;
}) {
  const rate = answered > 0 ? Math.round((correct / answered) * 100) : null;
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-6 py-12">
      <section className="rounded-2xl border border-border bg-surface px-6 py-12 text-center">
        <p className="text-2xl font-semibold">{practice ? "연습 완료" : "오늘의 학습 완료"}</p>
        {practice && (
          <p className="mt-1 text-xs text-muted">
            복습 주기는 그대로입니다. 틀린 단어는 오답노트에 기록됐습니다.
          </p>
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
            onClick={onAgain}
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
