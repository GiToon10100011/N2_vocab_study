"use client";

import { useEffect } from "react";

/**
 * 서비스 워커 등록. 개발 중에는 오래된 청크가 캐시되는 혼란을 피하려고 등록하지 않고,
 * 이미 등록된 것이 있으면 해제한다.
 */
export function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* 등록 실패해도 앱은 그대로 동작한다 */
    });
  }, []);

  return null;
}
