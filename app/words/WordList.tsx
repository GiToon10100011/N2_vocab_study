"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  deleteWordAction,
  searchWordsAction,
  setSuspendedAction,
  updateWordAction,
} from "@/lib/actions/words";
import { hasNonKana, normalizeReading } from "@/lib/kana";
import { isWeak, stageLabel } from "@/lib/srs";
import type { StudyDayGroup, Word } from "@/lib/types";
import type { WordFlag, WordStatus } from "@/lib/queries";

const STATUS: { key: WordStatus; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "new", label: "신규" },
  { key: "learning", label: "학습중" },
  { key: "review", label: "복습중" },
  { key: "stable", label: "안정" },
];

const FLAGS: { key: WordFlag; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "wrong", label: "오답노트" },
  { key: "weak", label: "취약" },
  { key: "suspended", label: "보류함" },
];

export function WordList({
  initial,
  initialTotal,
  days,
  initialFlag,
}: {
  initial: Word[];
  initialTotal: number;
  days: StudyDayGroup[];
  initialFlag: WordFlag;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<WordStatus>("all");
  const [flag, setFlag] = useState<WordFlag>(initialFlag);
  const [day, setDay] = useState("");
  const [rows, setRows] = useState<Word[]>(initial);
  const [total, setTotal] = useState(initialTotal);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const first = useRef(true);

  const reload = useCallback(() => {
    startTransition(async () => {
      const res = await searchWordsAction({
        q,
        status,
        flag,
        day: day || undefined,
        limit: 300,
      });
      setRows(res.rows);
      setTotal(res.total);
    });
  }, [q, status, flag, day]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(reload, 250);
    return () => clearTimeout(t);
  }, [reload]);

  const quizHref =
    flag === "wrong" ? "/study?filter=wrong" : flag === "weak" ? "/study?filter=weak" : null;

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">
          단어 목록 <span className="text-sm font-normal text-muted tabular-nums">{total}개</span>
        </h1>
        <nav className="flex gap-4 text-sm text-muted">
          <Link href="/add" className="underline underline-offset-4">
            + 추가
          </Link>
          <Link href="/" className="underline underline-offset-4">
            홈으로
          </Link>
        </nav>
      </header>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="한자 · 읽기 · 뜻 아무거나 검색"
        className="mt-5 w-full rounded-lg border border-border bg-surface px-4 py-3 outline-none focus:border-accent"
      />

      <div className="mt-3 flex flex-wrap gap-1.5">
        {FLAGS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFlag(f.key)}
            className={`rounded-full px-3 py-1 text-xs ${
              flag === f.key ? "bg-accent text-accent-fg" : "border border-border text-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="mx-1 w-px bg-border" />
        {STATUS.map((s) => (
          <button
            key={s.key}
            onClick={() => setStatus(s.key)}
            className={`rounded-full px-3 py-1 text-xs ${
              status === s.key ? "bg-fg text-bg" : "border border-border text-muted"
            }`}
          >
            {s.label}
          </button>
        ))}
        <select
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="rounded-full border border-border bg-surface px-2 py-1 text-xs text-muted"
        >
          <option value="">모든 학습일</option>
          {[...days].reverse().map((d) => (
            <option key={d.study_day} value={d.study_day}>
              {d.dayIndex}일차 ({d.study_day})
            </option>
          ))}
        </select>
      </div>

      {quizHref && total > 0 && (
        <Link
          href={quizHref}
          className="mt-4 block rounded-xl bg-accent px-5 py-3.5 text-center text-sm font-semibold text-accent-fg"
        >
          이 {total}개로 연습 퀴즈 · 복습 주기에는 영향 없음
        </Link>
      )}

      <ul className="mt-5 divide-y divide-border rounded-xl border border-border bg-surface">
        {rows.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-muted">
            {pending ? "불러오는 중…" : "해당하는 단어가 없습니다."}
          </li>
        )}
        {rows.map((w) =>
          editing === w.id ? (
            <EditRow
              key={w.id}
              word={w}
              onClose={() => setEditing(null)}
              onSaved={(next) => {
                setRows((r) => r.map((x) => (x.id === next.id ? next : x)));
                setEditing(null);
              }}
              onDeleted={() => {
                setRows((r) => r.filter((x) => x.id !== w.id));
                setTotal((t) => t - 1);
                setEditing(null);
              }}
            />
          ) : (
            <Row key={w.id} word={w} onEdit={() => setEditing(w.id)} />
          ),
        )}
      </ul>
    </main>
  );
}

function Row({ word: w, onEdit }: { word: Word; onEdit: () => void }) {
  const kanaOnly = w.surface === w.reading;
  const total = w.correct_count + w.wrong_count;
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
      <button onClick={onEdit} className="text-left text-xl" lang="ja">
        {w.surface}
      </button>
      {!kanaOnly && (
        <span className="text-sm text-muted" lang="ja">
          {w.reading}
        </span>
      )}
      <span className="text-sm">{w.meaning_ko}</span>

      <span className="ml-auto flex items-center gap-2 text-xs text-muted tabular-nums">
        {isWeak(w) && <span className="rounded bg-warn-bg px-1.5 py-0.5 text-warn">취약</span>}
        {w.suspended && <span className="rounded border border-border px-1.5 py-0.5">보류</span>}
        {w.wrong_count > 0 && (
          <span className="text-danger">
            ✕{w.wrong_count}
            {total > 0 && ` (${Math.round((w.correct_count / total) * 100)}%)`}
          </span>
        )}
        <span>{stageLabel(w.stage)}</span>
        <span>{w.next_review}</span>
        <button onClick={onEdit} className="underline underline-offset-4">
          수정
        </button>
      </span>
    </li>
  );
}

function EditRow({
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
