import {
  fetchHomophoneCounts,
  fetchQueueCandidates,
  fetchWordsInRange,
  searchWords,
} from "./queries";
import { buildPracticeQueue, buildQueue } from "./srs";
import { getSettingsAndToday } from "./settings";
import type { QueueCard } from "./types";

export interface TodayQueue {
  today: string;
  cards: QueueCard[];
}

/** 세션 시작 시 딱 한 번 호출된다. 이후 카드 전환에는 네트워크 왕복이 없다. */
export async function loadTodayQueue(skipNew: boolean): Promise<TodayQueue> {
  const { settings, today } = await getSettingsAndToday();
  const [words, readingCounts] = await Promise.all([
    fetchQueueCandidates(today),
    fetchHomophoneCounts(),
  ]);
  return {
    today,
    cards: buildQueue({
      words,
      today,
      readingCounts,
      skipNew,
      newLimit: settings.newLimit,
      reviewLimit: settings.reviewLimit,
      weights: settings.weights,
    }),
  };
}

/** 일차/주차 퀴즈. 매번 순서가 섞이고 SRS 에는 아무 영향이 없다. */
export async function loadPracticeQueue(from: string, to: string): Promise<TodayQueue> {
  const [{ settings, today }, words, readingCounts] = await Promise.all([
    getSettingsAndToday(),
    fetchWordsInRange(from, to),
    fetchHomophoneCounts(),
  ]);
  return {
    today,
    cards: buildPracticeQueue({ words, readingCounts, weights: settings.weights }),
  };
}

/** 오답노트 / 취약 단어 연습 큐. 역시 복습 주기는 건드리지 않는다. */
export async function loadFlagPracticeQueue(flag: "wrong" | "weak"): Promise<TodayQueue> {
  const [{ settings, today }, res, readingCounts] = await Promise.all([
    getSettingsAndToday(),
    searchWords({ flag, limit: 300 }),
    fetchHomophoneCounts(),
  ]);
  return {
    today,
    cards: buildPracticeQueue({ words: res.rows, readingCounts, weights: settings.weights }),
  };
}
