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
    include: ["tests/api/**/*.test.ts"],
    env: {
      // Fixed, obviously fake test-only key (32 bytes of 0x01) so
      // lib/crypto/token-encryption.ts works in tests.
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    },
  },
});
