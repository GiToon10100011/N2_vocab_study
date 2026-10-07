"use server";

import { insertMistake } from "../queries";
import {
  validateMistake,
  type Mistake,
  type MistakeInput,
  type MistakeInvalid,
} from "../mistakes";
import { studyDate } from "../srs";

export type AddMistakeResult =
  | { ok: true; mistake: Mistake }
  | { ok: false; reason: MistakeInvalid };

export async function addMistakeAction(
  /** studyDay 는 문제를 푼 날 'YYYY-MM-DD'. 생략하면 오늘. 어제 푼 문제를 오늘 적을 때 쓴다. */
  input: MistakeInput & { studyDay?: string },
): Promise<AddMistakeResult> {
  // 폼이 같은 검사를 먼저 하지만, 서버 액션은 폼을 거치지 않은 POST 로도 호출된다.
  const checked = validateMistake(input);
  if (!checked.ok) return checked;

  const studyDay = /^\d{4}-\d{2}-\d{2}$/.test(input.studyDay ?? "")
    ? input.studyDay!
    : studyDate();

  const mistake = await insertMistake({ ...checked.value, study_day: studyDay });
  return { ok: true, mistake };
}
