import { AddForm } from "./AddForm";
import { SetupNotice } from "../SetupNotice";
import { fetchRecentlyAdded, fetchStudyDays } from "@/lib/queries";
import { getSettingsAndToday } from "@/lib/settings";
import type { StudyDayGroup, Word } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AddPage() {
  let recent: Word[];
  let days: StudyDayGroup[];
  let today: string;
  try {
    const { today: t } = await getSettingsAndToday();
    today = t;
    [recent, days] = await Promise.all([fetchRecentlyAdded(20), fetchStudyDays(today)]);
  } catch (err) {
    return <SetupNotice message={err instanceof Error ? err.message : String(err)} />;
  }
  return <AddForm initialRecent={recent} initialDays={days} today={today} />;
}
