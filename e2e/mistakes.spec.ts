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

/** 오답과 범위를 한 번에 저장하는 버튼. 「범위 저장」은 없다. */
const saveButton = (page: Page) => page.getByRole("button", { name: "저장", exact: true });

test.describe("풀이 범위", () => {
  test("오답이 없어도 범위만 저장되고, 같은 날 다시 저장하면 그 줄을 고쳐 쓴다", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // 폰 크기
    await page.goto("/mistakes/new");
    const from = page.getByLabel("시작 번호");
    const to = page.getByLabel("끝 번호");
    const save = saveButton(page);

    // 저장 길은 하나다. 「범위 저장」 버튼은 없다.
    await expect(page.getByRole("button", { name: "범위 저장" })).toHaveCount(0);
    // 폰에서 숫자 자판이 뜨고, 버튼은 손가락으로 누를 만한 크기다.
    await expect(from).toHaveAttribute("inputmode", "numeric");
    await expect(to).toHaveAttribute("inputmode", "numeric");
    expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
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
    await save.click();
    await expect(page.getByText("오늘 저장된 범위 · 마스터1500 11~21번 (11문항)")).toBeVisible();
    expect(await rangeRows()).toEqual([
      { source: "master1500", study_day: TODAY, from_no: 11, to_no: 21 },
    ]);

    // 거꾸로 적으면 저장하지 않는다.
    await to.fill("5");
    await save.click();
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

/** 오답 칸을 채운다. 분류까지 골라야 저장된다. */
async function fillMistake(page: Page, ref: string, category = "회상 실패") {
  await page.getByLabel("문항 번호").fill(ref);
  await page.getByLabel("분류").selectOption(category);
}

/**
 * 서버 액션 요청을 세고, 원하면 끊는다. 오답 저장의 본문에는 "category" 가, 범위 저장의 본문에는
 * "from" 이 있다. 저장 버튼 하나가 두 요청 중 무엇을 보냈는지는 화면으로는 알 수 없어서 요청으로 센다.
 */
async function watchActions(page: Page) {
  const seen = { range: 0, mistake: 0 };
  const block = { range: false, mistake: false };
  await page.route(/\/mistakes\/new/, async (route) => {
    const req = route.request();
    const body = req.method() === "POST" ? (req.postData() ?? "") : "";
    const kind = body.includes('"from"') ? "range" : body.includes('"category"') ? "mistake" : null;
    if (!kind) return route.continue();
    seen[kind]++;
    return block[kind] ? route.abort() : route.continue();
  });
  return { seen, block };
}

test.describe("저장 버튼 하나", () => {
  const from = (page: Page) => page.getByLabel("시작 번호");
  const to = (page: Page) => page.getByLabel("끝 번호");
  const status = (page: Page) => page.getByRole("status");
  const skipped = (page: Page, which: "시작 번호" | "끝 번호") =>
    page.getByText(`범위는 저장하지 않았습니다 (${which} 없음)`);
  const todayRange = (page: Page, text: string) => page.getByText(`오늘 저장된 범위 · ${text}`);

  test("오답이 채워지고 범위가 둘 다 채워지면 오답과 범위를 모두 저장한다", async ({ page }) => {
    await page.goto("/mistakes/new");
    await fillMistake(page, "13");
    await from(page).fill("11");
    await to(page).fill("20");
    await saveButton(page).click();

    await expect(status(page)).toContainText("저장했습니다 · 마스터1500 13 · 회상 실패");
    await expect(todayRange(page, "마스터1500 11~20번 (10문항)")).toBeVisible();
    await expect(page.getByText(/범위는 저장하지 않았습니다/)).toHaveCount(0);
    expect((await mistakeRows()).map((r) => r.ref)).toEqual(["13"]);
    expect(await rangeRows()).toEqual([
      { source: "master1500", study_day: TODAY, from_no: 11, to_no: 20 },
    ]);
  });

  test("오답이 채워지고 번호가 덜 찼으면 오답만 저장하고 이유를 한 줄로 알린다 — 막지 않는다", async ({
    page,
  }) => {
    await page.goto("/mistakes/new");

    // 시작 번호가 없다.
    await fillMistake(page, "13");
    await to(page).fill("20");
    await saveButton(page).click();
    await expect(status(page)).toContainText("저장했습니다 · 마스터1500 13");
    await expect(skipped(page, "시작 번호")).toBeVisible();
    await expect(saveButton(page)).toBeEnabled(); // 저장이 끝난 뒤에 DB 를 본다
    expect(await rangeRows()).toEqual([]);

    // 끝 번호가 없다. 이유가 바뀐다. 풀면서 하나씩 적을 때 모르는 끝 번호로 덮어쓰지 않으려는 것이다.
    await fillMistake(page, "14");
    await from(page).fill("11");
    await to(page).fill("");
    await saveButton(page).click();
    await expect(status(page)).toContainText("저장했습니다 · 마스터1500 14");
    await expect(skipped(page, "끝 번호")).toBeVisible();
    await expect(skipped(page, "시작 번호")).toHaveCount(0);
    await expect(saveButton(page)).toBeEnabled();
    expect(await rangeRows()).toEqual([]);

    // 끝 번호를 채우면 안내는 사라지고 범위도 저장된다.
    await fillMistake(page, "15");
    await to(page).fill("20");
    await saveButton(page).click();
    await expect(status(page)).toContainText("저장했습니다 · 마스터1500 15");
    await expect(page.getByText(/범위는 저장하지 않았습니다/)).toHaveCount(0);
    // 오답이 먼저 저장되고 범위가 뒤따른다. 범위가 저장된 것을 화면에서 본 뒤에 DB 를 본다.
    await expect(todayRange(page, "마스터1500 11~20번 (10문항)")).toBeVisible();
    expect((await mistakeRows()).map((r) => r.ref)).toEqual(["13", "14", "15"]);
    expect(await rangeRows()).toEqual([
      { source: "master1500", study_day: TODAY, from_no: 11, to_no: 20 },
    ]);
  });

  test("오답이 비고 범위가 둘 다 채워지면 범위만 저장한다 — 이어받은 문항 번호가 남아 있어도", async ({
    page,
  }) => {
    await page.goto("/mistakes/new");
    // 오답을 하나 적으면 다음 칸에 문항 번호가 이어받아 채워진다. 화면을 다시 열어도 그렇다.
    await fillMistake(page, "13");
    await saveButton(page).click();
    await expect(status(page)).toContainText("저장했습니다 · 마스터1500 13");
    await expect(page.getByLabel("문항 번호")).toHaveValue("13");

    // 번호만 남았고 분류도 안 골랐다. 오답을 적는 중이 아니라 범위를 적는 중이다.
    await from(page).fill("11");
    await to(page).fill("20");
    await saveButton(page).click();
    await expect(todayRange(page, "마스터1500 11~20번 (10문항)")).toBeVisible();
    await expect(page.getByText("분류를 골라주세요.")).toHaveCount(0);
    expect((await mistakeRows()).map((r) => r.ref)).toEqual(["13"]);
    expect(await rangeRows()).toEqual([
      { source: "master1500", study_day: TODAY, from_no: 11, to_no: 20 },
    ]);
  });

  test("오답도 범위도 비었으면 아무것도 저장하지 않고 예전처럼 빈 칸을 알린다", async ({ page }) => {
    await page.goto("/mistakes/new");
    await saveButton(page).click();
    await expect(page.getByText("분류를 골라주세요.")).toBeVisible();

    // 분류만 골랐다면 오답을 적으려는 것이다. 적은 것이 없다고 알린다.
    await page.getByLabel("분류").selectOption("회상 실패");
    await saveButton(page).click();
    await expect(page.getByText("문항 번호나 내용을 한 칸 이상 적어주세요.")).toBeVisible();

    expect(await mistakeRows()).toEqual([]);
    expect(await rangeRows()).toEqual([]);
  });

  test("오답이 저장되지 않으면 범위도 보내지 않고, 범위가 틀려도 오답은 저장한다", async ({
    page,
  }) => {
    await page.goto("/mistakes/new");
    // 분류를 안 골랐다.
    await page.getByLabel("문항 번호").fill("13");
    await from(page).fill("11");
    await to(page).fill("20");
    await saveButton(page).click();
    await expect(page.getByText("분류를 골라주세요.")).toBeVisible();
    expect(await mistakeRows()).toEqual([]);
    expect(await rangeRows()).toEqual([]);

    await page.getByLabel("분류").selectOption("회상 실패");
    await saveButton(page).click();
    await expect(status(page)).toContainText("저장했습니다 · 마스터1500 13");
    await expect(todayRange(page, "마스터1500 11~20번 (10문항)")).toBeVisible();
    expect(await rangeRows()).toHaveLength(1);

    // 범위를 거꾸로 적었다. 오답은 저장되고, 범위는 따로 알린다.
    await fillMistake(page, "14");
    await from(page).fill("20");
    await to(page).fill("11");
    await saveButton(page).click();
    await expect(status(page)).toContainText("저장했습니다 · 마스터1500 14");
    await expect(page.getByText("끝 번호가 시작 번호보다 앞입니다.")).toBeVisible();
    await expect(saveButton(page)).toBeEnabled();
    expect((await mistakeRows()).map((r) => r.ref)).toEqual(["13", "14"]);
    expect(await rangeRows()).toEqual([
      { source: "master1500", study_day: TODAY, from_no: 11, to_no: 20 },
    ]);
  });

  test("한쪽만 실패하면 어느 쪽인지 따로 보이고, 성공한 쪽은 다시 보내지 않는다", async ({
    page,
  }) => {
    const act = await watchActions(page);
    await page.goto("/mistakes/new");

    // 범위 쪽만 실패한다. 오답은 저장되고 범위 칸 아래에 따로 알린다.
    act.block.range = true;
    await fillMistake(page, "13");
    await from(page).fill("11");
    await to(page).fill("20");
    await saveButton(page).click();
    await expect(status(page)).toContainText("저장했습니다 · 마스터1500 13");
    await expect(page.getByText("범위 저장에 실패했습니다. 네트워크를 확인해주세요.")).toBeVisible();
    await expect(page.getByText("오답 저장에 실패했습니다.")).toHaveCount(0);
    expect((await mistakeRows()).map((r) => r.ref)).toEqual(["13"]);
    expect(await rangeRows()).toEqual([]);

    // 다시 누르면 저장된 오답은 다시 보내지 않고(칸이 비워졌다) 범위만 보낸다.
    act.block.range = false;
    await saveButton(page).click();
    await expect(todayRange(page, "마스터1500 11~20번 (10문항)")).toBeVisible();
    await expect(page.getByText("범위 저장에 실패했습니다.")).toHaveCount(0);
    expect((await mistakeRows()).map((r) => r.ref)).toEqual(["13"]);
    expect(act.seen).toEqual({ mistake: 1, range: 2 });

    // 오답 쪽만 실패한다. 오답이 저장되지 않았으니 범위도 보내지 않는다.
    act.block.mistake = true;
    await fillMistake(page, "14");
    await to(page).fill("21");
    await saveButton(page).click();
    await expect(page.getByText("오답 저장에 실패했습니다. 네트워크를 확인해주세요.")).toBeVisible();
    await expect(saveButton(page)).toBeEnabled();
    expect(act.seen.range).toBe(2);
    expect((await mistakeRows()).map((r) => r.ref)).toEqual(["13"]);

    act.block.mistake = false;
    await saveButton(page).click();
    await expect(status(page)).toContainText("저장했습니다 · 마스터1500 14");
    await expect(todayRange(page, "마스터1500 11~21번 (11문항)")).toBeVisible();
    expect((await mistakeRows()).map((r) => r.ref)).toEqual(["13", "14"]);
  });

  test("이미 저장된 같은 범위는 오답을 적을 때마다 다시 보내지 않는다", async ({ page }) => {
    const act = await watchActions(page);
    await page.goto("/mistakes/new");

    await fillMistake(page, "13");
    await from(page).fill("11");
    await to(page).fill("20");
    await saveButton(page).click();
    await expect(status(page)).toContainText("저장했습니다 · 마스터1500 13");
    await expect(saveButton(page)).toBeEnabled();
    expect(act.seen).toEqual({ mistake: 1, range: 1 });

    // 범위 칸에는 저장한 값이 그대로 남아 있다. 같은 값이니 오답만 보낸다.
    await fillMistake(page, "14");
    await saveButton(page).click();
    await expect(status(page)).toContainText("저장했습니다 · 마스터1500 14");
    await expect(saveButton(page)).toBeEnabled();
    expect(act.seen).toEqual({ mistake: 2, range: 1 });

    // 범위를 고치면 다시 보낸다.
    await fillMistake(page, "15");
    await to(page).fill("21");
    await saveButton(page).click();
    await expect(status(page)).toContainText("저장했습니다 · 마스터1500 15");
    await expect(saveButton(page)).toBeEnabled();
    expect(act.seen).toEqual({ mistake: 3, range: 2 });
    expect(await rangeRows()).toEqual([
      { source: "master1500", study_day: TODAY, from_no: 11, to_no: 21 },
    ]);
  });
});

/** 이름이 바뀐 표만 되돌린다. 앞선 실행이 도중에 죽어 남긴 찌꺼기도 치운다. */
async function restoreRangesTable() {
  await sql().query(
    `do $$ begin
       if to_regclass('public.study_ranges_off') is not null then
         alter table study_ranges_off rename to study_ranges;
       end if;
     end $$`,
  );
}

test.describe("풀이 범위 표가 아직 없는 DB", () => {
  // 최상위 beforeEach(resetDb)가 이 표를 비우므로, 그보다 먼저 찌꺼기를 치운다.
  test.beforeAll(restoreRangesTable);
  test.afterEach(restoreRangesTable);

  test("범위 칸은 없고, 저장 버튼은 오답을 그대로 저장한다", async ({ page }) => {
    // 스키마보다 코드가 먼저 올라간 상태. 쓰고 있는 오답 입력 화면이 죽지 않아야 한다.
    await sql().query(`alter table study_ranges rename to study_ranges_off`);
    await page.goto("/mistakes/new");
    await expect(page.getByRole("heading", { name: "오답 기록" })).toBeVisible();
    await expect(page.getByLabel("시작 번호")).toHaveCount(0);
    await expect(page.getByText(/푼 범위/)).toHaveCount(0);

    await fillMistake(page, "13");
    await saveButton(page).click();
    await expect(page.getByRole("status")).toContainText("저장했습니다 · 마스터1500 13 · 회상 실패");
    expect((await mistakeRows()).map((r) => r.ref)).toEqual(["13"]);
  });
});
