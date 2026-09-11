import Link from "next/link";
import { SetupNotice } from "../SetupNotice";
import { fetchPeriodStats, fetchTypeStats, fetchWeakTotal, fetchWrongTotal } from "@/lib/queries";
import { addDays, studyDayStart } from "@/lib/srs";
import { getSettingsAndToday } from "@/lib/settings";
import { PROMPT_LABEL, type PromptType } from "@/lib/types";

export const dynamic = "force-dynamic";

const ALL_TIME = "1970-01-01T00:00:00Z";

function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

export default async function StatsPage() {
  let today: string, dayStartHour: number;
  let todayStats, weekStats, allStats, typeWeek, typeAll, weak, wrong;

  try {
    const s = await getSettingsAndToday();
    today = s.today;
    dayStartHour = s.settings.dayStartHour;
    const todayStart = studyDayStart(today, undefined, dayStartHour).toISOString();
    const weekStart = studyDayStart(addDays(today, -6), undefined, dayStartHour).toISOString();

    [todayStats, weekStats, allStats, typeWeek, typeAll, weak, wrong] = await Promise.all([
      fetchPeriodStats(todayStart),
      fetchPeriodStats(weekStart),
      fetchPeriodStats(ALL_TIME),
      fetchTypeStats(weekStart),
      fetchTypeStats(ALL_TIME),
      fetchWeakTotal(),
      fetchWrongTotal(),
    ]);
  } catch (err) {
    return <SetupNotice message={err instanceof Error ? err.message : String(err)} />;
  }

  const cols = [
    { label: "오늘", s: todayStats },
    { label: "최근 7일", s: weekStats },
    { label: "전체", s: allStats },
  ];

  const byType = (rows: typeof typeWeek) =>
    Object.fromEntries(rows.map((r) => [r.prompt_type, r])) as Record<
      PromptType,
      (typeof typeWeek)[number] | undefined
    >;
  const week = byType(typeWeek);
  const all = byType(typeAll);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">통계</h1>
        <Link href="/" className="text-sm text-muted underline underline-offset-4">
          홈으로
        </Link>
      </header>

      <table className="mt-6 w-full overflow-hidden rounded-xl border border-border bg-surface text-sm">
        <thead className="border-b border-border text-xs text-muted">
          <tr>
            <th className="px-4 py-2.5 text-left font-normal"> </th>
            {cols.map((c) => (
              <th key={c.label} className="px-4 py-2.5 text-right font-normal">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border tabular-nums">
          <tr>
            <td className="px-4 py-3 text-muted">신규</td>
            {cols.map((c) => (
              <td key={c.label} className="px-4 py-3 text-right text-lg">
                {c.s.newCount}
              </td>
            ))}
          </tr>
          <tr>
            <td className="px-4 py-3 text-muted">복습</td>
            {cols.map((c) => (
              <td key={c.label} className="px-4 py-3 text-right text-lg">
                {c.s.reviewCount}
              </td>
            ))}
          </tr>
          <tr>
            <td className="px-4 py-3 text-muted">정답률</td>
            {cols.map((c) => (
              <td key={c.label} className="px-4 py-3 text-right text-lg">
                {pct(c.s.accuracy)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      <h2 className="mt-8 text-sm text-muted">
        유형별 정답률{" "}
        <span className="text-xs">
          · 한자 → 읽기가 유독 낮으면 설정에서 그 비중을 올리세요
        </span>
      </h2>
      <table className="mt-3 w-full overflow-hidden rounded-xl border border-border bg-surface text-sm">
        <thead className="border-b border-border text-xs text-muted">
          <tr>
            <th className="px-4 py-2.5 text-left font-normal">유형</th>
            <th className="px-4 py-2.5 text-right font-normal">최근 7일</th>
            <th className="px-4 py-2.5 text-right font-normal">전체</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border tabular-nums">
          {(["s2r", "s2m", "r2m"] as PromptType[]).map((t) => {
            const w = week[t];
            const a = all[t];
            return (
              <tr key={t}>
                <td className="px-4 py-3">{PROMPT_LABEL[t]}</td>
                <td className="px-4 py-3 text-right">
                  {w ? `${Math.round((w.correct / w.total) * 100)}%` : "—"}
                  {w && <span className="ml-1 text-xs text-muted">({w.total})</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {a ? `${Math.round((a.correct / a.total) * 100)}%` : "—"}
                  {a && <span className="ml-1 text-xs text-muted">({a.total})</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-6 flex gap-3">
        <Link
          href="/words?filter=wrong"
          className="flex-1 rounded-xl border border-border bg-surface px-4 py-4 text-center"
        >
          <div className="text-2xl font-semibold tabular-nums">{wrong}</div>
          <div className="mt-1 text-xs text-muted">오답노트</div>
        </Link>
        <Link
          href="/words?filter=weak"
          className="flex-1 rounded-xl border border-border bg-surface px-4 py-4 text-center"
        >
          <div className="text-2xl font-semibold tabular-nums">{weak}</div>
          <div className="mt-1 text-xs text-muted">취약 단어</div>
        </Link>
      </div>

      <p className="mt-6 text-xs text-muted">
        복습 횟수와 정답률에는 연습 퀴즈도 포함됩니다. 학습 카드와 세션 내 재시도는 제외됩니다.
      </p>
    </main>
  );
}
