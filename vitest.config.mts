import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["{lib,app}/**/*.test.ts", "{lib,app}/**/*.test.tsx"],
    environment: "node",
  },
});
