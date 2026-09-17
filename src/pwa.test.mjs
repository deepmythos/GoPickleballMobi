import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngInfo(file) {
  const buf = readFileSync(file);
  return {
    sigOk: buf.subarray(0, 8).equals(PNG_SIGNATURE),
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf.readUInt8(25),
    hasAlpha: buf.readUInt8(25) === 4 || buf.readUInt8(25) === 6,
  };
}

function readText(...segments) {
  return readFileSync(resolve(root, ...segments), "utf8");
}

function hasMeta(html, name, extra) {
  const pattern = `<meta(?=[^>]*name="${name}")${extra ? `(?=[^>]*${extra})` : ""}[^>]*>`;
  return new RegExp(pattern).test(html);
}

function hasThemeColor(html, scheme) {
  return new RegExp(
    `<meta(?=[^>]*name="theme-color")(?=[^>]*prefers-color-scheme:\\s*${scheme})[^>]*>`,
  ).test(html);
}

function assertIosHead(html) {
  expect(/rel="manifest"/.test(html)).toBe(true);
  expect(/manifest\.webmanifest/.test(html)).toBe(true);
  expect(/rel="apple-touch-icon"/.test(html)).toBe(true);
  expect(/apple-touch-icon\.png/.test(html)).toBe(true);
  expect(hasMeta(html, "apple-mobile-web-app-capable")).toBe(true);
  expect(hasMeta(html, "apple-mobile-web-app-status-bar-style", "black-translucent")).toBe(true);
  expect(hasMeta(html, "apple-mobile-web-app-title")).toBe(true);
  expect(hasMeta(html, "viewport", "viewport-fit=cover")).toBe(true);
  expect(hasThemeColor(html, "light")).toBe(true);
  expect(hasThemeColor(html, "dark")).toBe(true);
}

// File KHÔNG được theo dõi và KHÔNG nằm trong .gitignore — mô phỏng rác của container build
// (`.vercel/`, cache) đã làm marker thành "<sha>-dirty" trên bản deploy sạch.
const UNTRACKED_MARKER = ".build-id-untracked-pin";

let build = null;
let trackedDirtyAtBuild = false;

function trackedChangesAt(dir) {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: dir,
    encoding: "utf8",
  }).trim();
}

beforeAll(() => {
  const marker = resolve(root, UNTRACKED_MARKER);
  writeFileSync(marker, "pin: file khong duoc theo doi (mo phong .vercel/ trong container build)\n");
  try {
    // Tự kiểm chứng cái pin: file phải HIỆN ra ở `git status --porcelain`, tức là không bị .gitignore.
    // Nếu nó bị bỏ qua thì pin này vô nghĩa (bug cũ không kích hoạt) → báo lỗi ngay.
    if (!execFileSync("git", ["status", "--porcelain", "--", UNTRACKED_MARKER], { cwd: root, encoding: "utf8" }).trim()) {
      throw new Error(`${UNTRACKED_MARKER} phải là file không được theo dõi và không bị .gitignore.`);
    }
    execFileSync(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "build"], {
      cwd: root,
      stdio: "pipe",
    });
    trackedDirtyAtBuild = trackedChangesAt(root).length > 0;
  } finally {
    rmSync(marker, { force: true });
  }
  build = JSON.parse(readText("dist", "build.json"));
}, 120000);

describe("PWA artifacts", () => {
  it("1. manifest nguồn tồn tại và đủ khoá/giá trị bắt buộc", () => {
    const manifestPath = resolve(root, "public/manifest.webmanifest");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const key of [
      "name",
      "short_name",
      "start_url",
      "scope",
      "display",
      "orientation",
      "background_color",
      "theme_color",
      "lang",
      "description",
    ]) {
      expect(typeof manifest[key]).toBe("string");
      expect(manifest[key].length).toBeGreaterThan(0);
    }
    expect(manifest.display).toBe("standalone");
    expect(manifest.orientation).toBe("portrait");
    expect(manifest.lang).toBe("vi");
  });

  it("2. manifest nguồn khai đủ 3 icon", () => {
    const manifest = JSON.parse(readText("public", "manifest.webmanifest"));
    const icons = manifest.icons ?? [];
    const findIcon = (sizes, purpose) =>
      icons.find((icon) => icon.sizes === sizes && icon.purpose === purpose && icon.type === "image/png");
    expect(findIcon("192x192", "any")).toBeTruthy();
    expect(findIcon("512x512", "any")).toBeTruthy();
    expect(findIcon("512x512", "maskable")).toBeTruthy();
  });

  it("3. icon PNG nguồn đúng kích thước pixel", () => {
    const checks = [
      [["public", "icons", "icon-192.png"], 192, 192],
      [["public", "icons", "icon-512.png"], 512, 512],
      [["public", "icons", "icon-maskable-512.png"], 512, 512],
      [["public", "apple-touch-icon.png"], 180, 180],
    ];
    for (const [segments, width, height] of checks) {
      const info = pngInfo(resolve(root, ...segments));
      expect(info.sigOk).toBe(true);
      expect(info.width).toBe(width);
      expect(info.height).toBe(height);
    }
  });

  it("4. apple-touch-icon.png (nguồn) là PNG không alpha", () => {
    const info = pngInfo(resolve(root, "public", "apple-touch-icon.png"));
    expect(info.colorType).toBe(2);
    expect(info.hasAlpha).toBe(false);
  });

  it("5. index.html có đủ thẻ meta iOS/PWA", () => {
    assertIosHead(readText("index.html"));
  });

  it("6. dist/index.html sau build giữ đủ các thẻ ở test 5", () => {
    const distHtml = resolve(root, "dist", "index.html");
    expect(existsSync(distHtml)).toBe(true);
    assertIosHead(readText("dist", "index.html"));
  });

  it("7. dist/manifest.webmanifest hợp lệ và standalone", () => {
    const manifest = JSON.parse(readText("dist", "manifest.webmanifest"));
    expect(manifest.display).toBe("standalone");
    expect(typeof manifest.start_url).toBe("string");
    expect(manifest.start_url.length).toBeGreaterThan(0);
  });

  it("8. dist có đủ 4 icon PNG đúng kích thước", () => {
    const checks = [
      [["dist", "icons", "icon-192.png"], 192, 192],
      [["dist", "icons", "icon-512.png"], 512, 512],
      [["dist", "icons", "icon-maskable-512.png"], 512, 512],
      [["dist", "apple-touch-icon.png"], 180, 180],
    ];
    for (const [segments, width, height] of checks) {
      const info = pngInfo(resolve(root, ...segments));
      expect(info.width).toBe(width);
      expect(info.height).toBe(height);
    }
  });

  it("9. dist/sw.js tồn tại và tên cache chứa build id", () => {
    const sw = readText("dist", "sw.js");
    expect(sw).toContain(`pickleball-go-nogo-shell-${build.id}`);
  });

  it("10. dist/sw.js tiền cache app shell", () => {
    const sw = readText("dist", "sw.js");
    for (const entry of [
      '"./index.html"',
      '"./manifest.webmanifest"',
      '"./apple-touch-icon.png"',
      '"./icons/icon-192.png"',
    ]) {
      expect(sw).toContain(entry);
    }
    expect(/"\.\/assets\//.test(sw)).toBe(true);
  });

  it("11. dist/sw.js có skipWaiting, clients.claim và 3 host API", () => {
    const sw = readText("dist", "sw.js");
    expect(sw).toContain("self.skipWaiting()");
    expect(sw).toContain("clients.claim()");
    expect(sw).toContain("api.open-meteo.com");
    expect(sw).toContain("air-quality-api.open-meteo.com");
    expect(sw).toContain("geocoding-api.open-meteo.com");
  });

  it("12. dist/build.json khớp git HEAD — file KHÔNG theo dõi không được làm bẩn marker", () => {
    const expected = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    // Lúc build trong beforeAll LUÔN tồn tại một file không được theo dõi (UNTRACKED_MARKER) — đúng
    // hình dạng container build của Vercel. Hậu tố `-dirty` chỉ được phép xuất hiện khi có thay đổi
    // chưa commit trên file ĐÃ THEO DÕI; bản cũ (tính cả file không theo dõi) làm khẳng định này ĐỎ.
    expect(build.id).toBe(trackedDirtyAtBuild ? `${expected}-dirty` : expected);
    expect(Number.isNaN(Date.parse(build.time))).toBe(false);
  });

  it("12b. computeBuildId(): file không theo dõi KHÔNG làm bẩn, file đã theo dõi bị sửa thì CÓ", async () => {
    const { computeBuildId } = await import("../vite.config.ts");
    const dir = mkdtempSync(join(tmpdir(), "gpm-buildid-"));
    const git = (...args) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: "pipe" }).trim();
    try {
      git("init", "-q", "-b", "main");
      writeFileSync(join(dir, "tracked.txt"), "a\n");
      git("add", "tracked.txt");
      git("-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-qm", "init");
      const head = git("rev-parse", "--short=12", "HEAD");
      expect(computeBuildId(dir)).toBe(head);
      // Rác của container build: KHÔNG được sinh hậu tố -dirty (đây là chính cái bug đã lên production).
      writeFileSync(join(dir, "untracked.ci"), "x\n");
      expect(git("status", "--porcelain").length).toBeGreaterThan(0);
      expect(computeBuildId(dir)).toBe(head);
      // Đối chứng: sửa một file ĐÃ theo dõi thì vẫn phải là -dirty.
      writeFileSync(join(dir, "tracked.txt"), "b\n");
      expect(computeBuildId(dir)).toBe(`${head}-dirty`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("13. bundle JS đã build chứa build id", () => {
    const assetsDir = resolve(root, "dist", "assets");
    const jsFiles = readdirSync(assetsDir).filter((file) => file.endsWith(".js"));
    expect(jsFiles.length).toBeGreaterThan(0);
    const bundle = jsFiles.map((file) => readFileSync(resolve(assetsDir, file), "utf8")).join("\n");
    expect(bundle).toContain(build.id);
  });

  it("14. src/styles.css có nền tảng full-screen và safe-area", () => {
    const css = readText("src", "styles.css");
    for (const token of [
      "env(safe-area-inset-top)",
      "env(safe-area-inset-bottom)",
      "overscroll-behavior",
      "-webkit-tap-highlight-color",
      "-webkit-text-size-adjust",
      "dvh",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("15. src/styles.css có khối quy tắc nền vùng chạm 44x44", () => {
    const css = readText("src", "styles.css");
    const pattern = /\* baseline: interactive targets[\s\S]{0,200}min-height:\s*44px[\s\S]{0,120}min-width:\s*44px/;
    expect(pattern.test(css)).toBe(true);
  });

  it("16. src/pwa.ts không chứa setTimeout/setInterval", () => {
    const source = readText("src", "pwa.ts");
    expect(/setTimeout|setInterval/.test(source)).toBe(false);
  });

  it("17. từ điển vi/de/en đủ 6 khoá mới", () => {
    const keys = [
      "build.title",
      "build.builtAt",
      "build.updateAvailable",
      "build.updateReload",
      "build.updateDismiss",
      "status.offline",
    ];
    for (const lang of ["vi", "de", "en"]) {
      const source = readText("src", "i18n", `${lang}.ts`);
      for (const key of keys) {
        expect(source).toContain(`"${key}":`);
      }
    }
  });

  // Khẳng định này phải bám vào CODE, không phải vào chú thích: bản cũ chỉ
  // `expect(sw).toContain("ignoreVary")` nên VẪN PASS khi tuỳ chọn thật bị xoá,
  // vì các dòng comment trong sw.js vẫn còn chữ "ignoreVary". Bỏ comment trước khi khớp.
  function stripLineComments(text) {
    return text
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
  }

  it("18. dist/sw.js bỏ qua Vary khi tra cache (MỌI caches.match đều có ignoreVary)", () => {
    const code = stripLineComments(readText("dist", "sw.js"));
    const calls = code.match(/caches\.match\(/g) ?? [];
    const withOption = code.match(/caches\.match\([^;)]*ignoreVary:\s*true/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    // Không chỉ "có ít nhất một": MỌI điểm tra cache phải bỏ qua Vary, kể cả fallback ./index.html.
    expect(withOption.length).toBe(calls.length);
    // So số lượng thôi thì việc XOÁ hẳn điểm tra cache cũng làm hai vế bằng nhau (test vẫn PASS),
    // nên phải khẳng định riêng rằng fallback ./index.html TỒN TẠI và có ignoreVary.
    expect(/caches\.match\([^;)]*index\.html[^;)]*ignoreVary:\s*true/.test(code)).toBe(true);
  });

  it("19. dist/sw.js bỏ header Vary trước khi ghi cache", () => {
    const sw = readText("dist", "sw.js");
    expect(/headers\.delete\(\s*["']vary["']\s*\)/i.test(sw)).toBe(true);
  });

  it("20. src/styles.css: MỌI vùng chạm tương tác khai báo ≥ 44px", () => {
    const css = readText("src", "styles.css");
    const blocks = css.match(/[^{}]+\{[^{}]*\}/g) ?? [];
    // Chỉ soi selector TƯƠNG TÁC. Bỏ qua chi tiết trang trí nằm TRONG nút (vd .switch chỉ là
    // rãnh gạt của .toggle-row, không phải vùng chạm) — nếu tính cả nó sẽ báo dương tính giả.
    const interactive = /(^|[,{\s])(button|summary)\b|\.(btn|segment|icon-button|chip-button|loc-button|toggle-row)\b/;
    const tooSmall = [];
    for (const block of blocks) {
      const open = block.indexOf("{");
      const selector = block.slice(0, open).trim();
      const body = block.slice(open + 1, -1);
      if (!interactive.test(selector)) continue;
      for (const m of body.matchAll(/(min-height|height)\s*:\s*([0-9.]+)px/g)) {
        if (Number(m[2]) < 44) tooSmall.push(`${selector} → ${m[1]}: ${m[2]}px`);
      }
    }
    expect(tooSmall).toEqual([]);
  });
});
