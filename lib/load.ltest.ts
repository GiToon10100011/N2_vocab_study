import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import {
  fetchAllWords,
  fetchHomophoneCounts,
  fetchPeriodStats,
  fetchQueueCandidates,
  fetchStudyDays,
  fetchTodayCounts,
  searchWords,
} from "./queries";
import { buildQueue, studyDate, studyDayStart } from "./srs";

const N = 10_000;
const TODAY = studyDate();
const timings: { 항목: string; ms: number; 비고: string }[] = [];

async function measure<T>(label: string, note: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const out = await fn();
  timings.push({ 항목: label, ms: Math.round(performance.now() - t0), 비고: note });
  return out;
}

beforeAll(async () => {
  const before = (await db().query(`select count(*)::int n from words`)) as { n: number }[];
  const need = N - before[0].n;
  if (need <= 0) return;

  const kana = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめも";
  const chunk = 1000;
  for (let i = 0; i < need; i += chunk) {
    const part = Array.from({ length: Math.min(chunk, need - i) }, (_, k) => {
      const n = i + k;
      return [
        `語${n.toString().padStart(6, "0")}`,
        kana[n % kana.length] + kana[(n * 7) % kana.length] + n,
        `뜻${n}`,
        // 1년치 학습일에 흩는다
        new Date(Date.now() - (n % 365) * 86_400_000).toISOString().slice(0, 10),
        // 사다리 전 단계에 고루 분포
        n % 8,
      ];
    });
    const values = part
      .map((_, k) => `($${k * 5 + 1},$${k * 5 + 2},$${k * 5 + 3},$${k * 5 + 4}::date,$${k * 5 + 5})`)
      .join(",");
    await db().query(
      `insert into words (surface, reading, meaning_ko, study_day, stage) values ${values}
       on conflict (surface, reading) do nothing`,
      part.flat(),
    );
  }
  // 절반은 오늘 복습이 걸리게
  await db().query(
    `update words set next_review = current_date where stage > 0 and random() < 0.5`,
  );
  const after = (await db().query(`select count(*)::int n from words`)) as { n: number }[];
  timings.push({ 항목: "적재된 단어 수", ms: 0, 비고: `${after[0].n.toLocaleString()}개` });
});

afterAll(() => {
  // vitest 리포터가 afterAll 의 console 출력을 삼키므로 파일로 남긴다.
  writeFileSync("/tmp/load-timings.json", JSON.stringify(timings, null, 2));
});

describe("쿼리 응답 시간", () => {
  it("오늘 화면이 쓰는 쿼리", async () => {
    const counts = await measure("오늘 카운트", "홈 상단 숫자", () => fetchTodayCounts(TODAY));
    expect(counts.totalWords).toBeGreaterThanOrEqual(N);

    const days = await measure("학습일 그룹", "일차/주차 목록", () => fetchStudyDays(TODAY));
    expect(days.length).toBeGreaterThan(300);

    await measure("최근 7일 통계", "홈 하단", () =>
      fetchPeriodStats(studyDayStart(TODAY).toISOString()),
    );
  });

  it("세션 시작", async () => {
    const words = await measure("큐 후보 조회", "복습 400 + 신규 60 상한", () =>
      fetchQueueCandidates(TODAY),
    );
    const counts = await measure("동음 충돌 집계", "전체 group by", fetchHomophoneCounts);

    const t0 = performance.now();
    const cards = buildQueue({ words, today: TODAY, readingCounts: counts });
    timings.push({
      항목: "큐 구성(순수함수)",
      ms: Math.round(performance.now() - t0),
      비고: `${cards.length}장 생성`,
    });

    expect(words.length).toBeLessThanOrEqual(460); // 상한이 지켜진다
    expect(cards.length).toBeLessThanOrEqual(150 + 30 * 2);
  });

  it("단어 목록 검색", async () => {
    await measure("전체 목록", "300개 페이지", () => searchWords({ limit: 300 }));
    await measure("텍스트 검색", "ILIKE 3개 OR", () => searchWords({ q: "語0001", limit: 300 }));
    await measure("오답노트", "wrong_count > 0", () => searchWords({ flag: "wrong", limit: 300 }));
  });

  it("백업/내보내기", async () => {
    const all = await measure("전체 단어 조회", "CSV export", fetchAllWords);
    expect(all.length).toBeGreaterThanOrEqual(N);
    const bytes = JSON.stringify(all).length;
    timings.push({ 항목: "export 크기", ms: 0, 비고: `${(bytes / 1024 / 1024).toFixed(1)}MB` });
  });
});
