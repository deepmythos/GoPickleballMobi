/// <reference types="vitest" />
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

// App shell tối thiểu luôn được service worker tiền cache.
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

// Hậu tố `-dirty` chỉ có nghĩa "có thay đổi CHƯA commit trên file ĐÃ THEO DÕI" — đúng như
// điều nó tự khai. File KHÔNG được theo dõi (`.vercel/`, cache, rác của container build) không
// đi vào bundle nên không được tính là bẩn: bản cũ hỏi `git status --porcelain` (tính cả chúng)
// nên bản deploy sạch vẫn tự nhận là "<sha>-dirty".
// `cwd` có tham số để test khẳng định được luật này trên một repo git tạm.
export function computeBuildId(cwd: string = rootDir): string {
  try {
    const id = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd,
      encoding: "utf8",
    }).trim();
    if (!id) return "dev";
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      cwd,
      encoding: "utf8",
    }).trim();
    return dirty ? `${id}-dirty` : id;
  } catch {
    return "dev";
  }
}

// Plugin nội bộ: build marker + sinh build.json và sw.js từ template.
function buildInfoPlugin(): Plugin {
  const buildId = computeBuildId();
  const buildTime = new Date().toISOString();

  return {
    name: "pickleball-build-info",
    config() {
      return {
        define: {
          __BUILD_ID__: JSON.stringify(buildId),
          __BUILD_TIME__: JSON.stringify(buildTime),
        },
      };
    },
    generateBundle(_options, bundle) {
      this.emitFile({
        type: "asset",
        fileName: "build.json",
        source: JSON.stringify({ id: buildId, time: buildTime }),
      });

      const emitted = Object.keys(bundle).map((file) => `./${file}`);
      const precache = [...new Set([...SHELL_ASSETS, ...emitted])];
      const template = readFileSync(resolve(rootDir, "scripts", "sw.template.js"), "utf8");
      const sw = template
        .replaceAll("__CACHE_VERSION__", buildId)
        .replaceAll("__PRECACHE__", JSON.stringify(precache));

      this.emitFile({ type: "asset", fileName: "sw.js", source: sw });
    },
  };
}

export default defineConfig({
  // Relative base so the built app works from any static file path.
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: false,
  },
  plugins: [buildInfoPlugin()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.mjs"],
    testTimeout: 120000,
  },
});
