"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PasteForm } from "./PasteForm";
import { WordEditDialog } from "../WordEditDialog";
import { deleteWordAction } from "@/lib/actions/words";
import { addWordAction, lookupSurfaceAction } from "@/lib/actions/words";
import {
  composedReading,
  hasNonKana,
  isAllKana,
  normalizeReading,
  toKatakanaReading,
} from "@/lib/kana";
import { addDays, diffDays, stageLabel } from "@/lib/srs";
import type { StudyDayGroup, Word } from "@/lib/types";

type Field = "surface" | "reading" | "meaning";

interface Entry {
  word: Word;
  /** 이미 있던 단어라 뜻만 갱신된 경우 */
  merged: boolean;
}

/** 선택한 날짜가 몇 일차 / 몇 주차인지, 그 날에 몇 개가 들어있는지. */
function describeDay(days: StudyDayGroup[], date: string) {
  const known = days.map((d) => d.study_day);
  const all = known.includes(date) ? known : [...known, date].sort();
  return {
    dayIndex: all.indexOf(date) + 1,
    weekIndex: Math.floor(diffDays(date, all[0]) / 7) + 1,
    total: days.find((d) => d.study_day === date)?.total ?? 0,
  };
}

export function AddForm({
  initialRecent,
  initialDays,
  today,
}: {
  initialRecent: Word[];
  initialDays: StudyDayGroup[];
  today: string;
}) {
  const [studyDay, setStudyDay] = useState(today);
  const [days, setDays] = useState<StudyDayGroup[]>(initialDays);
  const [surface, setSurface] = useState("");
  const [reading, setReading] = useState(""); // 친 그대로 둔다. 확정 변환은 칸을 떠날 때 한 번만.
  const [meaning, setMeaning] = useState("");
  const [recent, setRecent] = useState<Entry[]>(
    initialRecent.map((word) => ({ word, merged: false })),
  );
  const [tab, setTab] = useState<"one" | "paste">("one");
  const [editing, setEditing] = useState<Word | null>(null);
  /** 표기 칸이 IME 조합 중인가. 조합 중에는 값이 가나라서 "가나 전용 단어"로 오판하면 안 된다. */
  const [composingSurface, setComposingSurface] = useState(false);
  /** 한자 확정 후 읽기를 자동으로 채웠는가. 확인이 필요하다는 표시에 쓴다. */
  const [guessed, setGuessed] = useState(false);
  const [dupes, setDupes] = useState<Word[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const surfaceRef = useRef<HTMLInputElement>(null);
  const readingRef = useRef<HTMLInputElement>(null);
  const meaningRef = useRef<HTMLInputElement>(null);

  // IME 조합 중에 눌린 Enter 는 "변환 확정"이므로 필드 이동에 쓰면 안 된다.
  const composing = useRef(false);
  /** 조합 중 표기 칸에 떠 있던 마지막 가나. 변환 직전 상태가 곧 읽기다. */
  const kanaGuess = useRef("");
  /** 한 단어를 여러 번 조합해 입력하는 경우를 위해 누적한다(普 + 及). */
  const accumKana = useRef("");
  /** 사용자가 읽기 칸을 직접 건드렸으면 자동 채움을 멈춘다. */
  const readingTouched = useRef(false);

  const focus = (f: Field) => {
    const el = f === "surface" ? surfaceRef : f === "reading" ? readingRef : meaningRef;
    el.current?.focus();
  };

  // 표기가 전부 가나인 단어(きっかけ, バランス)는 읽기가 표기와 같을 수밖에 없다.
  // 추정하지 않고 확정한다.
  // 조합이 끝난 뒤에만 "표기가 가나뿐인 단어"로 판정한다.
  const surfaceIsKana = !composingSurface && isAllKana(surface.trim());
  const readingKana = surfaceIsKana ? surface.trim() : normalizeReading(reading);
  const showPreview = !surfaceIsKana && reading.trim().length > 0 && readingKana !== reading.trim();

  /** 목록에서 빼고 그 학습일의 개수도 줄인다. */
  function removeFromRecent(w: Word) {
    setRecent((r) => r.filter((e) => e.word.id !== w.id));
    setDays((prev) =>
      prev.map((g) =>
        g.study_day === w.study_day ? { ...g, total: Math.max(0, g.total - 1) } : g,
      ),
    );
  }

  const reset = useCallback(() => {
    setSurface("");
    setReading("");
    setMeaning("");
    setDupes([]);
    setGuessed(false);
    kanaGuess.current = "";
    accumKana.current = "";
    readingTouched.current = false;
    focus("surface");
  }, []);

  const save = useCallback(async () => {
    if (saving) return;
    const s = surface.trim();
    const m = meaning.trim();
    if (!s || !readingKana || !m) {
      setError("세 칸을 모두 채워주세요.");
      return;
    }
    // 로마자가 남아 있으면 저장하지 않는다. 틀린 읽기는 없는 것보다 나쁘다.
    if (hasNonKana(readingKana)) {
      setError(`읽기에 가나가 아닌 문자가 남아 있습니다: ${readingKana}`);
      focus("reading");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await addWordAction({
        surface: s,
        reading: readingKana,
        meaning_ko: m,
        studyDay,
      });
      if (res.ok) {
        const entry = { word: res.word, merged: res.merged };
        setRecent((r) => [entry, ...r.filter((e) => e.word.id !== res.word.id)].slice(0, 30));
        if (!res.merged) {
          const d = res.word.study_day;
          setDays((prev) =>
            prev.some((g) => g.study_day === d)
              ? prev.map((g) => (g.study_day === d ? { ...g, total: g.total + 1 } : g))
              : [
                  ...prev,
                  { study_day: d, dayIndex: 0, weekIndex: 0, total: 1, dueToday: 0, newCount: 1 },
                ].sort((a, b) => a.study_day.localeCompare(b.study_day)),
          );
        }
        reset();
      } else {
        setError("입력값을 확인해주세요.");
      }
    } catch {
      setError("저장에 실패했습니다. 네트워크를 확인해주세요.");
    } finally {
      setSaving(false);
    }
  }, [surface, readingKana, meaning, saving, reset, studyDay]);

  // 표기를 입력하는 동안 중복을 미리 알려준다.
  useEffect(() => {
    const s = surface.trim();
    const t = setTimeout(() => {
      if (s.length === 0) {
        setDupes([]);
        return;
      }
      lookupSurfaceAction(s)
        .then(setDupes)
        .catch(() => setDupes([]));
    }, 350);
    return () => clearTimeout(t);
  }, [surface]);

  function onEnter(e: React.KeyboardEvent<HTMLInputElement>, next: Field | "submit") {
    if (e.key !== "Enter") return;
    if (e.nativeEvent.isComposing || composing.current) return;
    e.preventDefault();
    if (next === "submit") {
      void save();
      return;
    }
    // 읽기 칸을 떠날 때 로마자를 가나로 확정한다.
    if (next === "meaning") setReading(readingKana);
    focus(next);
  }

  const dayInfo = describeDay(days, studyDay);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">단어 추가</h1>
        <nav className="flex gap-4 text-sm text-muted">
          <Link href="/words" className="underline underline-offset-4">
            단어 목록
          </Link>
          <Link href="/" className="underline underline-offset-4">
            홈으로
          </Link>
        </nav>
      </header>

      <section className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3">
        <span className="text-sm text-muted">학습일</span>
        <input
          type="date"
          value={studyDay}
          onChange={(e) => e.target.value && setStudyDay(e.target.value)}
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm"
        />
        <button
          onClick={() => setStudyDay(today)}
          className={`rounded-md px-2 py-1 text-xs ${
            studyDay === today ? "bg-accent text-accent-fg" : "border border-border"
          }`}
        >
          오늘
        </button>
        <button
          onClick={() => setStudyDay(addDays(today, -1))}
          className={`rounded-md px-2 py-1 text-xs ${
            studyDay === addDays(today, -1) ? "bg-accent text-accent-fg" : "border border-border"
          }`}
        >
          어제
        </button>
        <span className="ml-auto text-sm tabular-nums">
          <b>{dayInfo.dayIndex}일차</b>
          <span className="text-muted">
            {" · "}
            {dayInfo.weekIndex}주차 · 이 날 {dayInfo.total}개
          </span>
        </span>
      </section>

      <div className="mt-4 flex gap-1.5">
        {(
          [
            ["one", "한 개씩"],
            ["paste", "여러 개 붙여넣기"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-full px-4 py-1.5 text-sm ${
              tab === key ? "bg-fg text-bg" : "border border-border text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "paste" ? (
        <PasteForm
          studyDay={studyDay}
          onDone={(n) => {
            setDays((prev) =>
              prev.some((g) => g.study_day === studyDay)
                ? prev.map((g) =>
                    g.study_day === studyDay ? { ...g, total: g.total + n } : g,
                  )
                : [
                    ...prev,
                    {
                      study_day: studyDay,
                      dayIndex: 0,
                      weekIndex: 0,
                      total: n,
                      dueToday: 0,
                      newCount: n,
                    },
                  ].sort((a, b) => a.study_day.localeCompare(b.study_day)),
            );
          }}
        />
      ) : (
      <div className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-muted">표기 (일본어 IME)</span>
          <input
            ref={surfaceRef}
            autoFocus
            value={surface}
            lang="ja"
            className="jp-md rounded-lg border border-border bg-surface px-4 py-3 outline-none focus:border-accent"
            onChange={(e) => {
              const v = e.target.value;
              setSurface(v);
              // 조합 중 값이 전부 가나면 그게 변환 전 읽기다. e.data 는 한 박자 늦게 오므로
              // 이벤트 데이터 대신 실제 입력값을 본다.
              if (composing.current && isAllKana(v)) kanaGuess.current = v;
              if (v === "") {
                kanaGuess.current = "";
                accumKana.current = "";
              }
            }}
            onCompositionStart={() => {
              composing.current = true;
              setComposingSurface(true);
            }}
            onCompositionEnd={(e) => {
              composing.current = false;
              setComposingSurface(false);
              const suggestion = composedReading(kanaGuess.current, e.currentTarget.value);
              kanaGuess.current = "";
              if (suggestion) {
                // 한 단어를 여러 번 조합해 넣는 경우(普 + 及)를 위해 이어 붙인다.
                accumKana.current += suggestion;
                if (!readingTouched.current) {
                  setReading(accumKana.current);
                  setGuessed(true);
                }
              }
            }}
            onKeyDown={(e) => onEnter(e, surfaceIsKana ? "meaning" : "reading")}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2 text-sm text-muted">
            읽기
            {surfaceIsKana ? (
              <span className="rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn">
                가나 단어 · 표기와 같게 자동 확정
              </span>
            ) : guessed ? (
              <span className="rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn">
                입력한 가나에서 자동 추정 · 맞는지 확인하세요
              </span>
            ) : (
              <span className="text-xs">로마자로 치세요 · fukyuu → ふきゅう</span>
            )}
          </span>
          <input
            ref={readingRef}
            value={surfaceIsKana ? surface.trim() : reading}
            readOnly={surfaceIsKana}
            lang="ja"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className={`jp-md rounded-lg border bg-surface px-4 py-3 outline-none focus:border-accent ${
              surfaceIsKana ? "border-border text-muted" : "border-border"
            }`}
            onChange={(e) => {
              readingTouched.current = true;
              setGuessed(false);
              setReading(e.target.value);
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onBlur={() => !surfaceIsKana && setReading(readingKana)}
            onKeyDown={(e) => onEnter(e, "meaning")}
          />
          {showPreview && (
            <span className="flex items-center gap-2 text-sm">
              <span className="text-muted">→</span>
              <b className="jp-md" lang="ja">
                {readingKana}
              </b>
              <button
                type="button"
                onClick={() => setReading(toKatakanaReading(reading))}
                className="rounded-md border border-border px-2 py-0.5 text-xs text-muted"
              >
                가타카나로
              </button>
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-muted">
            뜻 (한국어 IME) <span className="text-xs">· 여러 개면 쉼표로 구분</span>
          </span>
          <input
            ref={meaningRef}
            value={meaning}
            lang="ko"
            className="rounded-lg border border-border bg-surface px-4 py-3 text-xl outline-none focus:border-accent"
            onChange={(e) => setMeaning(e.target.value)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(e) => onEnter(e, "submit")}
          />
        </label>

        <p className="text-xs text-muted">
          Enter = 다음 칸 · 마지막 칸에서 Enter = 저장하고 첫 칸으로
        </p>

        {dupes.length > 0 && (
          <div className="rounded-lg bg-warn-bg px-4 py-3 text-sm text-warn">
            {dupes.map((d) => (
              <div key={d.id}>
                이미 있음 · {d.surface} {d.reading} {d.meaning_ko} ({stageLabel(d.stage)}, 다음
                복습 {d.next_review})
              </div>
            ))}
            <div className="mt-1 text-xs opacity-80">
              같은 표기·읽기로 저장하면 진도는 그대로 두고 뜻만 갱신됩니다.
            </div>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          onClick={() => void save()}
          disabled={saving}
          className="rounded-xl bg-accent px-6 py-4 text-base font-semibold text-accent-fg disabled:opacity-50"
        >
          저장
        </button>
      </div>
      )}

      <section className="mt-12">
        <h2 className="text-sm text-muted">
          최근 추가 {recent.length}개
        </h2>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
          {recent.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">아직 없습니다.</li>
          )}
          {recent.map(({ word: w, merged }) => (
            <RecentRow
              key={w.id}
              word={w}
              merged={merged}
              onEdit={() => setEditing(w)}
              onDeleted={() => removeFromRecent(w)}
            />
          ))}
        </ul>
      </section>

      {editing && (
        <WordEditDialog
          word={editing}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setRecent((r) => r.map((e) => (e.word.id === next.id ? { ...e, word: next } : e)));
            setEditing(null);
          }}
          onDeleted={(w) => {
            removeFromRecent(w);
            setEditing(null);
          }}
        />
      )}
    </main>
  );
}

/** 최근 추가 목록의 한 줄. 수정은 모달로, 삭제는 여기서 바로. */
function RecentRow({
  word: w,
  merged,
  onEdit,
  onDeleted,
}: {
  word: Word;
  merged: boolean;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (busy) return;
    if (!confirm(`"${w.surface}" 를 삭제할까요? 복습 기록도 함께 사라집니다.`)) return;
    setBusy(true);
    await deleteWordAction(w.id);
    setBusy(false);
    onDeleted();
  }

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
      <button onClick={onEdit} className="text-left text-xl" lang="ja">
        {w.surface}
      </button>
      {w.surface !== w.reading && (
        <span className="text-sm text-muted" lang="ja">
          {w.reading}
        </span>
      )}
      <span className="text-sm">{w.meaning_ko}</span>
      {merged && (
        <span className="rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn">뜻 갱신</span>
      )}

      <span className="ml-auto flex items-center gap-3 text-xs text-muted tabular-nums">
        <span>{w.study_day}</span>
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
