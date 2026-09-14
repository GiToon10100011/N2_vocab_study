import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

// .env.local 을 테스트 프로세스에도 싣는다(쿠키 서명과 DB 정리에 필요).
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
  if (m && !line.trim().startsWith("#")) process.env[m[1]] = m[2];
}

const PORT = 3210;

/**
 * E2E 는 같은 Neon 프로젝트 안의 별도 데이터베이스(n2v_e2e)에서 돌린다.
 * 세션 테스트는 키를 눌러 카드를 채점하므로, 실제 DB 에서 돌리면
 * 큐에 섞여 들어온 진짜 단어의 복습 주기를 바꿔버린다.
 */
const TEST_DATABASE_URL = process.env.DATABASE_URL!.replace(/\/neondb(\?|$)/, "/n2v_e2e$1");
if (!TEST_DATABASE_URL.includes("/n2v_e2e")) {
  throw new Error("격리 데이터베이스(n2v_e2e)로 바꾸지 못했습니다. 중단합니다.");
}
process.env.DATABASE_URL = TEST_DATABASE_URL;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false, // 같은 DB 를 쓰므로 순차 실행
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next build && npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: { DATABASE_URL: TEST_DATABASE_URL },
  },
});
