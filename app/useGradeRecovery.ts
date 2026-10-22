import { useCallback, useEffect, useRef, useState } from "react";
import { recoverBeforeSession, recoveryPending, unsentCount } from "@/lib/grade-client";

/**
 * 지난 세션에서 서버에 가지 못한 채점이 남아 있으면 화면이 시작하기 전에 그것부터 보낸다.
 * 방금 받은 화면 데이터(큐 · 남은 문제)는 그 채점이 반영되기 전에 만들어진 것이라, 그대로 시작하면
 * 이미 푼 문제가 다시 나오고 채점이 두 번 반영된다. 학습 화면과 실전 테스트 화면이 같이 쓴다.
 *
 * blockedRef 가 true 인 동안 화면은 키 입력을 무시해야 한다.
 */
export function useGradeRecovery() {
  const [recovery, setRecovery] = useState<"none" | "sending" | "failed">("none");
  const [unsent, setUnsent] = useState(0);
  const blockedRef = useRef(false);

  const recover = useCallback(async () => {
    blockedRef.current = true;
    setRecovery("sending");
    const r = await recoverBeforeSession().catch(() => null);
    if (!r || r.failed > 0) {
      setUnsent(r?.failed ?? unsentCount());
      setRecovery("failed");
    } else if (r.reload) {
      window.location.reload(); // 채점이 반영된 화면 데이터를 새로 받는다
    } else {
      blockedRef.current = false;
      setRecovery("none");
    }
  }, []);

  useEffect(() => {
    if (!recoveryPending()) return;
    // 안내 화면으로 바뀌기 전에 들어오는 입력부터 막는다.
    blockedRef.current = true;
    void Promise.resolve().then(recover);
  }, [recover]);

  /** 「그대로 시작」: 반영하지 못한 채점이 남은 채로 시작한다. */
  const skip = useCallback(() => {
    blockedRef.current = false;
    setRecovery("none");
  }, []);

  return { recovery, unsent, blockedRef, recover, skip };
}
