import { WordList } from "./WordList";
import { SetupNotice } from "../SetupNotice";
import { fetchStudyDays, searchWords, type WordFlag } from "@/lib/queries";
import { getSettingsAndToday } from "@/lib/settings";
import type { StudyDayGroup, Word } from "@/lib/types";

export const dynamic = "force-dynamic";

const FLAGS: WordFlag[] = ["all", "wrong", "weak", "suspended"];

export default async function WordsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const raw = (await searchParams).filter;
  const flag: WordFlag = FLAGS.includes(raw as WordFlag) ? (raw as WordFlag) : "all";

  let rows: Word[];
  let total: number;
  let days: StudyDayGroup[];
  try {
    const { today } = await getSettingsAndToday();
    const [res, d] = await Promise.all([
      searchWords({ flag, limit: 300 }),
      fetchStudyDays(today),
    ]);
    rows = res.rows;
    total = res.total;
    days = d;
  } catch (err) {
    return <SetupNotice message={err instanceof Error ? err.message : String(err)} />;
  }

  return <WordList initial={rows} initialTotal={total} days={days} initialFlag={flag} />;
}
