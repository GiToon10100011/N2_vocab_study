import { diffDays, studyDate } from "@/lib/srs";

/** 백업이 이 일수를 넘게 멈춰 있으면 경고한다. */
const STALE_DAYS = 2;

/**
 * 자동 백업이 조용히 멈춘 것을 앱에서 알아채기 위한 배너.
 * 실제로 GitHub Actions 가 3일간 실패하는 동안 앱에는 아무 표시도 없었다.
 */
export function BackupWarning({ lastBackupAt }: { lastBackupAt: string | null }) {
  const today = studyDate();
  const days = lastBackupAt ? diffDays(today, lastBackupAt.slice(0, 10)) : null;

  if (days !== null && days <= STALE_DAYS) return null;

  return (
    <div className="mt-4 rounded-xl bg-warn-bg px-5 py-3 text-sm text-warn">
      <b>자동 백업이 멈춰 있습니다</b>
      <span className="ml-2">
        {days === null ? "기록 없음" : `마지막 백업 ${days}일 전`} · GitHub Actions 의 &ldquo;데이터
        백업&rdquo; 실행 기록을 확인하세요.
      </span>
    </div>
  );
}
