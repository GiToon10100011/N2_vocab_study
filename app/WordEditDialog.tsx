"use client";

import { useEffect, useRef, useState } from "react";
import { deleteWordAction, setSuspendedAction, updateWordAction } from "@/lib/actions/words";
import { hasNonKana, normalizeReading } from "@/lib/kana";
import { stageLabel } from "@/lib/srs";
import type { Word } from "@/lib/types";

/**
 * 단어 수정 모달.
 * 목록 안에 폼을 펼치면 행 높이가 들쭉날쭉해지고 컨테이너 밖으로 삐져나온다.
 * 목록의 레이아웃을 전혀 건드리지 않도록 화면 위에 띄운다.
 */
export function WordEditDialog({
  word,
  onClose,
  onSaved,
  onDeleted,
}: {
  word: Word;
  onClose: () => void;
  onSaved: (word: Word) => void;
  onDeleted: (word: Word) => void;
}) {
  const [surface, setSurface] = useState(word.surface);
  const [reading, setReading] = useState(word.reading);
  const [meaning, setMeaning] = useState(word.meaning_ko);
  const [day, setDay] = useState(word.study_day);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  const readingKana = normalizeReading(reading) || surface.trim();
  const showPreview = reading.trim().length > 0 && readingKana !== reading.trim();

  useEffect(() => {
    firstRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (busy) return;
    if (!surface.trim() || !meaning.trim()) {
      setErr("표기와 뜻은 비울 수 없습니다.");
      return;
    }
    if (hasNonKana(readingKana)) {
      setErr(`읽기에 가나가 아닌 문자가 남아 있습니다: ${readingKana}`);
      return;
    }
    setBusy(true);
    const res = await updateWordAction(word.id, {
      surface: surface.trim(),
      reading: readingKana,
      meaning_ko: meaning.trim(),
      study_day: day,
    });
    setBusy(false);
    if (res.ok) onSaved(res.word);
    else if (res.reason === "duplicate") setErr("같은 표기·읽기의 단어가 이미 있습니다.");
    else setErr("저장하지 못했습니다.");
  }

  async function remove() {
    if (busy) return;
    if (!confirm(`"${word.surface}" 를 삭제할까요? 복습 기록도 함께 사라집니다.`)) return;
    setBusy(true);
    await deleteWordAction(word.id);
    setBusy(false);
    onDeleted(word);
  }

  async function toggleSuspend() {
    if (busy) return;
    setBusy(true);
    await setSuspendedAction(word.id, !word.suspended);
    setBusy(false);
    onSaved({ ...word, suspended: !word.suspended });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-5 safe-b">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">단어 수정</h2>
          <button onClick={onClose} className="text-xs text-muted underline underline-offset-4">
            닫기 (Esc)
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">표기</span>
            <input
              ref={firstRef}
              value={surface}
              onChange={(e) => setSurface(e.target.value)}
              lang="ja"
              className="rounded-lg border border-border bg-bg px-3 py-2.5 text-xl outline-none focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">읽기 · 로마자로 써도 됩니다</span>
            <input
              value={reading}
              onChange={(e) => setReading(e.target.value)}
              onBlur={() => setReading(readingKana)}
              lang="ja"
              autoCapitalize="none"
              spellCheck={false}
              className="rounded-lg border border-border bg-bg px-3 py-2.5 text-xl outline-none focus:border-accent"
            />
            {showPreview && (
              <span className="text-sm">
                → <b lang="ja">{readingKana}</b>
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">뜻</span>
            <input
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
              lang="ko"
              className="rounded-lg border border-border bg-bg px-3 py-2.5 outline-none focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">학습일</span>
            <input
              type="date"
              value={day}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="rounded-lg border border-border bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent"
            />
          </label>
        </div>

        {err && <p className="mt-3 text-sm text-danger">{err}</p>}

        <p className="mt-3 text-xs text-muted tabular-nums">
          {stageLabel(word.stage)} · 다음 복습 {word.next_review} · 정답 {word.correct_count} /
          오답 {word.wrong_count} · 연속 {word.streak}
          {word.suspended && " · 보류됨"}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void save()}
            disabled={busy}
            className="flex-1 rounded-lg bg-accent px-4 py-3 font-semibold text-accent-fg disabled:opacity-50"
          >
            저장
          </button>
          <button
            onClick={() => void toggleSuspend()}
            disabled={busy}
            className="rounded-lg border border-border px-4 py-3 text-sm text-muted disabled:opacity-50"
          >
            {word.suspended ? "보류 해제" : "보류"}
          </button>
          <button
            onClick={() => void remove()}
            disabled={busy}
            className="rounded-lg border border-border px-4 py-3 text-sm text-danger disabled:opacity-50"
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}
