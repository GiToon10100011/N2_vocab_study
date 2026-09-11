import Link from "next/link";
import { HomeKeys } from "./HomeKeys";
import { SetupNotice } from "./SetupNotice";
import { fetchPeriodStats, fetchTodayCounts, fetchWeakTotal } from "@/lib/queries";
import { DEFAULT_NEW_LIMIT, addDays, studyDate, studyDayStart } from "@/lib/srs";

export const dynamic = "force-dynamic";

function formatKoreanDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][
    new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  ];
  return `${y}년 ${m}월 ${d}일 (${dow})`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-4xl font-semibold tabular-nums sm:text-5xl">{value}</span>
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}

export default async function HomePage() {
  const today = studyDate();

  let counts, week, weakTotal;
  try {
    [counts, week, weakTotal] = await Promise.all([
      fetchTodayCounts(today),
      fetchPeriodStats(studyDayStart(addDays(today, -6)).toISOString()),
      fetchWeakTotal(),
    ]);
  } catch (err) {
    return <SetupNotice message={err instanceof Error ? err.message : String(err)} />;
  }

  const newToday = Math.min(counts.newCount, DEFAULT_NEW_LIMIT);
  const total = newToday + counts.reviewCount;
  // "아직 단어가 없음"과 "오늘 할 일을 끝냄"은 완전히 다른 상태다.
  const empty = counts.totalWords === 0;
  const done = !empty && total === 0;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-6 py-10 sm:py-16">
      {!done && <HomeKeys href="/study" />}

      <p className="text-sm text-muted">{formatKoreanDate(today)}</p>

      {empty ? (
        <section className="mt-10 rounded-2xl border border-border bg-surface px-6 py-12 text-center">
          <p className="text-2xl font-semibold">아직 단어가 없습니다</p>
          <p className="mt-2 text-sm text-muted">
            단어를 등록하면 여기에 오늘 공부할 것이 표시됩니다.
          </p>
          <Link
            href="/add"
            className="mt-8 inline-block rounded-xl bg-accent px-8 py-4 text-base font-semibold text-accent-fg"
          >
            단어 추가하기
          </Link>
        </section>
      ) : done ? (
        <section className="mt-10 rounded-2xl border border-border bg-surface px-6 py-12 text-center">
          <p className="text-2xl font-semibold">오늘의 학습 완료</p>
          <p className="mt-2 text-sm text-muted">
            예정된 복습과 신규 단어를 모두 끝냈습니다. 등록된 단어 {counts.totalWords}개.
          </p>
        </section>
      ) : (
        <>
          <section className="mt-10 grid grid-cols-3 gap-4 rounded-2xl border border-border bg-surface px-4 py-8">
            <Stat label="신규" value={String(newToday)} />
            <Stat label="복습" value={String(counts.reviewCount)} />
            <Stat label="취약" value={String(counts.weakCount)} />
          </section>

          <Link
            href="/study"
            className="mt-6 rounded-xl bg-accent px-6 py-5 text-center text-lg font-semibold text-accent-fg"
          >
            학습 시작 <span className="ml-1 text-sm font-normal opacity-70">(Enter)</span>
          </Link>

          {newToday > 0 && counts.reviewCount > 0 && (
            <Link
              href="/study?skipNew=1"
              className="mt-3 text-center text-sm text-muted underline underline-offset-4"
            >
              오늘은 신규 건너뛰기
            </Link>
          )}
        </>
      )}

      <section className="mt-10 flex flex-wrap items-baseline justify-center gap-x-6 gap-y-2 text-sm text-muted">
        <span>최근 7일</span>
        <span>
          신규 <b className="font-semibold text-fg tabular-nums">{week.newCount}</b>
        </span>
        <span>
          복습 <b className="font-semibold text-fg tabular-nums">{week.reviewCount}</b>
        </span>
        <span>
          정답률{" "}
          <b className="font-semibold text-fg tabular-nums">
            {week.accuracy === null ? "—" : `${Math.round(week.accuracy * 100)}%`}
          </b>
        </span>
        <span>
          취약 <b className="font-semibold text-fg tabular-nums">{weakTotal}</b>
        </span>
      </section>

      <nav className="mt-auto flex justify-center gap-6 pt-12 text-sm">
        <Link href="/add" className="underline underline-offset-4">
          + 단어 추가
        </Link>
        <a href="/api/export?format=csv" className="underline underline-offset-4">
          CSV 백업
        </a>
        <a href="/api/export?format=json" className="underline underline-offset-4">
          JSON 백업
        </a>
      </nav>
    </main>
  );
}
