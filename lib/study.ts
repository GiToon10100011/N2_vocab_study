import { fetchHomophoneCounts, fetchQueueCandidates, fetchWordsInRange } from "./queries";
import { buildPracticeQueue, buildQueue, studyDate } from "./srs";
import type { QueueCard } from "./types";

export interface TodayQueue {
  today: string;
  cards: QueueCard[];
}

/** 세션 시작 시 딱 한 번 호출된다. 이후 카드 전환에는 네트워크 왕복이 없다. */
export async function loadTodayQueue(skipNew: boolean): Promise<TodayQueue> {
  const today = studyDate();
  const [words, readingCounts] = await Promise.all([
    fetchQueueCandidates(today),
    fetchHomophoneCounts(),
  ]);
  return { today, cards: buildQueue({ words, today, readingCounts, skipNew }) };
}

/** 일차/주차 퀴즈. 매번 순서가 섞이고 SRS 에는 아무 영향이 없다. */
export async function loadPracticeQueue(from: string, to: string): Promise<TodayQueue> {
  const [words, readingCounts] = await Promise.all([
    fetchWordsInRange(from, to),
    fetchHomophoneCounts(),
  ]);
  return { today: studyDate(), cards: buildPracticeQueue({ words, readingCounts }) };
}
