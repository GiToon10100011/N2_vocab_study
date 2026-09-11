import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** 실제 Neon DB 에 붙는 통합 테스트. npm run test:db 로만 돈다. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["lib/**/*.itest.ts"],
    environment: "node",
    setupFiles: ["./scripts/load-env.mts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
