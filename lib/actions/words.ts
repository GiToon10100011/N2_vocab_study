"use server";

import { db } from "../db";
import { fetchStudyDays, fetchWordsBySurface, insertWord } from "../queries";
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
