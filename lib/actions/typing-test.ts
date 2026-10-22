"use server";

import { redirect } from "next/navigation";
import { getSettingsAndToday } from "../settings";
import { startTypingTest } from "../typing-test-load";

/**
 * 「시작」 버튼. 문항은 여기서만 만든다 — /test 를 그리는 GET 에서 만들면 링크 미리 불러오기(prefetch)만으로
 * 테스트가 생길 수 있다. 시작할 때가 아니면 아무것도 만들지 않고, 어느 쪽이든 /test 로 돌아가
 * 그 시점의 상태(진행 중 · 아직 아님)를 보여 준다.
 */
export async function startTypingTestAction(): Promise<void> {
  const { settings, today } = await getSettingsAndToday();
  await startTypingTest(today, settings);
  redirect("/test"); // redirect 는 오류를 던져 동작하므로 try 밖에서 부른다
}
