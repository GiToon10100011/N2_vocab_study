"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { WordEditDialog } from "../WordEditDialog";
import { deleteWordAction, searchWordsAction } from "@/lib/actions/words";
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
  const [editing, setEditing] = useState<Word | null>(null);
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

  function removeLocally(id: string) {
    setRows((r) => r.filter((x) => x.id !== id));
    setTotal((t) => Math.max(0, t - 1));
  }

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
          aria-label="학습일로 거르기"
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
        {rows.map((w) => (
          <WordRow
            key={w.id}
            word={w}
            onEdit={() => setEditing(w)}
            onDeleted={() => removeLocally(w.id)}
          />
        ))}
      </ul>

      {editing && (
        <WordEditDialog
          word={editing}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setRows((r) => r.map((x) => (x.id === next.id ? next : x)));
            setEditing(null);
          }}
          onDeleted={(w) => {
            removeLocally(w.id);
            setEditing(null);
          }}
        />
      )}
    </main>
  );
}

export function WordRow({
  word: w,
  onEdit,
  onDeleted,
}: {
  word: Word;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const kanaOnly = w.surface === w.reading;
  const total = w.correct_count + w.wrong_count;

  async function remove() {
    if (busy) return;
    if (!confirm(`"${w.surface}" 를 삭제할까요? 복습 기록도 함께 사라집니다.`)) return;
    setBusy(true);
    await deleteWordAction(w.id);
    setBusy(false);
    onDeleted();
  }

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
        <button
          onClick={() => void remove()}
          disabled={busy}
          className="text-danger underline underline-offset-4 disabled:opacity-40"
        >
          삭제
        </button>
      </span>
    </li>
  );
}
