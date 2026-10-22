import { expect, test } from "@playwright/test";
import { MARK, authenticate, resetDb, seed, seedTestable, sql, wordRow } from "./helpers";

const TODAY = new Date(Date.now() - 4 * 3600_000).toLocaleDateString("en-CA", {
  timeZone: "Asia/Seoul",
});

async function wordId(surface: string): Promise<string> {
  const rows = (await sql().query(`select id from words where surface = $1`, [surface])) as {
    id: string;
  }[];
  return rows[0].id;
}

const WORDS = [
  { surface: "抽象的", reading: "ちゅうしょうてき", meaning: "추상적" },
  { surface: "環境", reading: "かんきょう", meaning: "환경" },
  { surface: "協力", reading: "きょうりょく", meaning: "협력" },
];

/** 오늘 날짜로 테스트 문항을 만든다(앞의 surface 개수만큼). 시작 화면은 Task 11 이전이라 SQL 로 심는다. */
async function startTest(count: number): Promise<void> {
  await sql().query(
    `insert into typing_test_items (test_day, word_id)
     select $1::date, id from words where surface = any($2::text[])`,
    [TODAY, WORDS.slice(0, count).map((w) => w.surface)],
  );
}

async function itemRows() {
  return sql().query(
    `select w.surface, i.typed, i.correct, i.answered_at is not null as answered
       from typing_test_items i join words w on w.id = i.word_id order by w.surface`,
  );
}

async function reviewCount(): Promise<number> {
  const rows = (await sql().query(`select count(*)::int as n from reviews where not (prompt_type = 'learn')`)) as {
    n: number;
  }[];
  return rows[0].n;
}

async function testStateRows() {
  return sql().query(
    `select w.surface, r.prompt_type, r.correct, r.practice, r.in_session_retry, r.test
       from reviews r join words w on w.id = r.word_id
      where r.prompt_type <> 'learn' order by w.surface`,
  );
}

async function testSize(): Promise<number> {
  const rows = (await sql().query(`select test_size from settings where id = 1`)) as {
    test_size: number;
  }[];
  return rows[0].test_size;
}

test.beforeEach(async ({ context, baseURL }) => {
  await authenticate(context, baseURL!);
  await resetDb();
});

// 다른 테스트는 기본값 40 을 전제로 한다.
test.afterEach(() => sql().query(`update settings set test_size = 40 where id = 1`));
test.afterAll(resetDb);

test.describe("테스트 답 반영 (/api/test-answers)", () => {
  const post = (
    page: import("@playwright/test").Page,
    batchId: string,
    answers: { wordId: string; typed: string }[],
  ) => page.request.post("/api/test-answers", { data: { batchId, testDay: TODAY, answers } });

  test.beforeEach(async () => {
    await seedTestable(WORDS);
    await startTest(2);
  });

  test("서버가 다시 채점해 맞힌 단어는 주기를 두고, 틀린 단어는 stage 1 · 내일로 내린다", async ({
    page,
  }) => {
    const wrong = await wordId("抽象的");
    const right = await wordId("環境");
    const res = await post(page, "zz-batch-0001", [
      { wordId: wrong, typed: "ちゅうそうてき" },
      { wordId: right, typed: "かんきょう" },
    ]);
    expect(await res.json()).toEqual({ ok: true, applied: 2 });

    expect(await wordRow("抽象的")).toMatchObject({
      stage: 1,
      wrong_count: 1,
      streak: 0,
      last_wrong_type: "s2r",
    });
    expect((await wordRow("抽象的")).next_review).not.toBe((await wordRow("環境")).next_review);
    expect(await wordRow("環境")).toMatchObject({ stage: 3, correct_count: 1, wrong_count: 0 });

    // 테스트 행은 s2r · 연습 아님 · 재시도 아님 · test 표시가 붙는다 (유형 enum 을 늘리지 않는다)
    expect(await testStateRows()).toEqual([
      { surface: "抽象的", prompt_type: "s2r", correct: false, practice: false, in_session_retry: false, test: true },
      { surface: "環境", prompt_type: "s2r", correct: true, practice: false, in_session_retry: false, test: true },
    ]);
    expect(await itemRows()).toEqual([
      { surface: "抽象的", typed: "ちゅうそうてき", correct: false, answered: true },
      { surface: "環境", typed: "かんきょう", correct: true, answered: true },
    ]);
  });

  test("클라이언트가 정오를 어떻게 알려도 서버가 판정한다 (장음 ー 는 오답)", async ({ page }) => {
    const res = await page.request.post("/api/test-answers", {
      data: {
        batchId: "zz-batch-0002",
        testDay: TODAY,
        answers: [{ wordId: await wordId("抽象的"), typed: "ちゅーしょーてき", correct: true }],
      },
    });
    expect(await res.json()).toEqual({ ok: true, applied: 1 });
    expect(await wordRow("抽象的")).toMatchObject({ stage: 1, wrong_count: 1 });
  });

  test("같은 답이 다른 묶음 id 로 다시 와도 한 번만 반영된다 (Review Focus 3)", async ({ page }) => {
    const answers = [
      { wordId: await wordId("抽象的"), typed: "ちゅうそうてき" },
      { wordId: await wordId("環境"), typed: "かんきょう" },
    ];
    expect(await (await post(page, "zz-batch-0003", answers)).json()).toEqual({ ok: true, applied: 2 });
    const after = [await wordRow("抽象的"), await wordRow("環境")];
    expect(await reviewCount()).toBe(2);

    // 두 기기 · 응답 유실 뒤 새 id 로 다시 보낸 경우: 안 푼 문항이 없으니 아무것도 하지 않는다
    expect(await (await post(page, "zz-batch-0004", answers)).json()).toEqual({ ok: true, applied: 0 });
    // 같은 묶음을 그대로 다시 보낸 경우: 영수증이 알아본다
    expect(await (await post(page, "zz-batch-0003", answers)).json()).toEqual({
      ok: true,
      applied: 0,
      duplicate: true,
    });

    expect([await wordRow("抽象的"), await wordRow("環境")]).toEqual(after);
    expect(await reviewCount()).toBe(2);
  });

  test("한자가 섞인 답은 반영하지 않고 그 문항은 안 푼 채로 남는다", async ({ page }) => {
    const res = await post(page, "zz-batch-0005", [{ wordId: await wordId("抽象的"), typed: "抽象的" }]);
    expect(await res.json()).toEqual({ ok: true, applied: 0 });
    expect(await itemRows()).toEqual([
      { surface: "抽象的", typed: null, correct: null, answered: false },
      { surface: "環境", typed: null, correct: null, answered: false },
    ]);
    expect(await reviewCount()).toBe(0);
  });

  test("이번 테스트 문항에 없는 단어의 답은 반영하지 않는다", async ({ page }) => {
    const before = await wordRow("協力");
    const res = await post(page, "zz-batch-0006", [{ wordId: await wordId("協力"), typed: "ちがう" }]);
    expect(await res.json()).toEqual({ ok: true, applied: 0 });
    expect(await wordRow("協力")).toEqual(before);
  });

  test("쿠키 없이는 307 로 로그인으로 보낸다", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    const res = await ctx.request.post(`${baseURL}/api/test-answers`, {
      data: { batchId: "zz-batch-0007", testDay: TODAY, answers: [] },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toContain("/login");
    await ctx.close();
  });

  test("테스트에서 틀린 직후 같은 단어의 카드 채점은 주기를 다시 올리지 않는다", async ({ page }) => {
    const wrong = await wordId("抽象的");
    await post(page, "zz-batch-0008", [{ wordId: wrong, typed: "ちゅうそうてき" }]);
    const after = await wordRow("抽象的");

    const res = await page.request.post("/api/grades", {
      data: {
        batchId: "zz-grade-0001",
        grades: [{ wordId: wrong, kind: "s2r", correct: true, retry: false }],
      },
    });
    expect(await res.json()).toMatchObject({ ok: true, applied: 1 });
    expect(await wordRow("抽象的")).toEqual(after); // stage 1 · 내일 그대로
    const flashcardLogs = await sql().query(
      `select count(*)::int as n from reviews where test = false and prompt_type = 's2r'`,
    );
    expect(flashcardLogs).toEqual([{ n: 1 }]); // 카드 채점은 로그로 남는다
  });
});

test.describe("같은 날 카드 채점 가드", () => {
  test("그날 테스트에서 틀린 단어는 열어 둔 세션에서 맞혀도 주기가 다시 오르지 않는다", async ({
    page,
  }) => {
    await seed(
      [
        { surface: "抽象的", reading: "ちゅうしょうてき", meaning: "추상적" },
        { surface: "環境", reading: "かんきょう", meaning: "환경" },
      ],
      TODAY,
    );
    // 테스트에서 틀린 직후의 상태: stage 1 · 내일. 환경은 평소 복습 단어(대조군)다.
    await sql().query(
      `update words set stage = 1, next_review = current_date + 1, wrong_count = 1,
              last_wrong_type = 's2r' where surface = '抽象的' and note = $1`,
      [MARK],
    );
    await sql().query(
      `update words set stage = 2, next_review = current_date where surface = '環境' and note = $1`,
      [MARK],
    );
    await sql().query(
      `insert into typing_test_items (test_day, word_id, typed, correct, answered_at)
       select $1::date, id, 'ちゅうそうてき', false, now() from words where surface = '抽象的'`,
      [TODAY],
    );
    const before = await wordRow("抽象的");

    // 테스트 전에 열어 둔 학습 세션이 뒤늦게 두 단어를 맞혔다고 보낸다.
    const res = await page.request.post("/api/grades", {
      data: {
        batchId: "zz-guard-0001",
        grades: [
          { wordId: await wordId("抽象的"), kind: "s2r", correct: true, retry: false },
          { wordId: await wordId("環境"), kind: "s2r", correct: true, retry: false },
        ],
      },
    });
    expect(await res.json()).toMatchObject({ ok: true, applied: 2 });

    // 테스트가 내린 주기와 카운터는 그대로다. 로그만 남았다.
    expect(await wordRow("抽象的")).toEqual(before);
    // 대조군은 평소대로 오른다.
    expect(await wordRow("環境")).toMatchObject({ stage: 3, correct_count: 1 });
    const logs = await sql().query(
      `select w.surface, r.correct, r.practice, r.test
         from reviews r join words w on w.id = r.word_id order by w.surface`,
    );
    expect(logs).toEqual([
      { surface: "抽象的", correct: true, practice: false, test: false },
      { surface: "環境", correct: true, practice: false, test: false },
    ]);
  });
});

test.describe("실전 테스트 설정", () => {
  test("문제 수를 바꿔 저장하고, 범위 밖 값은 10~100 으로 맞춘다", async ({ page }) => {
    await page.goto("/settings");
    const size = page.getByLabel(/실전 테스트 문제 수/);
    await expect(size).toHaveValue("40");

    await size.fill("10");
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("저장했습니다.")).toBeVisible();
    expect(await testSize()).toBe(10);

    await size.fill("500");
    await page.getByRole("button", { name: "저장" }).click();
    await expect(size).toHaveValue("100");
    expect(await testSize()).toBe(100);
  });
});
