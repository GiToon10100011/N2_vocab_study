import { fetchSettings } from "./queries";
import { APP_TIMEZONE, studyDate } from "./srs";
import type { AppSettings } from "./types";

/**
 * 설정과 "오늘 날짜"를 함께 읽는다.
 * 하루 경계 시각이 설정값이므로 날짜 계산이 설정에 의존한다.
 */
export async function getSettingsAndToday(): Promise<{
  settings: AppSettings;
  today: string;
}> {
  const settings = await fetchSettings();
  return {
    settings,
    today: studyDate(new Date(), APP_TIMEZONE, settings.dayStartHour),
  };
}
