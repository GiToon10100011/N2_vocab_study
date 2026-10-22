import Link from "next/link";

/** 지난 세션의 채점을 서버에 반영하는 동안, 그리고 반영하지 못했을 때 카드 대신 보여준다. */
export function RecoveryNotice({
  failed,
  onRetry,
  onSkip,
}: {
  /** 반영하지 못한 채점 수. null 이면 아직 보내는 중이다. */
  failed: number | null;
  onRetry: () => void;
  onSkip: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center px-6 text-center">
      {failed === null ? (
        <p role="status" className="text-sm text-muted">
          지난 세션의 채점을 반영하는 중입니다…
        </p>
      ) : (
        <>
          <p className="text-lg font-semibold">
            지난 세션의 채점 {failed}건을 아직 반영하지 못했습니다
          </p>
          <p className="mt-3 text-sm text-muted">
            채점은 이 기기에 남아 있습니다. 반영하기 전에 시작하면 이미 푼 카드가 다시 나올 수
            있습니다.
          </p>
          <div className="mt-8 flex gap-3">
            <button
              onClick={onRetry}
              className="rounded-xl bg-accent px-6 py-3.5 font-semibold text-accent-fg"
            >
              다시 시도
            </button>
            <button
              onClick={onSkip}
              className="rounded-xl border border-border bg-surface px-6 py-3.5 font-semibold"
            >
              그대로 시작
            </button>
          </div>
          <Link href="/" className="mt-6 text-sm text-muted underline underline-offset-4">
            홈으로
          </Link>
        </>
      )}
    </main>
  );
}
