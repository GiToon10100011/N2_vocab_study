import { expect, test } from "@playwright/test";
import { authenticate, resetDb, sql } from "./helpers";

/** 기획서가 목표로 한 규모: 하루 30개 x 수개월. */
const SCALE = 2000;

function syntheticWords(n: number) {
  const kana = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほ";
  return Array.from({ length: n }, (_, i) => ({
    surface: `語${i.toString().padStart(5, "0")}`,
    reading: kana[i % kana.length] + kana[(i * 7) % kana.length] + kana[(i * 13) % kana.length],
    meaning: `뜻${i}`,
  }));
}

test.describe("규모 · 성능", () => {
  test.beforeAll(async () => {
    await resetDb();
    // 대량 삽입은 한 번에. 학습일을 흩어 일차 그룹도 여러 개 만든다.
    const rows = syntheticWords(SCALE);
    const chunk = 500;
    for (let i = 0; i < rows.length; i += chunk) {
      const part = rows.slice(i, i + chunk);
      const values = part
        .map((_, k) => `($${k * 4 + 1}, $${k * 4 + 2}, $${k * 4 + 3}, $${k * 4 + 4}::date)`)
        .join(",");
      const params = part.flatMap((r, k) => [
        r.surface,
        r.reading + (i + k), // 읽기 중복 회피
        r.meaning,
        new Date(Date.now() - ((i + k) % 60) * 86400_000).toLocaleDateString("en-CA", {
          timeZone: "Asia/Seoul",
        }),
      ]);
      await sql().query(
        `insert into words (surface, reading, meaning_ko, study_day) values ${values}
         on conflict (surface, reading) do nothing`,
        params,
      );
    }
    // 절반은 오늘 복습이 걸리도록 만든다
    await sql().query(
      `update words set stage = 3, next_review = current_date,
              correct_count = 3, streak = 3
        where surface < $1`,
      ["語01000"],
    );
    const n = (await sql().query(`select count(*)::int n from words`)) as { n: number }[];
    console.log(`\n[규모] 단어 ${n[0].n}개 적재 완료`);
  });

  test.afterAll(resetDb);

  test.beforeEach(async ({ context, baseURL }) => {
    await authenticate(context, baseURL!);
  });

  test(`${SCALE}개에서 주요 화면 응답 시간`, async ({ page }) => {
    const results: Record<string, number> = {};
    for (const path of ["/", "/study", "/words", "/stats", "/add"]) {
      // 콜드 스타트 영향을 줄이려 두 번째 측정을 쓴다
      await page.goto(path);
      const t0 = Date.now();
      await page.goto(path, { waitUntil: "domcontentloaded" });
      results[path] = Date.now() - t0;
    }
    console.log("[규모] 화면 응답(ms):", JSON.stringify(results));
    for (const [path, ms] of Object.entries(results)) {
      expect(ms, `${path} 응답이 3초를 넘으면 안 된다`).toBeLessThan(3000);
    }
  });

  test("세션 중 카드 전환에는 네트워크 왕복이 없다", async ({ page }) => {
    const urls: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "fetch" || r.resourceType() === "xhr") urls.push(r.url());
    });

    await page.goto("/study");
    await page.waitForSelector("footer button");

    const t0 = Date.now();
    const N = 20;
    for (let i = 0; i < N; i++) {
      await page.keyboard.press("Space"); // 공개 또는 다음
      await page.keyboard.press("1"); // 알았음(학습 카드면 무시됨)
    }
    const perCard = (Date.now() - t0) / N;
    console.log(`[세션] 카드당 조작 처리 ${perCard.toFixed(1)}ms · 채점 요청 ${urls.length}건`);

    // 20장 처리에 채점 배치(5장 단위)만 나가야 한다. 카드마다 조회가 나가면 실패.
    expect(urls.filter((u) => !u.includes("/api/grades")).length).toBe(0);
    expect(perCard, "카드 전환이 100ms 를 넘으면 안 된다").toBeLessThan(100);
  });

  test("큐 응답 크기가 상한 안에 있다", async ({ page }) => {
    const res = await page.goto("/study");
    const body = (await res!.body()).byteLength;
    console.log(`[세션] /study 응답 ${(body / 1024).toFixed(0)}KB`);
    expect(body, "세션 진입 페이로드가 1MB 를 넘으면 안 된다").toBeLessThan(1024 * 1024);
  });
});
