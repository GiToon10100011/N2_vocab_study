import { expect, test } from "@playwright/test";
import { MARK, authenticate, resetDb, seed, sql, wordRow } from "./helpers";

const TODAY = new Date(Date.now() - 4 * 3600_000).toLocaleDateString("en-CA", {
  timeZone: "Asia/Seoul",
});

test.beforeEach(async ({ context, baseURL }) => {
  await authenticate(context, baseURL!);
});

test.afterAll(resetDb);

test.describe("비밀번호 게이트", () => {
  test("쿠키 없이는 모든 화면이 막힌다", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    for (const path of ["/", "/study", "/words", "/add", "/stats", "/settings"]) {
      const res = await ctx.request.get(`${baseURL}${path}`, { maxRedirects: 0 });
      expect(res.status(), path).toBe(307);
      expect(res.headers()["location"], path).toContain("/login");
    }
    await ctx.close();
  });

  test("PWA 자산은 인증 없이 열린다", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    for (const path of ["/manifest.webmanifest", "/sw.js", "/icon-192.png"]) {
      const res = await ctx.request.get(`${baseURL}${path}`);
      expect(res.status(), path).toBe(200);
    }
    await ctx.close();
  });
});

test.describe("단어 추가", () => {
  test.beforeEach(resetDb);

  test("로마자를 치면 가나로 확정되고 저장된다", async ({ page }) => {
    await page.goto("/add");

    await page.getByLabel(/표기/).fill(`普及`);
    const reading = page.getByLabel(/읽기/);
    await reading.fill("fukyuu");
    await reading.blur();
    await expect(reading).toHaveValue("ふきゅう"); // 칸을 떠날 때 통째로 변환

    await page.getByLabel(/뜻/).fill("보급");
    await page.getByRole("button", { name: "저장" }).click();

    await expect(page.getByText("보급")).toBeVisible();
    const row = await wordRow("普及");
    expect(row.stage).toBe(0);
  });

  test("표기를 비우면 읽기도 비워진다", async ({ page }) => {
    await page.goto("/add");
    const surface = page.getByLabel(/표기/);
    const reading = page.getByLabel(/읽기/);

    await surface.fill("改善");
    await reading.fill("kaizen");
    await reading.blur();
    await expect(reading).toHaveValue("かいぜん");

    await surface.fill("");
    await expect(reading).toHaveValue("");
  });

  test("가나뿐인 단어는 읽기가 표기와 같게 잠긴다", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel(/표기/).fill("きっかけ");
    const reading = page.getByLabel(/읽기/);
    await expect(reading).toHaveValue("きっかけ");
    await expect(reading).toHaveAttribute("readonly", "");
  });

  test("읽기에 로마자가 남아 있으면 저장을 막는다", async ({ page }) => {
    await page.goto("/add");
    await page.getByLabel(/표기/).fill("試験");
    await page.getByLabel(/읽기/).fill("shikenq"); // 변환되지 않는 꼬리
    await page.getByLabel(/뜻/).fill("시험");
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText(/가나가 아닌 문자/)).toBeVisible();
  });
});

test.describe("학습 세션", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seed(
      [
        { surface: "環境", reading: "かんきょう", meaning: "환경" },
        { surface: "改善", reading: "かいぜん", meaning: "개선" },
      ],
      TODAY,
    );
  });

  test("키보드만으로 학습 카드와 퀴즈를 넘긴다", async ({ page }) => {
    await page.goto("/study");
    await expect(page.getByText("새 단어")).toBeVisible();

    // 학습 카드 2장은 Space 로 넘어간다
    await page.keyboard.press("Space");
    await page.keyboard.press("Space");

    // 이제 퀴즈. 공개 전에는 뜻이 화면에 렌더되지 않아야 한다(핵심 규칙).
    // page.content() 가 아니라 보이는 텍스트를 본다 — 큐는 시작 시 한 번에 받으므로
    // RSC 페이로드(script)에는 뜻이 들어 있고, 그건 설계상 의도된 것이다.
    await expect(page.getByRole("button", { name: /정답 보기/ })).toBeVisible();
    const shown = await page.locator("main").innerText();
    expect(shown).not.toContain("환경");
    expect(shown).not.toContain("개선");

    await page.keyboard.press("Space"); // 정답 공개
    await expect(page.getByRole("button", { name: /알았음/ })).toBeVisible();
    await page.keyboard.press("1"); // 알았음

    await page.keyboard.press("Space");
    await page.keyboard.press("1");

    await expect(page.getByText("오늘의 학습 완료")).toBeVisible();
    await page.waitForTimeout(1500); // 채점 배치 전송

    for (const s of ["環境", "改善"]) {
      const row = await wordRow(s);
      expect(row.stage, s).toBe(1); // 신규 -> 1단계
      expect(row.correct_count, s).toBe(1);
    }
  });

  test("몰랐음은 같은 세션에서 다시 나오고 다음 복습이 내일이 된다", async ({ page }) => {
    await page.goto("/study");
    await page.keyboard.press("Space");
    await page.keyboard.press("Space");

    const total = await page.locator("header").textContent();
    await page.keyboard.press("Space");
    await page.keyboard.press("2"); // 몰랐음
    const after = await page.locator("header").textContent();
    expect(after).not.toBe(total); // 큐가 늘었다(재출제)

    // 채점은 5장씩 모아 보낸다. 나가기 버튼이 떠나기 전에 확실히 보내는지도 함께 본다.
    await page.getByRole("button", { name: "나가기" }).click();
    await page.waitForURL("**/");
    await page.waitForTimeout(800);
    const tomorrow = new Date(Date.now() + 20 * 3600_000).toLocaleDateString("en-CA", {
      timeZone: "Asia/Seoul",
    });
    const rows = (await sql().query(
      `select to_char(next_review,'YYYY-MM-DD') as d, stage, wrong_count
         from words where note = $1 and wrong_count > 0`,
      [MARK],
    )) as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].stage).toBe(1);
    expect(rows[0].d).toBe(tomorrow);
  });
});

test.describe("연습 퀴즈", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seed([{ surface: "違反", reading: "いはん", meaning: "위반" }], TODAY);
    // 복습 주기를 미래로 밀어두고, 연습이 이걸 건드리지 않는지 본다
    await sql().query(
      `update words set stage = 4, next_review = current_date + 30 where note = $1`,
      [MARK],
    );
  });

  test("복습 주기는 그대로 두고 오답만 기록한다", async ({ page }) => {
    await page.goto(`/study?from=${TODAY}&to=${TODAY}&label=${encodeURIComponent("1일차")}`);
    await expect(page.getByText(/연습 · 주기 영향 없음/)).toBeVisible();

    await page.keyboard.press("Space");
    await page.keyboard.press("2"); // 몰랐음
    await page.getByRole("button", { name: "나가기" }).click();
    await page.waitForURL("**/");
    await page.waitForTimeout(800);

    const row = await wordRow("違反");
    expect(row.stage).toBe(4); // 단계 유지
    expect(row.wrong_count).toBe(1); // 오답노트에는 반영
  });
});

test.describe("단어 목록", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seed([{ surface: "協力", reading: "きょうりょく", meaning: "협력" }], TODAY);
  });

  test("모달로 수정하고 행에서 삭제한다", async ({ page }) => {
    await page.goto("/words");
    await page.getByRole("button", { name: "協力" }).click();

    await expect(page.getByRole("heading", { name: "단어 수정" })).toBeVisible();
    const meaning = page.locator('input[lang="ko"]');
    await meaning.fill("협력·협조");
    await page.getByRole("button", { name: "저장", exact: true }).click();

    await expect(page.getByRole("heading", { name: "단어 수정" })).toBeHidden();
    await expect(page.getByText("협력·협조")).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "삭제" }).first().click();
    await expect(page.getByText("협력·협조")).toBeHidden();
  });
});

test.describe("채점 전송", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seed([{ surface: "環境", reading: "かんきょう", meaning: "환경" }], TODAY);
  });

  async function reviewCount() {
    const r = (await sql().query(`select count(*)::int n from reviews`)) as { n: number }[];
    return r[0].n;
  }

  test("손을 멈추면 배치가 차지 않아도 곧 전송된다", async ({ page }) => {
    await page.goto("/study");
    await page.keyboard.press("Space");
    await page.keyboard.press("Space");
    await page.keyboard.press("2");
    expect(await reviewCount()).toBe(0); // 아직 모아둔 상태
    await page.waitForTimeout(7000);
    expect(await reviewCount()).toBe(2); // 유휴 전송
  });

  test("나가기 버튼은 떠나기 전에 확실히 보낸다", async ({ page }) => {
    await page.goto("/study");
    await page.keyboard.press("Space");
    await page.keyboard.press("Space");
    await page.keyboard.press("2");
    await page.getByRole("button", { name: "나가기" }).click();
    await page.waitForURL("**/");
    await page.waitForTimeout(800);
    expect(await reviewCount()).toBe(2);
  });
});
