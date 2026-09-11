import { fetchHomophoneCounts, fetchQueueCandidates } from "./queries";
import { buildQueue, studyDate } from "./srs";
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
