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
  isBlankMistake,
  joinChoices,
  splitChoices,
  validateMistake,
  type Mistake,
  type MistakeInvalid,
  type MistakeSource,
} from "@/lib/mistakes";
import { saveStudyRangeAction } from "@/lib/actions/study-ranges";
import { addDays } from "@/lib/srs";
import {
  RANGE_SKIPPED_TEXT,
  STUDY_RANGE_MAX,
  draftStudyRange,
  planFormSave,
  validateStudyRange,
  type StudyRange,
  type StudyRangeInvalid,
} from "@/lib/study-ranges";

/**
 * 칸 순서는 Obsidian 「오답 보고 형식」과 같다. Enter 체인도 이 순서로 흐른다.
 * 선택지는 개수가 문항마다 달라 목록으로 따로 받고, 문항 번호와 고른 답 사이에 낀다.
 */
const FIELDS = [
  { key: "ref", label: "문항 번호", hint: "12, Part A-3 처럼 자유롭게", lang: undefined },
  { key: "chosen", label: "고른 답", hint: "", lang: "ja" },
  { key: "answer", label: "정답", hint: "", lang: "ja" },
  { key: "why", label: "왜 틀렸다고 생각하는지", hint: "한 줄", lang: "ko" },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];

const EMPTY: Record<FieldKey, string> = { ref: "", chosen: "", answer: "", why: "" };

/** 선택지 한 줄. id 는 가운데 줄을 지워도 다른 줄의 입력이 섞이지 않게 하는 열쇠다. */
interface ChoiceRow {
  id: number;
  text: string;
}

const ERROR_TEXT: Record<MistakeInvalid, string> = {
  source: "출처를 골라주세요.",
  category: "분류를 골라주세요.",
  empty: "문항 번호나 내용을 한 칸 이상 적어주세요.",
  too_long: `너무 깁니다. 문항 번호는 ${MISTAKE_REF_MAX}자, 나머지 칸은 ${MISTAKE_TEXT_MAX}자까지입니다.`,
};

const RANGE_ERROR_TEXT: Record<StudyRangeInvalid, string> = {
  source: "출처를 골라주세요.",
  number: `시작 번호와 끝 번호를 1~${STUDY_RANGE_MAX} 사이의 숫자로 적어주세요.`,
  order: "끝 번호가 시작 번호보다 앞입니다.",
};

export function MistakeForm({
  today,
  initialSource,
  initialRef,
  initialRanges,
}: {
  today: string;
  initialSource: MistakeSource;
  initialRef: string;
  /** 최근에 적은 풀이 범위. 표가 아직 없는 DB 에서는 null 이고, 그때는 범위 칸을 감춘다. */
  initialRanges: StudyRange[] | null;
}) {
  const [studyDay, setStudyDay] = useState(today);
  const [source, setSource] = useState<MistakeSource>(initialSource);
  const [ranges, setRanges] = useState(initialRanges);
  /** 범위 칸에 친 그대로. 학습일이나 출처를 바꾸면 그 날 그 교재의 것으로 다시 채운다. */
  const [range, setRange] = useState(() =>
    draftStudyRange(initialRanges ?? [], initialSource, today),
  );
  const [rangeError, setRangeError] = useState<string | null>(null);
  /** 오답은 저장했는데 범위는 저장하지 않았을 때 그 이유. 오류가 아니라 알림이다. */
  const [rangeNote, setRangeNote] = useState<string | null>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState({ ...EMPTY, ref: initialRef });
  const [choices, setChoices] = useState<ChoiceRow[]>([{ id: 0, text: "" }]);
  const [category, setCategory] = useState("");
  /** 이 화면에서 방금 적은 것. 저장됐는지 눈으로 확인하는 용도이고 목록 화면을 대신하지 않는다. */
  const [saved, setSaved] = useState<Mistake[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 칸에 이어받아 채워 둔 문항 번호. 이 번호 그대로이고 분류도 안 골랐다면 오답을 적는 중이 아니다 —
   * 번호만 남은 채로 범위를 저장하려는 것이다.
   */
  const carriedRef = useRef(initialRef);
  const inputs = useRef<Partial<Record<FieldKey, HTMLInputElement | null>>>({});
  const categoryRef = useRef<HTMLSelectElement>(null);
  const choiceInputs = useRef(new Map<number, HTMLInputElement>());
  const addChoiceRef = useRef<HTMLButtonElement>(null);
  const nextChoiceId = useRef(1);
  /** 방금 만든 줄. 화면에 붙는 순간 커서를 옮긴다. */
  const focusChoice = useRef<number | null>(null);
  // IME 조합 중에 눌린 Enter 는 "변환 확정"이므로 칸 이동에 쓰면 안 된다.
  const composing = useRef(false);

  /**
   * 저장 버튼 하나가 오답과 풀이 범위를 함께 다룬다(무엇을 저장할지는 planFormSave 가 정한다).
   * 둘은 따로 실패할 수 있다. 오답이 먼저 저장되고 범위가 실패하면 오답은 남고 범위만 다시 누르면 된다 —
   * 저장된 오답 칸은 비워지므로 다시 눌러도 오답은 두 번 가지 않는다.
   */
  async function save() {
    if (saving) return;
    // 분류는 select 에서 직접 읽는다. Enter 로 저장할 때 state 가 한 박자 늦을 수 있다(아래 참고).
    const input = {
      source,
      category: categoryRef.current?.value ?? category,
      ...values,
      question: joinChoices(choices.map((c) => c.text)),
    };
    // 표가 없는 DB 에서는 범위 칸이 없으므로 범위를 다루지 않는다.
    const rangeText = ranges ? range : { from: "", to: "" };
    // 분류를 골랐다면 오답을 적으려는 것이다. 문항 번호는 직전 오답에서 이어받아 채워져 있을 뿐이다.
    const plan = planFormSave({
      mistakeBlank: !input.category && isBlankMistake(input, carriedRef.current),
      ...rangeText,
    });

    // 범위를 검증한다. 이미 저장된 같은 값은 다시 보내지 않는다.
    let rangeToSave: { from_no: number; to_no: number } | null = null;
    let rangeInvalid: StudyRangeInvalid | null = null;
    if (plan.range) {
      const checked = validateStudyRange({ source, ...rangeText });
      if (!checked.ok) rangeInvalid = checked.reason;
      else if (
        !(ranges ?? []).some(
          (r) =>
            r.source === source &&
            r.study_day === studyDay &&
            r.from_no === checked.value.from_no &&
            r.to_no === checked.value.to_no,
        )
      ) {
        rangeToSave = checked.value;
      }
    }

    setRangeError(null);
    setRangeNote(null);

    // 범위만 저장하려는데 보낼 것이 없다(이미 저장된 값 그대로다). 오답 칸을 비워 두고 누른 것과 같으니
    // 예전 오답 저장이 하던 대로 빈 칸을 알린다.
    const saveMistake = plan.mistake || (rangeToSave === null && rangeInvalid === null);
    if (saveMistake) {
      const checked = validateMistake(input);
      if (!checked.ok) {
        // 오답이 저장되지 않으면 범위도 보내지 않는다. 오답 없이 범위만 따로 저장되어 어긋나지 않게.
        setError(ERROR_TEXT[checked.reason]);
        if (checked.reason === "category") categoryRef.current?.focus();
        else inputs.current.ref?.focus();
        return;
      }
    } else if (rangeInvalid) {
      setError(null);
      setRangeError(RANGE_ERROR_TEXT[rangeInvalid]);
      // 시작 번호는 채워져 있는 경우가 많다. 비어 있을 때만 그쪽으로 간다.
      (range.from.trim() === "" ? fromRef : toRef).current?.focus();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (saveMistake) {
        try {
          const res = await addMistakeAction({ ...input, studyDay });
          if (!res.ok) {
            setError(ERROR_TEXT[res.reason]);
            return;
          }
          setSaved((s) => [res.mistake, ...s]);
          // 출처와 문항 번호는 남긴다. 같은 회차를 이어서 적으므로 번호 끝만 고치면 된다.
          carriedRef.current = res.mistake.ref ?? "";
          setValues({ ...EMPTY, ref: carriedRef.current });
          // 선택지 없이 넘긴 문항이었다면(줄이 0개) 다음 문항도 줄 없이 시작한다. 문법 회상처럼
          // 선택지가 없는 문항이 이어질 때 Enter 한 번을 아낀다.
          const fresh: ChoiceRow = { id: nextChoiceId.current++, text: "" };
          setChoices((c) => (c.length === 0 ? [] : [fresh]));
          // 분류는 문항마다 새로 판단해야 하므로 비운다.
          setCategory("");
          if (plan.rangeSkipped) setRangeNote(RANGE_SKIPPED_TEXT[plan.rangeSkipped]);
        } catch {
          setError("오답 저장에 실패했습니다. 네트워크를 확인해주세요.");
          return;
        }
      }

      if (rangeToSave) {
        try {
          const res = await saveStudyRangeAction({
            source,
            from: rangeToSave.from_no,
            to: rangeToSave.to_no,
            studyDay,
          });
          if (!res.ok) {
            setRangeError(RANGE_ERROR_TEXT[res.reason]);
          } else {
            const done = res.range;
            setRanges((rs) => [
              done,
              ...(rs ?? []).filter(
                (r) => r.source !== done.source || r.study_day !== done.study_day,
              ),
            ]);
            setRange({ from: String(done.from_no), to: String(done.to_no) });
          }
        } catch {
          setRangeError("범위 저장에 실패했습니다. 네트워크를 확인해주세요.");
        }
      } else if (rangeInvalid) {
        // 범위가 틀려도 오답은 막지 않았다. 저장한 뒤에 범위 쪽 문제를 따로 알린다.
        setRangeError(RANGE_ERROR_TEXT[rangeInvalid]);
      }

      // 오답을 적었든 범위를 적었든 이어서 다음 오답을 적는다.
      const ref = inputs.current.ref;
      if (ref) {
        ref.focus();
        ref.setSelectionRange(ref.value.length, ref.value.length);
      }
    } finally {
      setSaving(false);
    }
  }

  /** 학습일이나 출처를 바꾼다. 범위 칸은 그 날 그 교재의 것으로 다시 채운다. */
  function pick(nextSource: MistakeSource, nextDay: string) {
    setSource(nextSource);
    setStudyDay(nextDay);
    setRange(draftStudyRange(ranges ?? [], nextSource, nextDay));
    setRangeError(null);
    setRangeNote(null);
  }

  /** 칸을 넘기는 Enter 인가. IME 조합을 확정하는 Enter 는 아니다. */
  function isNextKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return false;
    // Safari 는 조합을 확정하는 Enter 를 compositionend 뒤에 보내서 isComposing 으로는
    // 걸러지지 않는다. 그 키는 keyCode 가 229 다.
    return !(e.nativeEvent.isComposing || composing.current || e.keyCode === 229);
  }

  function onEnter(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (!isNextKey(e)) return;
    e.preventDefault();
    // 문항 번호 다음은 선택지다. 줄이 없으면 건너뛴다.
    if (FIELDS[index].key === "ref" && choices.length > 0) {
      choiceInputs.current.get(choices[0].id)?.focus();
      return;
    }
    const next = FIELDS[index + 1];
    if (next) inputs.current[next.key]?.focus();
    else categoryRef.current?.focus();
  }

  function addChoice() {
    const id = nextChoiceId.current++;
    focusChoice.current = id;
    setChoices((c) => [...c, { id, text: "" }]);
  }

  function removeChoice(id: number) {
    const at = choices.findIndex((c) => c.id === id);
    // 커서를 잃으면 폰에서 키보드가 내려간다. 지운 자리의 다음 줄, 없으면 앞줄로 옮긴다.
    const neighbor = choices[at + 1] ?? choices[at - 1];
    if (neighbor) choiceInputs.current.get(neighbor.id)?.focus();
    else addChoiceRef.current?.focus();
    setChoices((c) => c.filter((row) => row.id !== id));
  }

  function onChoiceEnter(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (!isNextKey(e)) return;
    e.preventDefault();
    // 빈 줄에서 Enter = 선택지는 여기까지. 빈 줄을 거두고 고른 답으로 간다.
    if (e.currentTarget.value.trim() === "") {
      const id = choices[index].id;
      inputs.current.chosen?.focus();
      setChoices((c) => c.filter((row) => row.id !== id));
      return;
    }
    const next = choices[index + 1];
    if (next) choiceInputs.current.get(next.id)?.focus();
    else addChoice();
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

  /** 번호 칸. 숫자 자판이 뜨고, 채워 둔 번호는 지우지 않고 바로 덮어쓸 수 있게 통째로 고른다. */
  function rangeInput(key: "from" | "to") {
    const isFrom = key === "from";
    return (
      <input
        ref={isFrom ? fromRef : toRef}
        aria-label={isFrom ? "시작 번호" : "끝 번호"}
        value={range[key]}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        enterKeyHint={isFrom ? "next" : "done"}
        autoComplete="off"
        className="w-20 rounded-lg border border-border bg-bg px-2 py-2.5 text-center text-lg tabular-nums outline-none focus:border-accent"
        onChange={(e) => setRange((r) => ({ ...r, [key]: e.target.value }))}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (!isNextKey(e)) return;
          e.preventDefault();
          if (isFrom) toRef.current?.focus();
          else void save();
        }}
      />
    );
  }

  const last = saved[0];
  const dayLabel =
    studyDay === today ? "오늘" : studyDay === addDays(today, -1) ? "어제" : studyDay;
  const dayRanges = MISTAKE_SOURCES.flatMap((s) =>
    (ranges ?? []).filter((r) => r.source === s && r.study_day === studyDay),
  );

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
          onChange={(e) => e.target.value && pick(source, e.target.value)}
          aria-label="학습일"
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => pick(source, today)}
          className={`rounded-md px-2 py-1 text-xs ${
            studyDay === today ? "bg-accent text-accent-fg" : "border border-border"
          }`}
        >
          오늘
        </button>
        <button
          type="button"
          onClick={() => pick(source, addDays(today, -1))}
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
            onClick={() => pick(s, studyDay)}
            className={`rounded-full px-4 py-2 text-sm ${
              source === s ? "bg-fg text-bg" : "border border-border text-muted"
            }`}
          >
            {MISTAKE_SOURCE_LABEL[s]}
          </button>
        ))}
      </div>

      {ranges && (
        <section className="mt-4 rounded-xl border border-border bg-surface px-4 py-3">
          <p className="text-sm text-muted">
            푼 범위{" "}
            <span className="text-xs">· 오답 칸을 비워 두고 저장하면 범위만 저장된다 · 교재마다 하루 한 줄</span>
          </p>
          <div className="mt-2 flex items-center gap-2">
            {rangeInput("from")}
            <span className="text-muted">~</span>
            {rangeInput("to")}
          </div>
          <p className="mt-2 text-xs text-muted">
            {dayRanges.length > 0
              ? `${dayLabel} 저장된 범위 · ${dayRanges
                  .map(
                    (r) =>
                      `${MISTAKE_SOURCE_LABEL[r.source]} ${r.from_no}~${r.to_no}번 (${
                        r.to_no - r.from_no + 1
                      }문항)`,
                  )
                  .join(" · ")}`
              : `${dayLabel} 저장된 범위가 없습니다`}
          </p>
          {rangeError && <p className="mt-1 text-sm text-danger">{rangeError}</p>}
          {rangeNote && <p className="mt-1 text-xs text-muted">{rangeNote}</p>}
        </section>
      )}

      <div className="mt-4 flex flex-col gap-4">
        {field(0)}

        <div role="group" aria-label="선택지" className="flex flex-col gap-1.5">
          <span className="text-sm text-muted">
            선택지 <span className="text-xs">· 한 줄에 하나 · 없으면 비워 둔다</span>
          </span>
          {choices.length > 0 && (
            <ol className="flex flex-col gap-2">
              {choices.map((row, i) => (
                <li key={row.id} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="w-5 shrink-0 text-right text-sm text-muted tabular-nums"
                  >
                    {i + 1}
                  </span>
                  <input
                    ref={(el) => {
                      if (!el) {
                        choiceInputs.current.delete(row.id);
                        return;
                      }
                      choiceInputs.current.set(row.id, el);
                      if (focusChoice.current === row.id) {
                        focusChoice.current = null;
                        el.focus();
                      }
                    }}
                    aria-label={`선택지 ${i + 1}`}
                    value={row.text}
                    lang="ja"
                    maxLength={MISTAKE_TEXT_MAX}
                    enterKeyHint="next"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-4 py-3 text-lg outline-none focus:border-accent"
                    onChange={(e) => {
                      const text = e.target.value;
                      setChoices((c) => c.map((r) => (r.id === row.id ? { ...r, text } : r)));
                    }}
                    onCompositionStart={() => {
                      composing.current = true;
                    }}
                    onCompositionEnd={() => {
                      composing.current = false;
                    }}
                    onKeyDown={(e) => onChoiceEnter(e, i)}
                  />
                  {/* Tab 으로 칸을 넘길 때 걸리지 않게 뺀다. 빈 줄은 저장되지 않으므로 지우지 않아도 된다. */}
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`선택지 ${i + 1} 삭제`}
                    onClick={() => removeChoice(row.id)}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border text-xl text-muted"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          )}
          <button
            ref={addChoiceRef}
            type="button"
            onClick={addChoice}
            className="mt-2.5 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted"
          >
            + 선택지 추가
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {field(1)}
          {field(2)}
        </div>
        {field(3)}

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

        <p className="text-xs text-muted">
          Enter = 다음 칸 · 선택지의 빈 줄에서 Enter = 고른 답으로 · 분류나 끝 번호에서 Enter =
          저장하고 문항 번호로
        </p>

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
                <span className="min-w-0 text-sm">
                  {m.why ?? m.answer ?? (splitChoices(m.question).join(" / ") || m.chosen)}
                </span>
                <span className="ml-auto text-xs text-muted tabular-nums">{m.study_day}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
