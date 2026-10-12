import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    globalSetup: ["tests/db/global-setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // One shared ephemeral Postgres container backs the whole suite; running
    // files sequentially avoids connection/transaction contention across them.
    fileParallelism: false,
  },
});
