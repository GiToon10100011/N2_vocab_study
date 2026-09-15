"use server";

import { revalidatePath } from "next/cache";
import { fetchSettings, saveSettings } from "../queries";
import type { AppSettings } from "../types";

export async function getSettingsAction(): Promise<AppSettings> {
  return fetchSettings();
}

export async function saveSettingsAction(input: AppSettings): Promise<AppSettings> {
  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)));

  const weights = {
    s2r: clamp(input.weights.s2r, 0, 100),
    s2m: clamp(input.weights.s2m, 0, 100),
    r2m: clamp(input.weights.r2m, 0, 100),
  };
  // 전부 0 이면 출제 자체가 불가능해지므로 기본값으로 되돌린다.
  if (weights.s2r + weights.s2m + weights.r2m === 0) {
    weights.s2r = 60;
    weights.s2m = 25;
    weights.r2m = 15;
  }

  const next: AppSettings = {
    // 0 은 "제한 없음" 이다. 그날 등록한 단어를 개수와 무관하게 전부 출제한다.
    newLimit: clamp(input.newLimit, 0, 200),
    reviewLimit: clamp(input.reviewLimit, 10, 1000),
    weights,
    dayStartHour: clamp(input.dayStartHour, 0, 12),
    // 백업 시각은 백업 작업만 갱신한다. 설정 저장으로 덮어쓰지 않는다.
    lastBackupAt: input.lastBackupAt,
  };

  await saveSettings(next);
  revalidatePath("/");
  return next;
}
