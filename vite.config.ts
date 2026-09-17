/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base so the built app works from any static file path.
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
