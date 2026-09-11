import { SettingsForm } from "./SettingsForm";
import { SetupNotice } from "../SetupNotice";
import { fetchSettings } from "@/lib/queries";
import type { AppSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let settings: AppSettings;
  try {
    settings = await fetchSettings();
  } catch (err) {
    return <SetupNotice message={err instanceof Error ? err.message : String(err)} />;
  }
  return <SettingsForm initial={settings} />;
}
