import {
  fetchHomophoneCounts,
  fetchQueueCandidates,
  fetchWordsInRange,
  searchWords,
} from "./queries";
import { buildPracticeQueue, buildQueue } from "./srs";
import { getSettingsAndToday } from "./settings";
import { markCaution } from "./typing-test";
import { readingCautionIds } from "./typing-test-load";
import type { QueueCard } from "./types";

export interface TodayQueue {
  today: string;
  cards: QueueCard[];
  /** 되돌리기 시간(초). 큐를 만들 때 이미 읽은 설정에서 함께 넘긴다. */
  undoSeconds: number;
}

/** 세션 시작 시 딱 한 번 호출된다. 이후 카드 전환에는 네트워크 왕복이 없다. */
export async function loadTodayQueue(skipNew: boolean): Promise<TodayQueue> {
  const { settings, today } = await getSettingsAndToday();
  const [words, readingCounts, caution] = await Promise.all([
    // 상한이 0(제한 없음)이면 조회 단계에서도 막지 않는다.
    fetchQueueCandidates(today, settings.newLimit > 0 ? settings.newLimit : undefined),
    fetchHomophoneCounts(),
    readingCautionIds(),
  ]);
  return {
    today,
    undoSeconds: settings.undoSeconds,
    cards: markCaution(
      buildQueue({
        words,
        today,
        readingCounts,
        skipNew,
        newLimit: settings.newLimit,
        reviewLimit: settings.reviewLimit,
        weights: settings.weights,
      }),
      caution,
    ),
  };
}

/** 일차/주차 퀴즈. 매번 순서가 섞이고 SRS 에는 아무 영향이 없다. */
export async function loadPracticeQueue(from: string, to: string): Promise<TodayQueue> {
  const [{ settings, today }, words, readingCounts, caution] = await Promise.all([
    getSettingsAndToday(),
    fetchWordsInRange(from, to),
    fetchHomophoneCounts(),
    readingCautionIds(),
  ]);
  return {
    today,
    undoSeconds: settings.undoSeconds,
    cards: markCaution(buildPracticeQueue({ words, readingCounts, weights: settings.weights }), caution),
  };
}

/** 오답노트 / 취약 단어 연습 큐. 역시 복습 주기는 건드리지 않는다. */
export async function loadFlagPracticeQueue(flag: "wrong" | "weak"): Promise<TodayQueue> {
  const [{ settings, today }, res, readingCounts, caution] = await Promise.all([
    getSettingsAndToday(),
    searchWords({ flag, limit: 300 }),
    fetchHomophoneCounts(),
    readingCautionIds(),
  ]);
  return {
    today,
    undoSeconds: settings.undoSeconds,
    cards: markCaution(
      buildPracticeQueue({ words: res.rows, readingCounts, weights: settings.weights }),
      caution,
    ),
  };
}
