"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** 홈에서 Enter 만 눌러도 세션이 시작되게 한다(클릭 수 최소화). */
export function HomeKeys({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.prefetch(href);
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      router.push(href);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [href, router]);
  return null;
}
