"use client";

import { useState } from "react";
import {
  deleteWordAction,
  setSuspendedAction,
  updateWordAction,
} from "@/lib/actions/words";
import { hasNonKana, normalizeReading } from "@/lib/kana";
import { stageLabel } from "@/lib/srs";
import type { Word } from "@/lib/types";

/**
 * 인라인 수정 행. 단어 목록과 "단어 추가"의 최근 목록에서 같이 쓴다.
 * 오타를 발견한 자리에서 바로 고칠 수 있어야 하므로 화면을 옮기지 않는다.
 */
export function WordEditRow({
  word,
  onClose,
  onSaved,
  onDeleted,
}: {
  word: Word;
  onClose: () => void;
  onSaved: (w: Word) => void;
  onDeleted: () => void;
}) {
  const [surface, setSurface] = useState(word.surface);
  const [reading, setReading] = useState(word.reading);
  const [meaning, setMeaning] = useState(word.meaning_ko);
  const [day, setDay] = useState(word.study_day);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const readingKana = normalizeReading(reading);

  async function save() {
    if (busy) return;
    if (hasNonKana(readingKana)) {
      setErr(`읽기에 가나가 아닌 문자가 남아 있습니다: ${readingKana}`);
      return;
    }
    setBusy(true);
    const res = await updateWordAction(word.id, {
      surface,
      reading: readingKana,
      meaning_ko: meaning,
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
    onDeleted();
  }

  async function toggleSuspend() {
    setBusy(true);
    await setSuspendedAction(word.id, !word.suspended);
    setBusy(false);
    onSaved({ ...word, suspended: !word.suspended });
  }

  return (
    <li className="bg-bg px-4 py-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
        <input
          value={surface}
          onChange={(e) => setSurface(e.target.value)}
          lang="ja"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-lg"
        />
        <input
          value={reading}
          onChange={(e) => setReading(e.target.value)}
          onBlur={() => setReading(readingKana)}
          lang="ja"
          autoCapitalize="none"
          spellCheck={false}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-lg"
        />
        <input
          value={meaning}
          onChange={(e) => setMeaning(e.target.value)}
          lang="ko"
          className="rounded-lg border border-border bg-surface px-3 py-2"
        />
        <input
          type="date"
          value={day}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2 py-2 text-sm"
        />
      </div>

      {readingKana !== reading && reading.trim() && (
        <p className="mt-2 text-sm">
          → <b lang="ja">{readingKana}</b>
        </p>
      )}
      {err && <p className="mt-2 text-sm text-danger">{err}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 font-semibold text-accent-fg disabled:opacity-50"
        >
          저장
        </button>
        <button onClick={onClose} className="rounded-lg border border-border px-4 py-2">
          취소
        </button>
        <button
          onClick={() => void toggleSuspend()}
          disabled={busy}
          className="rounded-lg border border-border px-4 py-2 text-muted"
        >
          {word.suspended ? "보류 해제" : "보류"}
        </button>
        <button
          onClick={() => void remove()}
          disabled={busy}
          className="ml-auto rounded-lg border border-border px-4 py-2 text-danger"
        >
          삭제
        </button>
      </div>

      <p className="mt-2 text-xs text-muted tabular-nums">
        {stageLabel(word.stage)} · 다음 복습 {word.next_review} · 정답 {word.correct_count} / 오답{" "}
        {word.wrong_count} · 연속 {word.streak}
      </p>
    </li>
  );
}
