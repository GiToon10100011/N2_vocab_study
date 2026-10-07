import { MistakeForm } from "./MistakeForm";
import { SetupNotice } from "../../SetupNotice";
import { fetchLastMistakeRef } from "@/lib/queries";
import { getSettingsAndToday } from "@/lib/settings";
import type { Mistake } from "@/lib/mistakes";

export const dynamic = "force-dynamic";

export default async function NewMistakePage() {
  let today: string;
  let last: Pick<Mistake, "source" | "ref"> | null;
  try {
    [{ today }, last] = await Promise.all([getSettingsAndToday(), fetchLastMistakeRef()]);
  } catch (err) {
    return <SetupNotice message={err instanceof Error ? err.message : String(err)} />;
  }
  // 직전에 적은 출처와 문항 번호에서 이어서 적는다. DB 에서 읽으므로 기기를 바꿔도 이어진다.
  return (
    <MistakeForm
      today={today}
      initialSource={last?.source ?? "master1500"}
      initialRef={last?.ref ?? ""}
    />
  );
}
