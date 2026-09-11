import Papa from "papaparse";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { insertWord } from "@/lib/queries";
import { normalizeReading } from "@/lib/kana";
import { studyDate } from "@/lib/srs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, string | undefined>;

/**
 * CSV import.
 * - 앞 3열(surface, reading, meaning_ko)만 있으면 신규 등록
 * - SRS 열까지 있으면 "복원 모드"로 진도까지 되돌린다(백업 복원용)
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const restore = form?.get("restore") === "1";
  const fallbackDay = String(form?.get("studyDay") ?? "") || studyDate();

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "파일이 없습니다" }, { status: 400 });
  }

  const text = (await file.text()).replace(/^﻿/, "");
  const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });

  let added = 0;
  let merged = 0;
  let restored = 0;
  let failed = 0;

  for (const raw of parsed.data.slice(0, 5000)) {
    const surface = (raw.surface ?? "").trim();
    const meaning = (raw.meaning_ko ?? "").trim();
    const reading = normalizeReading(raw.reading ?? "") || surface;
    if (!surface || !meaning || !reading) {
      failed++;
      continue;
    }
    const studyDay = /^\d{4}-\d{2}-\d{2}$/.test(raw.study_day ?? "")
      ? raw.study_day!
      : fallbackDay;

    try {
      const res = await insertWord({
        surface,
        reading,
        meaning_ko: meaning,
        study_day: studyDay,
        note: raw.note?.trim() || null,
      });
      if (res.merged) merged++;
      else added++;

      // 복원 모드: 백업 CSV 의 SRS 열을 그대로 되돌린다.
      if (restore && raw.stage !== undefined && raw.next_review) {
        await db().query(
          `update words
              set stage = $2, next_review = $3::date,
                  correct_count = $4, wrong_count = $5, streak = $6,
                  last_wrong_type = nullif($7, ''), suspended = $8
            where id = $1::uuid`,
          [
            res.word.id,
            Number(raw.stage) || 0,
            raw.next_review,
            Number(raw.correct_count) || 0,
            Number(raw.wrong_count) || 0,
            Number(raw.streak) || 0,
            raw.last_wrong_type ?? "",
            raw.suspended === "true",
          ],
        );
        restored++;
      }
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, added, merged, restored, failed });
}
