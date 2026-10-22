import { expect, test } from "@playwright/test";
import { MARK, authenticate, resetDb, seed, sql, wordRow } from "./helpers";

const TODAY = new Date(Date.now() - 4 * 3600_000).toLocaleDateString("en-CA", {
  timeZone: "Asia/Seoul",
});

async function wordId(surface: string): Promise<string> {
  const rows = (await sql().query(`select id from words where surface = $1`, [surface])) as {
    id: string;
  }[];
  return rows[0].id;
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
