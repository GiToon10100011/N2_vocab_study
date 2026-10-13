"use server";

import { upsertStudyRange } from "../queries";
import { studyDate } from "../srs";
import {
  validateStudyRange,
  type StudyRange,
  type StudyRangeInput,
  type StudyRangeInvalid,
} from "../study-ranges";

export type SaveStudyRangeResult =
  | { ok: true; range: StudyRange }
  | { ok: false; reason: StudyRangeInvalid };

export async function saveStudyRangeAction(
  /** studyDay 는 문제를 푼 날 'YYYY-MM-DD'. 생략하면 오늘. */
  input: StudyRangeInput & { studyDay?: string },
): Promise<SaveStudyRangeResult> {
  // 폼이 같은 검사를 먼저 하지만, 서버 액션은 폼을 거치지 않은 POST 로도 호출된다.
  const checked = validateStudyRange(input);
  if (!checked.ok) return checked;

  const studyDay = /^\d{4}-\d{2}-\d{2}$/.test(input.studyDay ?? "")
    ? input.studyDay!
    : studyDate();

  const range = await upsertStudyRange({ ...checked.value, study_day: studyDay });
  return { ok: true, range };
}
