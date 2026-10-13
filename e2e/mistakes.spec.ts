import { expect, test, type Page } from "@playwright/test";
import { authenticate, resetDb, sql } from "./helpers";

/** 선택지 n번째 줄의 입력 칸. 삭제 버튼(「선택지 n 삭제」)과 겹치지 않게 이름 전체로 찾는다. */
const choice = (page: Page, n: number) => page.getByLabel(`선택지 ${n}`, { exact: true });
const choices = (page: Page) => page.getByLabel(/^선택지 \d+$/);

const day = (hoursAgo: number) =>
  new Date(Date.now() - hoursAgo * 3600_000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Seoul",
  });
// 하루 경계가 04:00 이다.
const TODAY = day(4);
const YESTERDAY = day(28);

test.beforeEach(async ({ context, baseURL }) => {
  await authenticate(context, baseURL!);
  await resetDb();
});

test.afterAll(resetDb);

async function mistakeRows() {
  return (await sql().query(
    `select source, ref, question, chosen, answer, why, category,
            to_char(study_day, 'YYYY-MM-DD') as study_day, resolved_at
       from mistakes order by id`,
  )) as Record<string, unknown>[];
}

test.describe("오답 기록", () => {
  test("키보드만으로 적고 저장하면 출처와 문항 번호에서 이어진다", async ({ page }) => {
    await page.goto("/mistakes/new");
    await page.getByRole("button", { name: "문법" }).click();

    // Enter 로 칸을 넘긴다. 순서는 문항 번호 -> 선택지(한 줄에 하나) -> 고른 답 -> 정답 -> 왜 -> 분류.
    const ref = page.getByLabel("문항 번호");
    await ref.fill("Part A-3");
    await ref.press("Enter");
    await expect(choice(page, 1)).toBeFocused();
    await page.keyboard.type("去年");
    await page.keyboard.press("Enter"); // 마지막 줄에서 Enter = 다음 줄이 생긴다
    await expect(choice(page, 2)).toBeFocused();
    await page.keyboard.type("去年に");
    await page.keyboard.press("Enter");
    await expect(choice(page, 3)).toBeFocused();
    await page.keyboard.press("Enter"); // 빈 줄에서 Enter = 선택지는 여기까지
    await expect(page.getByLabel("고른 답")).toBeFocused();
    await expect(choices(page)).toHaveCount(2);
    await page.keyboard.type("去年に");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("정답")).toBeFocused();
    await page.keyboard.type("去年");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("왜 틀렸다고")).toBeFocused();
    await page.keyboard.type("쉼표 유무에 따라 다를 거라고 생각했다");
    await page.keyboard.press("Enter");

    const category = page.getByLabel("분류");
    await expect(category).toBeFocused();
    await category.selectOption("개념 부족");
    await category.press("Enter"); // 분류에서 Enter = 저장

    await expect(page.getByRole("status")).toContainText("저장했습니다 · 문법 Part A-3 · 개념 부족");
    expect(await mistakeRows()).toEqual([
      {
        source: "grammar",
        ref: "Part A-3",
        question: "去年\n去年に",
        chosen: "去年に",
        answer: "去年",
        why: "쉼표 유무에 따라 다를 거라고 생각했다",
        category: "개념 부족",
        study_day: TODAY,
        resolved_at: null,
      },
    ]);

    // 바로 다음 건을 적을 수 있는 상태: 출처·문항 번호는 남고 나머지는 비워진다.
    await expect(ref).toBeFocused();
    await expect(ref).toHaveValue("Part A-3");
    await expect(page.getByRole("button", { name: "문법" })).toHaveAttribute("aria-pressed", "true");
    await expect(choices(page)).toHaveCount(1);
    await expect(choice(page, 1)).toHaveValue("");
    await expect(page.getByLabel("왜 틀렸다고")).toHaveValue("");
    await expect(category).toHaveValue("");

    // 화면을 다시 열어도 직전 출처와 문항 번호에서 이어진다.
    await page.reload();
    await expect(page.getByLabel("문항 번호")).toHaveValue("Part A-3");
    await expect(page.getByRole("button", { name: "문법" })).toHaveAttribute("aria-pressed", "true");
  });

  test("선택지는 줄을 더하고 지울 수 있고, 하나도 없이 저장하면 다음 문항도 줄 없이 시작한다", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // 폰 크기
    await page.goto("/mistakes/new");
    const ref = page.getByLabel("문항 번호");
    await ref.fill("7");
    await ref.press("Enter");
    await page.keyboard.type("あ");
    await page.keyboard.press("Enter");
    await page.keyboard.type("い");

    // IME 로 변환을 확정하는 Enter 는 줄을 넘기지 않는다.
    await choice(page, 2).evaluate((el) =>
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }),
      ),
    );
    await expect(choice(page, 2)).toBeFocused();
    await expect(choices(page)).toHaveCount(2);

    await page.keyboard.press("Enter");
    await page.keyboard.type("う");
    await expect(choices(page)).toHaveCount(3);

    // 추가·삭제 버튼은 손가락으로 누를 만한 크기다.
    for (const name of ["선택지 2 삭제", "+ 선택지 추가"]) {
      const box = (await page.getByRole("button", { name }).boundingBox())!;
      expect(Math.min(box.width, box.height), name).toBeGreaterThanOrEqual(44);
    }

    // 가운데 줄을 지우면 뒤 줄이 당겨지고 커서가 그 줄로 간다.
    await page.getByRole("button", { name: "선택지 2 삭제" }).click();
    await expect(choices(page)).toHaveCount(2);
    await expect(choice(page, 2)).toHaveValue("う");
    await expect(choice(page, 2)).toBeFocused();

    await page.getByRole("button", { name: "+ 선택지 추가" }).click();
    await expect(choice(page, 3)).toBeFocused();
    await page.keyboard.type("え");

    await page.getByLabel("분류").selectOption("문법 구별 실패");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("마스터1500 7 · 문법 구별 실패");
    expect((await mistakeRows()).map((r) => r.question)).toEqual(["あ\nう\nえ"]);

    // 선택지가 없는 문항은 빈 줄에서 Enter 로 넘긴다.
    await expect(choices(page)).toHaveCount(1);
    await ref.fill("8");
    await ref.press("Enter");
    await expect(choice(page, 1)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("고른 답")).toBeFocused();
    await expect(choices(page)).toHaveCount(0);
    await page.getByLabel("분류").selectOption("회상 실패");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("마스터1500 8 · 회상 실패");
    expect((await mistakeRows()).map((r) => r.question)).toEqual(["あ\nう\nえ", null]);

    // 선택지 없이 넘긴 다음에는 줄 없이 시작해서, 문항 번호에서 바로 고른 답으로 간다.
    await expect(choices(page)).toHaveCount(0);
    await ref.press("Enter");
    await expect(page.getByLabel("고른 답")).toBeFocused();
  });

  test("분류를 고르지 않으면 저장하지 않고, 어제 푼 문제는 어제 날짜로 들어간다", async ({
    page,
  }) => {
    await page.goto("/mistakes/new");
    await page.getByLabel("문항 번호").fill("12");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByText("분류를 골라주세요.")).toBeVisible();
    expect(await mistakeRows()).toHaveLength(0);

    await page.getByRole("button", { name: "어제" }).click();
    await page.getByLabel("분류").selectOption("회상 실패");
    await page.getByRole("button", { name: "저장", exact: true }).click();

    await expect(page.getByRole("status")).toContainText("저장했습니다 · 마스터1500 12 · 회상 실패");
    expect(await mistakeRows()).toEqual([
      {
        source: "master1500",
        ref: "12",
        question: null,
        chosen: null,
        answer: null,
        why: null,
        category: "회상 실패",
        study_day: YESTERDAY,
        resolved_at: null,
      },
    ]);
  });
});

async function rangeRows() {
  return (await sql().query(
    `select source, to_char(study_day, 'YYYY-MM-DD') as study_day, from_no, to_no
       from study_ranges order by study_day, source`,
  )) as Record<string, unknown>[];
}

test.describe("풀이 범위", () => {
  test("오답이 없어도 범위만 저장되고, 같은 날 다시 저장하면 그 줄을 고쳐 쓴다", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // 폰 크기
    await page.goto("/mistakes/new");
    const from = page.getByLabel("시작 번호");
    const to = page.getByLabel("끝 번호");
    const saveRange = page.getByRole("button", { name: "범위 저장" });

    // 폰에서 숫자 자판이 뜨고, 버튼은 손가락으로 누를 만한 크기다.
    await expect(from).toHaveAttribute("inputmode", "numeric");
    await expect(to).toHaveAttribute("inputmode", "numeric");
    expect((await saveRange.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByText("오늘 저장된 범위가 없습니다")).toBeVisible();

    await from.fill("11");
    await from.press("Enter");
    await expect(to).toBeFocused();
    await page.keyboard.type("20");
    await page.keyboard.press("Enter"); // 끝 번호에서 Enter = 저장
    await expect(page.getByText("오늘 저장된 범위 · 마스터1500 11~20번 (10문항)")).toBeVisible();
    await expect(page.getByLabel("문항 번호")).toBeFocused(); // 이어서 오답을 적는다
    expect(await rangeRows()).toEqual([
      { source: "master1500", study_day: TODAY, from_no: 11, to_no: 20 },
    ]);
    expect(await mistakeRows()).toHaveLength(0);

    // 끝 번호를 잘못 적었다. 다시 저장하면 줄이 늘지 않고 고쳐진다.
    await to.fill("21");
    await saveRange.click();
    await expect(page.getByText("오늘 저장된 범위 · 마스터1500 11~21번 (11문항)")).toBeVisible();
    expect(await rangeRows()).toEqual([
      { source: "master1500", study_day: TODAY, from_no: 11, to_no: 21 },
    ]);

    // 거꾸로 적으면 저장하지 않는다.
    await to.fill("5");
    await saveRange.click();
    await expect(page.getByText("끝 번호가 시작 번호보다 앞입니다.")).toBeVisible();
    expect(await rangeRows()).toEqual([
      { source: "master1500", study_day: TODAY, from_no: 11, to_no: 21 },
    ]);

    // 다시 열어도 보이고, 칸에는 저장한 값이 들어 있다.
    await page.reload();
    await expect(page.getByText("오늘 저장된 범위 · 마스터1500 11~21번 (11문항)")).toBeVisible();
    await expect(from).toHaveValue("11");
    await expect(to).toHaveValue("21");
  });

  test("교재와 학습일마다 한 줄씩 남고, 다음 날은 이어지는 번호에서 시작하며, 범위 안의 오답 수를 조회할 수 있다", async ({
    page,
  }) => {
    await sql().query(
      `insert into study_ranges (source, study_day, from_no, to_no)
       values ('master1500', $1::date, 11, 20)`,
      [YESTERDAY],
    );
    // 범위 안 2건, 범위 밖 1건, 숫자가 아닌 번호 1건, 다른 날 1건.
    for (const [ref, day] of [
      ["13", YESTERDAY],
      ["17", YESTERDAY],
      ["25", YESTERDAY],
      ["Part A-3", YESTERDAY],
      ["15", TODAY],
    ]) {
      await sql().query(
        `insert into mistakes (source, ref, category, study_day)
         values ('master1500', $1, '회상 실패', $2::date)`,
        [ref, day],
      );
    }

    await page.goto("/mistakes/new");
    const from = page.getByLabel("시작 번호");
    const to = page.getByLabel("끝 번호");
    // 오늘 것은 아직 없다. 시작 번호는 어제 끝난 다음 번호다.
    await expect(from).toHaveValue("21");
    await expect(to).toHaveValue("");

    // 어제로 바꾸면 어제 저장한 범위가 칸에 들어온다.
    await page.getByRole("button", { name: "어제" }).click();
    await expect(page.getByText("어제 저장된 범위 · 마스터1500 11~20번 (10문항)")).toBeVisible();
    await expect(from).toHaveValue("11");
    await expect(to).toHaveValue("20");

    // 다른 교재는 같은 날에도 따로 남는다.
    await page.getByRole("button", { name: "문법" }).click();
    await expect(from).toHaveValue("");
    await from.fill("3");
    await to.fill("7");
    await to.press("Enter");
    await expect(
      page.getByText("어제 저장된 범위 · 마스터1500 11~20번 (10문항) · 문법 3~7번 (5문항)"),
    ).toBeVisible();

    // 앱 밖에서 읽기 전용으로 조회한다.
    const summary = await sql().query(
      `select source, to_char(study_day, 'YYYY-MM-DD') as study_day, from_no, to_no,
              solved, mistakes, mistake_refs
         from study_range_summary order by source`,
    );
    expect(summary).toEqual([
      {
        source: "grammar",
        study_day: YESTERDAY,
        from_no: 3,
        to_no: 7,
        solved: 5,
        mistakes: 0,
        mistake_refs: [],
      },
      {
        source: "master1500",
        study_day: YESTERDAY,
        from_no: 11,
        to_no: 20,
        solved: 10,
        mistakes: 2,
        mistake_refs: ["13", "17"],
      },
    ]);
  });
});
