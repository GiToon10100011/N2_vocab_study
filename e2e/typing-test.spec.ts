import { expect, test } from "@playwright/test";
import { authenticate, resetDb, sql } from "./helpers";

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
