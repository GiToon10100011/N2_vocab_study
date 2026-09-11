"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toKana } from "wanakana";
import { addWordAction, lookupSurfaceAction } from "@/lib/actions/words";
import { hasNonKana, isAllKana } from "@/lib/kana";
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
  const [reading, setReading] = useState("");
  const [meaning, setMeaning] = useState("");
  const [recent, setRecent] = useState<Entry[]>(
    initialRecent.map((word) => ({ word, merged: false })),
  );
  const [dupes, setDupes] = useState<Word[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoFilled, setAutoFilled] = useState(false);

  const surfaceRef = useRef<HTMLInputElement>(null);
  const readingRef = useRef<HTMLInputElement>(null);
  const meaningRef = useRef<HTMLInputElement>(null);

  // IME 조합 중에 눌린 Enter 는 "변환 확정"이므로 필드 이동에 쓰면 안 된다.
  const composing = useRef(false);
  // 표기 칸에서 변환 전에 지나간 가나를 모아 읽기 칸 제안으로 쓴다.
  const curKana = useRef("");
  const accumKana = useRef("");
  // 사용자가 읽기 칸을 직접 건드렸으면 자동 채움을 하지 않는다.
  const readingTouched = useRef(false);

  // 이벤트 핸들러에서만 호출된다(렌더 중 ref 접근 아님).
  const focus = (f: Field) => {
    const el =
      f === "surface" ? surfaceRef : f === "reading" ? readingRef : meaningRef;
    el.current?.focus();
  };

  const reset = useCallback(() => {
    setSurface("");
    setReading("");
    setMeaning("");
    setDupes([]);
    setAutoFilled(false);
    curKana.current = "";
    accumKana.current = "";
    readingTouched.current = false;
    focus("surface");
  }, []);

  const save = useCallback(
    async () => {
      if (saving) return;
      if (!surface.trim() || !reading.trim() || !meaning.trim()) {
        setError("세 칸을 모두 채워주세요.");
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const res = await addWordAction({
          surface,
          reading,
          meaning_ko: meaning,
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
                : [...prev, { study_day: d, dayIndex: 0, weekIndex: 0, total: 1, dueToday: 0, newCount: 1 }].sort((a, b) =>
                    a.study_day.localeCompare(b.study_day),
                  ),
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
    },
    [surface, reading, meaning, saving, reset, studyDay],
  );

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
    if (next === "submit") void save();
    else focus(next);
  }

  const readingWarn = hasNonKana(reading);
  const dayInfo = describeDay(days, studyDay);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">단어 추가</h1>
        <Link href="/" className="text-sm text-muted underline underline-offset-4">
          홈으로
        </Link>
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
              setSurface(e.target.value);
              if (e.target.value === "") {
                accumKana.current = "";
                curKana.current = "";
              }
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionUpdate={(e) => {
              // 변환 전 가나(かんきょう)를 붙잡아 둔다. 변환 후에는 한자가 들어오므로 걸러진다.
              if (isAllKana(e.data)) curKana.current = e.data;
            }}
            onCompositionEnd={() => {
              composing.current = false;
              if (curKana.current) {
                accumKana.current += curKana.current;
                curKana.current = "";
                if (!readingTouched.current) {
                  setReading(accumKana.current);
                  setAutoFilled(true);
                }
              }
            }}
            onKeyDown={(e) => onEnter(e, "reading")}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-muted">
            읽기{" "}
            <span className="text-xs">
              (로마자로 쳐도 가나로 바뀝니다 · kankyou → かんきょう)
            </span>
          </span>
          <input
            ref={readingRef}
            value={reading}
            lang="ja"
            className={`jp-md rounded-lg border bg-surface px-4 py-3 outline-none focus:border-accent ${
              readingWarn ? "border-warn" : "border-border"
            } ${autoFilled ? "text-muted" : ""}`}
            onChange={(e) => {
              readingTouched.current = true;
              setAutoFilled(false);
              const v = e.target.value;
              setReading(composing.current ? v : toKana(v, { IMEMode: true }));
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={(e) => {
              composing.current = false;
              setReading(e.currentTarget.value);
            }}
            onFocus={() => {
              if (autoFilled) setAutoFilled(false);
            }}
            onKeyDown={(e) => onEnter(e, "meaning")}
          />
          {readingWarn && (
            <span className="text-xs text-warn">가나가 아닌 문자가 섞여 있습니다.</span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-muted">뜻 (한국어 IME)</span>
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
                이미 있음 · {d.surface} {d.reading} {d.meaning_ko} ({stageLabel(d.stage)},{" "}
                다음 복습 {d.next_review})
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

      <section className="mt-12">
        <h2 className="text-sm text-muted">최근 추가 {recent.length}개</h2>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
          {recent.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">아직 없습니다.</li>
          )}
          {recent.map(({ word: w, merged }) => (
            <li key={w.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5">
              <span className="text-xl" lang="ja">
                {w.surface}
              </span>
              <span className="text-sm text-muted" lang="ja">
                {w.reading}
              </span>
              <span className="text-sm">{w.meaning_ko}</span>
              <span className="text-xs text-muted tabular-nums">{w.study_day}</span>
              {merged && (
                <span className="ml-auto rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn">
                  이미 있던 단어 · 뜻 갱신
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
