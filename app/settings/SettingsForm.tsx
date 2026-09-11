"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { saveSettingsAction } from "@/lib/actions/settings";
import { PROMPT_LABEL } from "@/lib/types";
import type { AppSettings } from "@/lib/types";

export function SettingsForm({ initial }: { initial: AppSettings }) {
  const [s, setS] = useState<AppSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const total = s.weights.s2r + s.weights.s2m + s.weights.r2m || 1;

  async function save() {
    setBusy(true);
    setMsg(null);
    const next = await saveSettingsAction(s);
    setS(next);
    setBusy(false);
    setMsg("저장했습니다.");
  }

  async function runImport(file: File) {
    setImporting(true);
    setImportMsg(null);
    const fd = new FormData();
    fd.set("file", file);
    if (restoreRef.current?.checked) fd.set("restore", "1");
    try {
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const data = (await res.json()) as {
        added: number;
        merged: number;
        restored: number;
        failed: number;
      };
      setImportMsg(
        `${data.added}개 추가 · ${data.merged}개 갱신` +
          (data.restored > 0 ? ` · ${data.restored}개 진도 복원` : "") +
          (data.failed > 0 ? ` · ${data.failed}개 실패` : ""),
      );
    } catch {
      setImportMsg("가져오기에 실패했습니다.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">설정</h1>
        <Link href="/" className="text-sm text-muted underline underline-offset-4">
          홈으로
        </Link>
      </header>

      <section className="mt-6 flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">하루 분량</h2>

        <label className="flex items-center justify-between gap-4">
          <span className="text-sm">
            새 단어 상한
            <span className="ml-2 text-xs text-muted">하루에 처음 배울 단어 수</span>
          </span>
          <input
            type="number"
            min={0}
            max={200}
            value={s.newLimit}
            onChange={(e) => setS({ ...s, newLimit: Number(e.target.value) })}
            className="w-24 rounded-lg border border-border bg-bg px-3 py-2 text-right tabular-nums"
          />
        </label>

        <label className="flex items-center justify-between gap-4">
          <span className="text-sm">
            복습 상한
            <span className="ml-2 text-xs text-muted">밀린 날 세션이 무한정 길어지지 않게</span>
          </span>
          <input
            type="number"
            min={10}
            max={1000}
            value={s.reviewLimit}
            onChange={(e) => setS({ ...s, reviewLimit: Number(e.target.value) })}
            className="w-24 rounded-lg border border-border bg-bg px-3 py-2 text-right tabular-nums"
          />
        </label>

        <label className="flex items-center justify-between gap-4">
          <span className="text-sm">
            하루 시작 시각
            <span className="ml-2 text-xs text-muted">
              새벽 {s.dayStartHour}시 전 학습은 전날로 집계
            </span>
          </span>
          <input
            type="number"
            min={0}
            max={12}
            value={s.dayStartHour}
            onChange={(e) => setS({ ...s, dayStartHour: Number(e.target.value) })}
            className="w-24 rounded-lg border border-border bg-bg px-3 py-2 text-right tabular-nums"
          />
        </label>
      </section>

      <section className="mt-4 flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">
          출제 비율
          <span className="ml-2 text-xs font-normal text-muted">
            통계의 유형별 정답률을 보고 조정하세요
          </span>
        </h2>

        {(["s2r", "s2m", "r2m"] as const).map((k) => (
          <label key={k} className="flex items-center gap-4">
            <span className="w-28 text-sm">{PROMPT_LABEL[k]}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={s.weights[k]}
              onChange={(e) =>
                setS({ ...s, weights: { ...s.weights, [k]: Number(e.target.value) } })
              }
              className="flex-1 accent-[var(--accent)]"
            />
            <span className="w-16 text-right text-sm tabular-nums">
              {Math.round((s.weights[k] / total) * 100)}%
            </span>
          </label>
        ))}
        <p className="text-xs text-muted">
          가나 전용 단어는 항상 뜻 문제로만, 읽기가 겹치는 단어는 읽기 → 뜻을 빼고 출제합니다.
          이 비율과 무관하게 적용되는 규칙입니다.
        </p>
      </section>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded-xl bg-accent px-6 py-3.5 font-semibold text-accent-fg disabled:opacity-50"
        >
          저장
        </button>
        {msg && <span className="text-sm text-accent">{msg}</span>}
      </div>

      <section className="mt-8 flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">백업</h2>
        <p className="text-xs text-muted">
          매일 05:00 에 자동으로 저장소에 백업됩니다. 아래는 지금 당장 파일이 필요할 때 씁니다.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <a
            href="/api/export?format=csv"
            className="rounded-lg border border-border px-4 py-2 underline-offset-4"
          >
            CSV 내려받기
          </a>
          <a
            href="/api/export?format=json"
            className="rounded-lg border border-border px-4 py-2"
          >
            JSON 내려받기
          </a>
        </div>

        <div className="mt-2 border-t border-border pt-4">
          <label className="flex items-center gap-2 text-sm">
            <input ref={restoreRef} type="checkbox" />
            복원 모드 (백업 CSV 의 복습 진도까지 되돌리기)
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            disabled={importing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void runImport(f);
            }}
            className="mt-3 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-border file:bg-bg file:px-4 file:py-2 file:text-fg"
          />
          {importing && <p className="mt-2 text-sm text-muted">가져오는 중…</p>}
          {importMsg && <p className="mt-2 text-sm text-accent">{importMsg}</p>}
        </div>
      </section>
    </main>
  );
}
