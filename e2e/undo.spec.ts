import { expect, test, type Page } from "@playwright/test";
import { MARK, authenticate, resetDb, seed, sql } from "./helpers";

const TODAY = new Date(Date.now() - 4 * 3600_000).toLocaleDateString("en-CA", {
  timeZone: "Asia/Seoul",
});

const WORDS = [
  { surface: "環境", reading: "かんきょう", meaning: "환경" },
  { surface: "改善", reading: "かいぜん", meaning: "개선" },
  { surface: "違反", reading: "いはん", meaning: "위반" },
  { surface: "協力", reading: "きょうりょく", meaning: "협력" },
  { surface: "普及", reading: "ふきゅう", meaning: "보급" },
  { surface: "試験", reading: "しけん", meaning: "시험" },
  { surface: "経済", reading: "けいざい", meaning: "경제" },
  { surface: "政治", reading: "せいじ", meaning: "정치" },
];

async function setUndoSeconds(seconds: number) {
  await sql().query(`update settings set undo_seconds = $1 where id = 1`, [seconds]);
}

async function undoSeconds(): Promise<number> {
  const rows = (await sql().query(`select undo_seconds from settings where id = 1`)) as {
    undo_seconds: number;
  }[];
  return rows[0].undo_seconds;
}

async function reviewCount(): Promise<number> {
  const rows = (await sql().query(`select count(*)::int as n from reviews`)) as { n: number }[];
  return rows[0].n;
}

/** 학습 카드 없이 퀴즈만 n장 나오도록, 오늘 복습이 걸린 단어를 넣는다. */
async function seedDue(n: number) {
  await seed(WORDS.slice(0, n), TODAY);
  await sql().query(
    `update words set stage = 2, next_review = current_date, correct_count = 2, streak = 2
      where note = $1`,
    [MARK],
  );
}

/** 정답 공개 -> 알았음. */
async function gradeCorrect(page: Page, cards: number) {
  for (let i = 0; i < cards; i++) {
    await page.keyboard.press("Space");
    await page.keyboard.press("1");
  }
}

const counter = (page: Page) => page.locator("header span.tabular-nums");
const undoButton = (page: Page) => page.getByRole("button", { name: /되돌리기/ });

test.beforeEach(async ({ context, baseURL }) => {
  await authenticate(context, baseURL!);
  await resetDb();
  await setUndoSeconds(5);
});

// 다른 스펙은 기본값 5초를 전제로 한다.
test.afterEach(() => setUndoSeconds(5));
test.afterAll(resetDb);

test.describe("되돌리기 시간", () => {
  test("설정에서 늘리면 6장 넘게 빠르게 채점한 뒤에도 전부 되돌릴 수 있다", async ({ page }) => {
    await seedDue(8);

    await page.goto("/settings");
    const seconds = page.getByLabel(/되돌리기 시간/);
    await expect(seconds).toHaveValue("5"); // 설정을 바꾸기 전에는 지금까지와 같은 5초
    await seconds.fill("30");
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("저장했습니다.")).toBeVisible();
    expect(await undoSeconds()).toBe(30);

    await page.goto("/study");
    await expect(counter(page)).toHaveText("1 / 8");
    await gradeCorrect(page, 7);
    await expect(counter(page)).toHaveText("8 / 8");
    // 예전에는 5장째에 전송되면서 되돌리기가 끊겼다. 지금은 아무것도 보내지 않았다.
    expect(await reviewCount()).toBe(0);

    for (let i = 0; i < 7; i++) {
      await expect(undoButton(page)).toBeEnabled();
      await page.keyboard.press("u");
    }
    await expect(counter(page)).toHaveText("1 / 8");
    await expect(undoButton(page)).toBeDisabled();

    // 되돌린 채점은 서버에 가지 않는다. 첫 카드만 몰랐음으로 다시 채점하고 나간다.
    await page.keyboard.press("2");
    await page.getByRole("button", { name: "나가기" }).click();
    await page.waitForURL("**/");
    const rows = await sql().query(`select correct, in_session_retry from reviews`);
    expect(rows).toEqual([{ correct: false, in_session_retry: false }]);
  });

  test("상시로 두면 손을 멈춰도 보내지 않고, 세션이 끝날 때 전송된다", async ({ page }) => {
    await seedDue(3);

    await page.goto("/settings");
    await page.getByLabel(/^상시/).check();
    await expect(page.getByLabel(/되돌리기 시간/)).toBeDisabled();
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("저장했습니다.")).toBeVisible();
    expect(await undoSeconds()).toBe(0);

    await page.goto("/study");
    await gradeCorrect(page, 2);
    await expect(counter(page)).toHaveText("3 / 3");

    await page.waitForTimeout(6500); // 기본 5초보다 오래 손을 멈춘다
    expect(await reviewCount()).toBe(0);
    await expect(undoButton(page)).toBeEnabled();
    await page.keyboard.press("u");
    await expect(counter(page)).toHaveText("2 / 3");

    await page.keyboard.press("1"); // 되돌린 카드는 정답이 공개된 채로 돌아온다
    await gradeCorrect(page, 1);
    await expect(page.getByText("오늘의 학습 완료")).toBeVisible();
    await expect.poll(reviewCount).toBe(3);
  });
});

test.describe("채점 복구", () => {
  test.beforeEach(async ({ page }) => {
    await setUndoSeconds(0);
    await seedDue(4);
    await page.goto("/study");
    await gradeCorrect(page, 2);
    await expect(counter(page)).toHaveText("3 / 4");
    expect(await reviewCount()).toBe(0);

    // 세션을 끝내지 않고 닫는다. 닫는 순간에는 아무것도 보내지 않는다.
    await page.close();
    await new Promise((r) => setTimeout(r, 1000));
    expect(await reviewCount()).toBe(0);
  });

  /** 두 장이 한 번씩만 반영됐는지. 두 번 반영되면 stage 가 4 가 된다. */
  async function expectAppliedOnce() {
    const rows = await sql().query(
      `select stage, correct_count from words where note = $1 order by stage, surface`,
      [MARK],
    );
    expect(rows).toEqual([
      { stage: 2, correct_count: 2 },
      { stage: 2, correct_count: 2 },
      { stage: 3, correct_count: 3 },
      { stage: 3, correct_count: 3 },
    ]);
  }

  test("닫았다가 학습 화면을 다시 열면 채점이 전송되고, 이미 푼 카드는 다시 나오지 않는다", async ({
    context,
  }) => {
    const again = await context.newPage();
    await again.goto("/study");

    await expect.poll(reviewCount).toBe(2);
    await expect(counter(again)).toHaveText("1 / 2"); // 반영된 뒤의 큐를 새로 받았다
    await expectAppliedOnce();
    expect(await again.evaluate(() => localStorage.getItem("n2v_pending_grades"))).toBeNull();
  });

  test("전송에 실패하면 시작을 막고 채점을 남겨 두며, 다시 시도하면 전송된다", async ({
    context,
  }) => {
    const again = await context.newPage();
    let offline = true;
    await again.route("**/api/grades", (route) => (offline ? route.abort() : route.continue()));
    await again.goto("/study");

    await expect(again.getByText("지난 세션의 채점 2건을 아직 반영하지 못했습니다")).toBeVisible();
    // 막힌 동안에는 키를 눌러도 카드가 넘어가지 않고, 채점은 기기에 그대로 있다.
    await again.keyboard.press("Space");
    await again.keyboard.press("1");
    expect(await reviewCount()).toBe(0);
    const kept = await again.evaluate(() =>
      (JSON.parse(localStorage.getItem("n2v_pending_grades") ?? "[]") as { grades: unknown[] }[])
        .map((b) => b.grades.length)
        .reduce((a, b) => a + b, 0),
    );
    expect(kept).toBe(2);

    offline = false;
    await again.getByRole("button", { name: "다시 시도" }).click();
    await expect.poll(reviewCount).toBe(2);
    await expect(counter(again)).toHaveText("1 / 2");
    await expectAppliedOnce();
  });

  test("닫았다가 홈을 다시 열면 채점이 전송되고 홈의 숫자가 맞춰진다", async ({ context }) => {
    const again = await context.newPage();
    await again.goto("/");

    await expect.poll(reviewCount).toBe(2);
    await expect(again.locator("span.text-3xl")).toHaveText("2"); // 남은 복습
    await expectAppliedOnce();

    await again.getByRole("link", { name: /시작/ }).click();
    await expect(counter(again)).toHaveText("1 / 2");
    await expectAppliedOnce();
  });
});

test.describe("응답을 받지 못한 전송", () => {
  test("서버가 반영했는데 응답이 닿지 않았으면, 다시 보내도 한 번만 반영된다", async ({
    page,
    context,
  }) => {
    await setUndoSeconds(0); // 상시: 세션 전체가 마지막에 한 묶음으로 나간다
    await seedDue(2);

    // 요청은 서버까지 보내고 응답만 끊는다. 마지막 카드를 끝내자마자 앱을 닫은 상황이다.
    let cut = 0;
    await page.route("**/api/grades", async (route) => {
      await route.fetch();
      cut++;
      await route.abort();
    });
    await page.goto("/study");
    await gradeCorrect(page, 2);
    await expect(page.getByText("오늘의 학습 완료")).toBeVisible();
    await expect.poll(reviewCount).toBe(2); // 서버는 반영했다
    await expect.poll(() => cut).toBe(1);
    // 클라이언트는 응답을 받지 못해 채점을 그대로 쥐고 있다.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("n2v_pending_grades")))
      .not.toBeNull();
    await page.close();

    // 다시 열면 남은 묶음을 또 보낸다. 서버는 같은 묶음임을 알아보고 반영하지 않는다.
    const again = await context.newPage();
    const answers: unknown[] = [];
    again.on("response", (res) => {
      if (res.url().includes("/api/grades")) void res.json().then((body) => answers.push(body));
    });
    await again.goto("/");
    await expect.poll(() => answers).toEqual([{ ok: true, applied: 0, duplicate: true }]);
    await expect
      .poll(() => again.evaluate(() => localStorage.getItem("n2v_pending_grades")))
      .toBeNull();

    // 두 번 반영됐다면 리뷰가 4건, stage 가 4 가 된다.
    expect(await reviewCount()).toBe(2);
    const rows = await sql().query(
      `select stage, correct_count from words where note = $1 order by surface`,
      [MARK],
    );
    expect(rows).toEqual([
      { stage: 3, correct_count: 3 },
      { stage: 3, correct_count: 3 },
    ]);
  });
});
