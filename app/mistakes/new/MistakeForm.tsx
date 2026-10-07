"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { addMistakeAction } from "@/lib/actions/mistakes";
import {
  MISTAKE_CATEGORIES,
  MISTAKE_REF_MAX,
  MISTAKE_SOURCES,
  MISTAKE_SOURCE_LABEL,
  MISTAKE_TEXT_MAX,
  validateMistake,
  type Mistake,
  type MistakeInvalid,
  type MistakeSource,
} from "@/lib/mistakes";
import { addDays } from "@/lib/srs";

/** 칸 순서는 Obsidian 「오답 보고 형식」과 같다. Enter 체인도 이 순서로 흐른다. */
const FIELDS = [
  { key: "ref", label: "문항 번호", hint: "12, Part A-3 처럼 자유롭게", lang: undefined },
  { key: "question", label: "선택지", hint: "또는 문제 요약", lang: "ja" },
  { key: "chosen", label: "고른 답", hint: "", lang: "ja" },
  { key: "answer", label: "정답", hint: "", lang: "ja" },
  { key: "why", label: "왜 틀렸다고 생각하는지", hint: "한 줄", lang: "ko" },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];

const EMPTY: Record<FieldKey, string> = { ref: "", question: "", chosen: "", answer: "", why: "" };

const ERROR_TEXT: Record<MistakeInvalid, string> = {
  source: "출처를 골라주세요.",
  category: "분류를 골라주세요.",
  empty: "문항 번호나 내용을 한 칸 이상 적어주세요.",
  too_long: `너무 깁니다. 문항 번호는 ${MISTAKE_REF_MAX}자, 나머지 칸은 ${MISTAKE_TEXT_MAX}자까지입니다.`,
};

export function MistakeForm({
  today,
  initialSource,
  initialRef,
}: {
  today: string;
  initialSource: MistakeSource;
  initialRef: string;
}) {
  const [studyDay, setStudyDay] = useState(today);
  const [source, setSource] = useState<MistakeSource>(initialSource);
  const [values, setValues] = useState({ ...EMPTY, ref: initialRef });
  const [category, setCategory] = useState("");
  /** 이 화면에서 방금 적은 것. 저장됐는지 눈으로 확인하는 용도이고 목록 화면을 대신하지 않는다. */
  const [saved, setSaved] = useState<Mistake[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputs = useRef<Partial<Record<FieldKey, HTMLInputElement | null>>>({});
  const categoryRef = useRef<HTMLSelectElement>(null);
  // IME 조합 중에 눌린 Enter 는 "변환 확정"이므로 칸 이동에 쓰면 안 된다.
  const composing = useRef(false);

  async function save() {
    if (saving) return;
    // 분류는 select 에서 직접 읽는다. Enter 로 저장할 때 state 가 한 박자 늦을 수 있다(아래 참고).
    const input = { source, category: categoryRef.current?.value ?? category, ...values };
    const checked = validateMistake(input);
    if (!checked.ok) {
      setError(ERROR_TEXT[checked.reason]);
      if (checked.reason === "category") categoryRef.current?.focus();
      else inputs.current.ref?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await addMistakeAction({ ...input, studyDay });
      if (!res.ok) {
        setError(ERROR_TEXT[res.reason]);
        return;
      }
      setSaved((s) => [res.mistake, ...s]);
      // 출처와 문항 번호는 남긴다. 같은 회차를 이어서 적으므로 번호 끝만 고치면 된다.
      setValues({ ...EMPTY, ref: res.mistake.ref ?? "" });
      // 분류는 문항마다 새로 판단해야 하므로 비운다.
      setCategory("");
      const ref = inputs.current.ref;
      if (ref) {
        ref.focus();
        ref.setSelectionRange(ref.value.length, ref.value.length);
      }
    } catch {
      setError("저장에 실패했습니다. 네트워크를 확인해주세요.");
    } finally {
      setSaving(false);
    }
  }

  function onEnter(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key !== "Enter") return;
    // Safari 는 조합을 확정하는 Enter 를 compositionend 뒤에 보내서 isComposing 으로는
    // 걸러지지 않는다. 그 키는 keyCode 가 229 다.
    if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229) return;
    e.preventDefault();
    const next = FIELDS[index + 1];
    if (next) inputs.current[next.key]?.focus();
    else categoryRef.current?.focus();
  }

  function field(index: number) {
    const f = FIELDS[index];
    return (
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm text-muted">
          {f.label}
          {f.hint && <span className="text-xs"> · {f.hint}</span>}
        </span>
        <input
          ref={(el) => {
            inputs.current[f.key] = el;
          }}
          autoFocus={index === 0}
          value={values[f.key]}
          lang={f.lang}
          maxLength={f.key === "ref" ? MISTAKE_REF_MAX : MISTAKE_TEXT_MAX}
          enterKeyHint="next"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="min-w-0 rounded-lg border border-border bg-surface px-4 py-3 text-lg outline-none focus:border-accent"
          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(e) => onEnter(e, index)}
        />
      </label>
    );
  }

  const last = saved[0];

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">오답 기록</h1>
        <nav className="flex gap-4 text-sm text-muted">
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
          aria-label="학습일"
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => setStudyDay(today)}
          className={`rounded-md px-2 py-1 text-xs ${
            studyDay === today ? "bg-accent text-accent-fg" : "border border-border"
          }`}
        >
          오늘
        </button>
        <button
          type="button"
          onClick={() => setStudyDay(addDays(today, -1))}
          className={`rounded-md px-2 py-1 text-xs ${
            studyDay === addDays(today, -1) ? "bg-accent text-accent-fg" : "border border-border"
          }`}
        >
          어제
        </button>
      </section>

      <div role="group" aria-label="출처" className="mt-4 flex gap-1.5">
        {MISTAKE_SOURCES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={source === s}
            onClick={() => setSource(s)}
            className={`rounded-full px-4 py-2 text-sm ${
              source === s ? "bg-fg text-bg" : "border border-border text-muted"
            }`}
          >
            {MISTAKE_SOURCE_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {field(0)}
        {field(1)}
        <div className="grid grid-cols-2 gap-3">
          {field(2)}
          {field(3)}
        </div>
        {field(4)}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-muted">
            분류 <span className="text-xs">· 7종 중 하나</span>
          </span>
          <select
            ref={categoryRef}
            value={category}
            className="rounded-lg border border-border bg-surface px-3 py-3 text-base outline-none focus:border-accent"
            onChange={(e) => setCategory(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              // 기본 동작을 막지 않고 한 박자 뒤에 저장한다. 목록을 연 채 Enter 로 고르는
              // 브라우저에서는 이 Enter 가 선택 확정이기도 해서, 막으면 고른 값이 버려진다.
              setTimeout(() => void save(), 0);
            }}
          >
            <option value="">분류 선택</option>
            {MISTAKE_CATEGORIES.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} — {c.when}
              </option>
            ))}
          </select>
        </label>

        {/* 고르기 전에 읽을 수 있도록 항상 펼쳐 둔다. 모바일의 선택 목록은 긴 설명을 잘라낸다. */}
        <dl className="flex flex-col gap-1 text-xs">
          {MISTAKE_CATEGORIES.map((c) => (
            <div key={c.name} className="flex gap-2">
              <dt
                className={`w-24 shrink-0 ${
                  category === c.name ? "font-semibold text-fg" : "text-muted"
                }`}
              >
                {c.name}
              </dt>
              <dd className={category === c.name ? "text-fg" : "text-muted"}>{c.when}</dd>
            </div>
          ))}
        </dl>

        <p className="text-xs text-muted">Enter = 다음 칸 · 분류에서 Enter = 저장하고 문항 번호로</p>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-xl bg-accent px-6 py-4 text-base font-semibold text-accent-fg disabled:opacity-50"
        >
          저장
        </button>

        <p role="status" className="min-h-5 text-sm text-accent">
          {last && !error
            ? `저장했습니다 · ${MISTAKE_SOURCE_LABEL[last.source]}${last.ref ? ` ${last.ref}` : ""} · ${last.category}`
            : ""}
        </p>
      </div>

      {saved.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm text-muted">방금 적은 오답 {saved.length}건</h2>
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
            {saved.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="text-sm text-muted">
                  {MISTAKE_SOURCE_LABEL[m.source]}
                  {m.ref ? ` · ${m.ref}` : ""}
                </span>
                <span className="rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn">
                  {m.category}
                </span>
                <span className="min-w-0 text-sm">{m.why ?? m.answer ?? m.question ?? m.chosen}</span>
                <span className="ml-auto text-xs text-muted tabular-nums">{m.study_day}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
