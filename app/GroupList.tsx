import Link from "next/link";
import type { StudyDayGroup } from "@/lib/types";

function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function QuizLink({ from, to, label }: { from: string; to: string; label: string }) {
  return (
    <Link
      href={`/study?from=${from}&to=${to}&label=${encodeURIComponent(label)}`}
      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold whitespace-nowrap hover:bg-bg"
    >
      연습
    </Link>
  );
}

/** SRS 주기상 오늘 이 그룹에서 몇 개가 걸려 있는지. 주기를 눈으로 체감하게 해준다. */
function DueBadge({ due, isNew }: { due: number; isNew: number }) {
  if (due === 0 && isNew === 0) return null;
  return (
    <span className="rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn tabular-nums whitespace-nowrap">
      오늘 {isNew > 0 && `신규 ${isNew}`}
      {isNew > 0 && due > 0 && " · "}
      {due > 0 && `복습 ${due}`}
    </span>
  );
}

/**
 * 일차/주차 목록. 아무 때나 눌러서 그 그룹만 퀴즈로 돌릴 수 있다.
 * 이 퀴즈는 순서만 매번 섞이고 복습 주기에는 영향을 주지 않는다.
 */
export function GroupList({ days }: { days: StudyDayGroup[] }) {
  if (days.length === 0) return null;

  const weeks = new Map<number, StudyDayGroup[]>();
  for (const d of days) {
    const list = weeks.get(d.weekIndex) ?? [];
    list.push(d);
    weeks.set(d.weekIndex, list);
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm text-muted">
        연습 퀴즈{" "}
        <span className="text-xs">
          · 아무 때나 눌러서 돌립니다. 순서만 매번 섞이고 <b>복습 주기에는 반영되지 않습니다</b>
        </span>
      </h2>

      <div className="mt-3 flex flex-col gap-4">
        {[...weeks.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([week, list]) => {
            const total = list.reduce((sum, d) => sum + d.total, 0);
            const from = list[0].study_day;
            const to = list[list.length - 1].study_day;
            return (
              <div key={week} className="overflow-hidden rounded-xl border border-border bg-surface">
                <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
                  <span className="font-semibold">{week}주차</span>
                  <span className="text-sm text-muted tabular-nums">{total}개</span>
                  <DueBadge
                    due={list.reduce((n, d) => n + d.dueToday, 0)}
                    isNew={list.reduce((n, d) => n + d.newCount, 0)}
                  />
                  <span className="ml-auto">
                    <QuizLink from={from} to={to} label={`${week}주차`} />
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {[...list].reverse().map((d) => (
                    <li key={d.study_day} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="tabular-nums">{d.dayIndex}일차</span>
                      <span className="text-sm text-muted tabular-nums">
                        {shortDate(d.study_day)}
                      </span>
                      <span className="text-sm text-muted tabular-nums">{d.total}개</span>
                      <DueBadge due={d.dueToday} isNew={d.newCount} />
                      <span className="ml-auto">
                        <QuizLink
                          from={d.study_day}
                          to={d.study_day}
                          label={`${d.dayIndex}일차`}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
      </div>
    </section>
  );
}
