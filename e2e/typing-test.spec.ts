import { expect, test } from "@playwright/test";
import { MARK, authenticate, daysAgo, resetDb, seed, seedTestable, sql, wordRow } from "./helpers";

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

/** 문제에 따라 로마자로 칠 답. wrong 은 요음을 틀린 오답이다. */
const TYPE: Record<string, { right: string; wrong?: string }> = {
  抽象的: { right: "chuushouteki", wrong: "chuusouteki" },
  環境: { right: "kankyou" },
  協力: { right: "kyouryoku" },
};

type P = import("@playwright/test").Page;

const surfaceOf = (page: P) => page.getByTestId("question-surface");
const answerBox = (page: P) => page.getByLabel("읽기");
const testCard = (page: P) => page.getByRole("link", { name: /실전 테스트/ });

/** 홈에서 테스트를 시작해 첫 문제까지 간다. */
async function startFromHome(page: P) {
  await page.goto("/");
  await testCard(page).click();
  await page.getByRole("button", { name: "시작" }).click();
  await expect(surfaceOf(page)).toBeVisible();
}

/** 지금 문제를 푼다. right=false 면 오답을 친다(없으면 정답). 제출 뒤 결과를 보고 다음으로 넘어간다. */
async function solve(page: P, opts: { right?: boolean } = {}) {
  const surface = (await surfaceOf(page).innerText()).trim();
  const typed = opts.right === false ? (TYPE[surface].wrong ?? "ちがう") : TYPE[surface].right;
  await answerBox(page).fill(typed);
  await answerBox(page).press("Enter"); // 제출
  await expect(page.getByTestId("verdict")).toBeVisible();
  await answerBox(page).press("Enter"); // 다음
  return surface;
}

test.describe("실전 테스트 화면", () => {
  test.beforeEach(async () => {
    await seedTestable(WORDS);
  });

  test("시작부터 끝까지: 표기만 보이다가 제출하면 읽기 · 뜻 · 대조가 나오고 SRS 에 반영된다", async ({
    page,
  }) => {
    await startFromHome(page);

    // 답하기 전: 어떤 단어의 읽기도 뜻도 DOM 에 없다 (규칙 3)
    for (const w of WORDS) {
      await expect(page.locator("main")).not.toContainText(w.reading);
      await expect(page.locator("main")).not.toContainText(w.meaning);
    }

    for (let i = 0; i < 3; i++) {
      const surface = (await surfaceOf(page).innerText()).trim();
      if (surface === "抽象的") {
        await answerBox(page).fill("chuusouteki");
        await expect(page.getByTestId("reading-preview")).toContainText("ちゅうそうてき");
        await answerBox(page).press("Enter");
        const verdict = page.getByTestId("verdict");
        await expect(verdict).toContainText("틀렸습니다");
        await expect(verdict).toContainText("ちゅうしょうてき");
        await expect(verdict).toContainText("추상적");
        await expect(verdict).toContainText("[そ]");
        await expect(verdict).toContainText("[しょ]");
        await answerBox(page).press("Enter");
      } else {
        await solve(page);
      }
    }

    await expect(page.getByTestId("result-summary")).toHaveText("3문제 중 2개");
    await expect.poll(reviewCount).toBe(3); // 끝나면 곧바로 서버로 간다

    expect(await wordRow("抽象的")).toMatchObject({ stage: 1, wrong_count: 1, last_wrong_type: "s2r" });
    expect(await wordRow("環境")).toMatchObject({ stage: 3, correct_count: 1 });
    expect(await wordRow("協力")).toMatchObject({ stage: 3, correct_count: 1 });
    expect(await testStateRows()).toEqual([
      { surface: "協力", prompt_type: "s2r", correct: true, practice: false, in_session_retry: false, test: true },
      { surface: "抽象的", prompt_type: "s2r", correct: false, practice: false, in_session_retry: false, test: true },
      { surface: "環境", prompt_type: "s2r", correct: true, practice: false, in_session_retry: false, test: true },
    ]);
    expect((await itemRows()).find((r) => (r as { surface: string }).surface === "抽象的")).toMatchObject({
      typed: "ちゅうそうてき",
      correct: false,
    });

    // 홈: 끝낸 테스트의 카드는 사라지고, 최근 7일 복습 수에도 테스트 행이 들어가지 않는다
    await page.getByRole("link", { name: "홈으로" }).click();
    await expect(testCard(page)).toHaveCount(0);
    await expect(page.locator("section", { hasText: "최근 7일" })).toContainText("복습 0");

    // 이틀이 지나면 다시 뜬다 (끝낸 학습일 기준)
    await sql().query(`update typing_test_items set answered_at = answered_at - interval '2 days'`);
    await page.reload();
    await expect(testCard(page)).toContainText("3문제");
  });

  test("중간에 나가면 남은 문제만 홈에 보이고, 이어서 풀면 끝 화면은 전체 문제를 센다", async ({ page }) => {
    await startFromHome(page);
    await solve(page);
    await page.getByRole("button", { name: "나가기" }).click();
    await page.waitForURL("**/");

    await expect(testCard(page)).toContainText("남은 2문제");
    await testCard(page).click();
    await expect(page.getByText("2 / 3")).toBeVisible(); // 이미 푼 한 문제는 세어서 이어 간다
    await solve(page);
    await solve(page);
    await expect(page.getByTestId("result-summary")).toHaveText("3문제 중 3개");
  });

  test("한자가 섞인 입력은 채점하지 않고, IME 확정 Enter(keyCode 229)는 제출하지 않는다 (Review Focus 1)", async ({
    page,
  }) => {
    await startFromHome(page);
    const box = answerBox(page);

    await box.fill("抽象的");
    await box.press("Enter");
    await expect(page.getByText("가나로 다시 입력")).toBeVisible();
    await expect(page.getByTestId("verdict")).toHaveCount(0);
    expect(await reviewCount()).toBe(0);

    // 사파리가 조합을 확정할 때 보내는 Enter: compositionend 뒤라 isComposing 은 false 이고 keyCode 가 229
    await box.fill("ちゅう");
    await box.evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true }),
      ),
    );
    await expect(page.getByTestId("verdict")).toHaveCount(0);

    await box.press("Enter"); // 진짜 Enter 는 제출이다
    await expect(page.getByTestId("verdict")).toBeVisible();
  });

  test("도중에 단어를 보류하면 남은 수에서 빠지고, 다 풀면 끝나며 홈에 남은 수가 고이지 않는다 (Review Focus 2)", async ({
    page,
  }) => {
    await startFromHome(page);
    await solve(page); // 한 문제는 정답
    // 이 답은 아직 이 기기에만 있다(나갈 때 · 10개마다 · 끝날 때 보낸다). 서버 상태를 읽기 전에 보낸다.
    await page.getByRole("button", { name: "나가기" }).click();
    await page.waitForURL("**/");

    const open = (await sql().query(
      `select w.surface from typing_test_items i join words w on w.id = i.word_id
        where i.answered_at is null order by w.surface`,
    )) as { surface: string }[];
    expect(open).toHaveLength(2);
    await sql().query(`update words set suspended = true where surface = $1`, [open[0].surface]);

    await page.reload(); // 보류된 단어가 빠진 남은 수가 홈에 보인다
    await expect(testCard(page)).toContainText("남은 1문제");
    await testCard(page).click();
    await expect(surfaceOf(page)).toBeVisible();
    await expect(page.getByText("2 / 2")).toBeVisible();
    await solve(page);
    await expect(page.getByTestId("result-summary")).toHaveText("2문제 중 2개");

    await page.getByRole("link", { name: "홈으로" }).click();
    await expect(testCard(page)).toHaveCount(0);
    await expect(page.getByText(/남은 \d+문제/)).toHaveCount(0);
  });
});

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

test.describe("읽기 주의 배지", () => {
  test("테스트에서 틀린 뒤 두 번 연속 맞히기 전까지 플래시카드에 읽기 주의가 붙는다", async ({ page }) => {
    await seedTestable(WORDS);
    // 세 단어 모두 오늘 복습이 걸려 있다. 抽象的 는 테스트에서 틀려 약점 유형이 s2r 로 남은 상태다.
    await sql().query(`update words set stage = 2, next_review = current_date where note = $1`, [MARK]);
    await sql().query(
      `update words set wrong_count = 1, last_wrong_type = 's2r' where surface = '抽象的' and note = $1`,
      [MARK],
    );
    // 테스트 이력(오래된 것부터): 抽象的 [오답] · 環境 [오답, 정답] · 協力 [오답, 정답, 정답]
    const history: Record<string, boolean[]> = {
      抽象的: [false],
      環境: [false, true],
      協力: [false, true, true],
    };
    for (const [surface, results] of Object.entries(history)) {
      for (const [i, ok] of results.entries()) {
        const ago = 9 - i * 2; // 같은 단어의 테스트 날짜가 겹치지 않게
        await sql().query(
          `insert into typing_test_items (test_day, word_id, typed, correct, answered_at)
           select $1::date, id, 'あ', $2, now() - make_interval(days => $3::int) from words where surface = $4`,
          [daysAgo(ago), ok, ago, surface],
        );
      }
    }

    await page.goto("/study");
    const badge: Record<string, boolean> = {};
    for (let i = 0; i < 3; i++) {
      const text = await page.locator("main").innerText();
      const word = WORDS.find((w) => text.includes(w.surface) || text.includes(w.reading))!;
      badge[word.surface] = text.includes("읽기 주의");
      // 테스트에서 틀린 단어는 다음 복습에서 읽기(s2r)로 나온다 — last_wrong_type 규칙 그대로의 의도된 동작
      if (word.surface === "抽象的") expect(text).toContain("읽기는?");
      await page.keyboard.press("Space");
      await page.keyboard.press("1");
    }
    expect(badge).toEqual({ 抽象的: true, 環境: true, 協力: false });
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
