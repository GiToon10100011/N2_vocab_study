"use server";

import { db } from "../db";
import {
  deleteWordRow,
  fetchStudyDays,
  fetchWordsBySurface,
  insertWord,
  searchWords,
  setSuspendedRow,
  updateWordRow,
  type WordFilter,
} from "../queries";
import { normalizeReading } from "../kana";
import { studyDate } from "../srs";
import type { StudyDayGroup, Word } from "../types";

export interface AddWordInput {
  surface: string;
  reading: string;
  meaning_ko: string;
  /** 이 단어가 속한 학습일 'YYYY-MM-DD'. 생략하면 오늘. 소급 입력에 쓴다. */
  studyDay?: string;
  note?: string;
}

export type AddWordResult =
  | { ok: true; word: Word; merged: boolean }
  | { ok: false; reason: "invalid" };

export async function addWordAction(input: AddWordInput): Promise<AddWordResult> {
  const surface = input.surface.trim();
  const reading = input.reading.trim();
  const meaning = input.meaning_ko.trim();
  const note = input.note?.trim() || null;

  if (!surface || !reading || !meaning) return { ok: false, reason: "invalid" };

  const studyDay = /^\d{4}-\d{2}-\d{2}$/.test(input.studyDay ?? "")
    ? input.studyDay!
    : studyDate();

  const res = await insertWord({
    surface,
    reading,
    meaning_ko: meaning,
    study_day: studyDay,
    note,
  });
  return { ok: true, word: res.word, merged: res.merged };
}

/** 표기를 입력하는 동안 중복을 미리 알려주기 위한 조회. */
export async function lookupSurfaceAction(surface: string): Promise<Word[]> {
  const s = surface.trim();
  if (s.length === 0) return [];
  return fetchWordsBySurface(s);
}

/** 세션 중 S 키. 잘못 등록한 단어를 삭제하지 않고 큐에서만 빼둔다. */
export async function suspendWordAction(id: string): Promise<void> {
  await db().query(`update words set suspended = true where id = $1::uuid`, [id]);
}

/** 학습일 그룹 목록(N일차 / N주차). 입력 화면에서 현재 몇 일차인지 보여주는 데 쓴다. */
export async function listStudyDaysAction(): Promise<StudyDayGroup[]> {
  return fetchStudyDays(studyDate());
}

/* ------------------------------------------------------------------ *
 * 단어 목록에서 쓰는 액션
 * ------------------------------------------------------------------ */

export async function searchWordsAction(filter: WordFilter) {
  return searchWords(filter);
}

export type UpdateWordResult =
  | { ok: true; word: Word }
  | { ok: false; reason: "invalid" | "duplicate" | "missing" };

export async function updateWordAction(
  id: string,
  /** study_day 가 비어 있으면 기존 학습일을 그대로 둔다(세션 중 수정에서 쓴다). */
  patch: { surface: string; reading: string; meaning_ko: string; study_day: string },
): Promise<UpdateWordResult> {
  const surface = patch.surface.trim();
  // 가나 전용 단어는 읽기가 표기와 같을 수밖에 없다. 목록에서도 같은 규칙을 적용한다.
  const reading = normalizeReading(patch.reading) || surface;
  const meaning = patch.meaning_ko.trim();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(patch.study_day) ? patch.study_day : null;

  if (!surface || !reading || !meaning) return { ok: false, reason: "invalid" };

  try {
    const word = await updateWordRow(id, {
      surface,
      reading,
      meaning_ko: meaning,
      study_day: day,
    });
    return word ? { ok: true, word } : { ok: false, reason: "missing" };
  } catch (err) {
    // (surface, reading) unique 위반 = 이미 같은 단어가 따로 있다는 뜻
    if (String(err).includes("words_uniq")) return { ok: false, reason: "duplicate" };
    throw err;
  }
}

export async function deleteWordAction(id: string): Promise<void> {
  await deleteWordRow(id);
}

export async function setSuspendedAction(id: string, suspended: boolean): Promise<void> {
  await setSuspendedRow(id, suspended);
}

/* ------------------------------------------------------------------ *
 * 일괄 등록 (붙여넣기 / CSV import 공용)
 * ------------------------------------------------------------------ */

export interface BulkRow {
  surface: string;
  reading: string;
  meaning_ko: string;
}

export interface BulkResult {
  added: number;
  merged: number;
  failed: number;
}

export async function bulkAddWordsAction(
  rows: BulkRow[],
  studyDay: string,
): Promise<BulkResult> {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(studyDay) ? studyDay : studyDate();
  const result: BulkResult = { added: 0, merged: 0, failed: 0 };

  for (const row of rows.slice(0, 500)) {
    const surface = row.surface.trim();
    const reading = normalizeReading(row.reading) || surface;
    const meaning = row.meaning_ko.trim();
    if (!surface || !reading || !meaning) {
      result.failed++;
      continue;
    }
    try {
      const res = await insertWord({
        surface,
        reading,
        meaning_ko: meaning,
        study_day: day,
      });
      if (res.merged) result.merged++;
      else result.added++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
