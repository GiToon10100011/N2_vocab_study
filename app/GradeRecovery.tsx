"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { recoverInBackground } from "@/lib/grade-client";

/**
 * 앱이 도중에 닫혀 서버에 가지 못한 채점을 다음에 들어왔을 때 보낸다.
 * 보낸 뒤에는 화면을 새로 받는다. 방금 그린 홈의 숫자는 그 채점이 반영되기 전의 것이다.
 *
 * 학습 화면은 스스로 처리한다(StudySession). 거기서는 큐까지 새로 받아야 하기 때문이다.
 */
export function GradeRecovery() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/login" || pathname.startsWith("/study")) return;
    let here = true;
    void recoverInBackground()
      .then((delivered) => {
        if (here && delivered > 0) router.refresh();
      })
      .catch(() => undefined);
    return () => {
      here = false;
    };
  }, [pathname, router]);

  return null;
}
