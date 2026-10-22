import Link from "next/link";
import { SetupNotice } from "../SetupNotice";
import { TestSession } from "./TestSession";
import { startTypingTestAction } from "@/lib/actions/typing-test";
import { getSettingsAndToday } from "@/lib/settings";
import {
  loadTestOverview,
  loadTestSession,
  type TestOverview,
  type TestSessionData,
} from "@/lib/typing-test-load";

export const dynamic = "force-dynamic";

function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 text-center">
      <p className="text-2xl font-semibold">{title}</p>
      {children}
      <div className="mt-8 flex justify-center gap-6 text-sm">
        <Link href="/" className="underline underline-offset-4">
          홈으로
        </Link>
      </div>
    </main>
  );
}

export default async function TestPage() {
  let overview: TestOverview;
  let session: TestSessionData | null = null;
  try {
    const { settings, today } = await getSettingsAndToday();
    overview = await loadTestOverview(today, settings);
    if (overview.kind === "active") session = await loadTestSession(overview.testDay);
  } catch (err) {
    return <SetupNotice message={err instanceof Error ? err.message : String(err)} />;
  }

  if (overview.kind === "active" && session) {
    return (
      <TestSession
        testDay={session.testDay}
        questions={session.questions}
        answered={session.answered}
      />
    );
  }

  if (overview.kind === "due") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 text-center">
        <p className="text-sm text-muted">실전 테스트</p>
        <p className="mt-2 text-4xl font-semibold tabular-nums">{overview.count}문제</p>
        <p className="mt-4 text-sm text-muted">
          한자를 보고 읽기를 가나로 직접 쳐서 답합니다. 한 글자라도 다르면 오답이고, 틀린 단어는 내일
          다시 복습합니다.
        </p>
        {/* 문항은 이 버튼으로만 만든다. 화면을 그리는 것만으로는 테스트가 생기지 않는다. */}
        <form action={startTypingTestAction} className="mt-8">
          <button
            type="submit"
            className="rounded-xl bg-accent px-10 py-4 text-lg font-semibold text-accent-fg"
          >
            시작
          </button>
        </form>
        <div className="mt-6 text-sm">
          <Link href="/" className="underline underline-offset-4">
            홈으로
          </Link>
        </div>
      </main>
    );
  }

  if (overview.kind === "wait") {
    return (
      <Message title="오늘은 실전 테스트가 없습니다">
        <p className="mt-3 text-sm text-muted">다음 실전 테스트는 {overview.nextDay} 부터입니다.</p>
      </Message>
    );
  }

  return (
    <Message title="지금 낼 수 있는 단어가 없습니다">
      <p className="mt-3 text-sm text-muted">
        한자가 있는 단어를 복습한 뒤에 테스트가 열립니다. 오늘 처음 배운 단어는 내일부터 나옵니다.
      </p>
    </Message>
  );
}
