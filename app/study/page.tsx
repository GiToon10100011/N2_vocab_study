import Link from "next/link";
import { StudySession } from "./StudySession";
import { SetupNotice } from "../SetupNotice";
import { loadPracticeQueue, loadTodayQueue } from "@/lib/study";
import { fetchTodayCounts } from "@/lib/queries";
import { studyDate } from "@/lib/srs";
import type { QueueCard } from "@/lib/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function StudyPage({
  searchParams,
}: {
  searchParams: Promise<{ skipNew?: string; from?: string; to?: string; label?: string }>;
}) {
  const sp = await searchParams;
  // from/to 가 있으면 일차/주차 퀴즈(연습 모드). SRS 를 건드리지 않는다.
  const practice = DATE_RE.test(sp.from ?? "") && DATE_RE.test(sp.to ?? "");

  let cards: QueueCard[];
  let totalWords = 0;
  try {
    cards = practice
      ? (await loadPracticeQueue(sp.from!, sp.to!)).cards
      : (await loadTodayQueue(sp.skipNew === "1")).cards;
    if (!practice) totalWords = (await fetchTodayCounts(studyDate())).totalWords;
  } catch (err) {
    return <SetupNotice message={err instanceof Error ? err.message : String(err)} />;
  }

  if (cards.length === 0) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 text-center">
        <p className="text-2xl font-semibold">
          {practice
            ? "이 기간에 등록된 단어가 없습니다"
            : totalWords === 0
              ? "아직 단어가 없습니다"
              : "오늘 볼 카드가 없습니다"}
        </p>
        <p className="mt-3 text-sm text-muted">
          {practice
            ? "다른 일차를 골라보세요."
            : totalWords === 0
              ? "단어를 등록하면 바로 학습을 시작할 수 있습니다."
              : "예정된 복습을 모두 끝냈습니다. 내일 다시 오세요."}
        </p>
        <div className="mt-8 flex justify-center gap-6 text-sm">
          <Link href="/add" className="underline underline-offset-4">
            + 단어 추가
          </Link>
          <Link href="/" className="underline underline-offset-4">
            홈으로
          </Link>
        </div>
      </main>
    );
  }

  return (
    <StudySession
      initialCards={cards}
      practice={practice}
      title={practice ? (sp.label ?? "퀴즈") : undefined}
    />
  );
}
