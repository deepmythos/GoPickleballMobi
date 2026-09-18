import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Hợp đồng CSS của thanh trên: KHÔNG được có lớp kính nào trên đường đi của thanh.
 *
 * Vì sao có test này (lần 2 — lần 1 đã sai): trên iPhone, tên sân và giờ đang tính bị
 * nhạt đi trong khi toạ độ, độ lệch UTC và điểm số vẫn nét. Bản sửa lần 1 tách kính ra
 * `.infobar::before` (z-index 0) rồi nâng chữ lên `z-index: 1`; trên máy thật WebKit vẫn
 * ghép lớp `backdrop-filter` LÊN TRÊN chữ, và lớp kính còn lộ ra thành một mảng xám
 * riêng. Kết luận: trên WebKit không thể trông cậy vào thứ tự lớp giữa một lớp
 * `backdrop-filter` và chữ của phần tử cha — cách sửa phải là BỎ hẳn kính.
 *
 * Test khoá lại hợp đồng đó ở hai nơi:
 *   1. `src/styles.css` (nguồn), và
 *   2. CSS ĐÃ BUILD (`dist/assets/*.css`) — vì minifier chỉ giữ lại khai báo có tiền tố
 *      `-webkit-`, nên soi mỗi nguồn là chưa đủ.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(root, "src", "styles.css"), "utf8");

/** Bỏ comment và các khối `@keyframes` (ngoặc lồng nhau) để regex rule không bắt nhầm. */
function stripCommentsAndKeyframes(css) {
  let out = "";
  let from = 0;
  for (;;) {
    const start = css.indexOf("@keyframes", from);
    if (start === -1) {
      out += css.slice(from);
      break;
    }
    out += css.slice(from, start);
    const open = css.indexOf("{", start);
    if (open === -1) {
      out += css.slice(start);
      break;
    }
    let depth = 0;
    let end = open;
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      else if (css[end] === "}") {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }
    from = end;
  }
  return out.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Mọi khối rule `<selectors> { <decls> }` dưới dạng {selector, body}. */
function rules(css) {
  const clean = stripCommentsAndKeyframes(css);
  const found = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    found.push({ selector: m[1].trim().replace(/\s+/g, " "), body: m[2] });
  }
  return found;
}

function decl(body, property) {
  const m = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
}

function zIndexOf(body) {
  const value = decl(body, "z-index");
  return value === null ? null : Number(value);
}

/** Rule nào cũng có thể áp lên một phần tử trong thanh trên (kể cả pseudo-element). */
function barRules(css) {
  return rules(css).filter((r) => /\.infobar\b/.test(r.selector));
}

function bodyOf(css, selector) {
  const hit = rules(css).find((r) => r.selector === selector);
  return hit ? hit.body : null;
}

/** true khi giá trị nền ĐÃ GIẢI là ĐỤC: không trong suốt, không alpha < 1, không color-mix với transparent. */
function isOpaqueConcrete(value) {
  if (value === null) return false;
  const v = value.trim().toLowerCase();
  if (v === "" || v === "none" || v === "transparent") return false;
  if (v.includes("transparent")) return false;
  const rgba = v.match(/^rgba\(([^)]*)\)$/);
  if (rgba) {
    const parts = rgba[1].split(/[,/]/).map((p) => p.trim());
    if (parts.length >= 4 && Number(parts[3]) < 1) return false;
  }
  const slashAlpha = v.match(/\/\s*([0-9.]+%?)\s*\)/);
  if (slashAlpha) {
    const raw = slashAlpha[1];
    const alpha = raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
    if (Number.isFinite(alpha) && alpha < 1) return false;
  }
  return true;
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mọi giá trị được khai cho custom property `--name` trong CHÍNH CSS đang kiểm.
 * Có thể có nhiều định nghĩa (`:root` sáng + override tối) — phép kiểm phải xét HẾT.
 */
function customPropertyValues(css, name) {
  const values = [];
  const re = new RegExp(`(?:^|;)\\s*${escapeRe(name)}\\s*:\\s*([^;]+)`, "g");
  for (const rule of rules(css)) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(rule.body)) !== null) {
      values.push(m[1].trim().replace(/\s*!important$/i, "").trim());
    }
  }
  return values;
}

/**
 * Giải mọi `var(--name)` / `var(--name, fallback)` bằng chính CSS đang kiểm.
 * Trả về danh sách các biến thể đã hết `var(...)`, hoặc `null` nếu còn token chưa giải.
 */
function expandVars(value, css, depth = 0) {
  if (depth > 20) return null;
  const m = value.match(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/);
  if (!m) return [value];
  const replacements = customPropertyValues(css, m[1]);
  const fallback = m[2] !== undefined ? m[2].trim() : null;
  const choices = replacements.length > 0 ? replacements : fallback === null ? null : [fallback];
  if (choices === null) return null;
  const out = [];
  for (const choice of choices) {
    const next = value.slice(0, m.index) + choice + value.slice(m.index + m[0].length);
    const expanded = expandVars(next, css, depth + 1);
    if (expanded === null) return null;
    out.push(...expanded);
  }
  return out;
}

/**
 * true khi nền là ĐỤC. Custom property phải giải được từ chính CSS đang kiểm; MỌI giá trị
 * giải được (mọi định nghĩa của token) đều phải đục. Token không giải được ⇒ false để test
 * fail — nếu không, lỗi cũ `var(...)` luôn được coi là đục chỉ đổi chỗ.
 */
function isOpaqueBackground(value, css) {
  if (value === null) return false;
  const variants = expandVars(value.trim(), css);
  if (variants === null || variants.length === 0) return false;
  return variants.every((variant) => isOpaqueConcrete(variant));
}

/** Vì sao nền bị coi là KHÔNG đục — nêu tên token chưa giải được nếu có. */
function opacityReason(value, css) {
  if (value === null) return "thiếu giá trị nền";
  const variants = expandVars(value.trim(), css);
  if (variants === null) {
    const token = (value.match(/var\(\s*(--[A-Za-z0-9_-]+)/) || [])[1] ?? value;
    return `không giải được custom property ${token} từ CSS đang kiểm`;
  }
  const bad = variants.find((variant) => !isOpaqueConcrete(variant));
  if (bad !== undefined) return `giá trị đã giải không đục: ${bad}`;
  return `đã giải đục: ${variants.join(" | ")}`;
}

const GLASS = ["backdrop-filter", "-webkit-backdrop-filter"];
const LAYER_TRICKS = ["isolation", "transform", "will-change", "filter", ...GLASS];

function distCssFiles() {
  const dir = resolve(root, "dist", "assets");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".css"))
    .map((name) => resolve(dir, name));
}

/**
 * CSS đã build để soi hợp đồng, kèm NỘI DUNG đã đọc (không đọc lại file sau đó vì
 * `pwa.test.mjs` cũng build vào `dist/` và có thể đang xoá/ghi lại song song).
 *
 * Cổng `npm test` chạy TRƯỚC `npm run build`, nên trên cây sạch không có `dist/`: tự chạy
 * `vite build` của chính dự án (gọi trực tiếp vite đã cài, KHÔNG qua npx). Không lấy được
 * CSS ⇒ ném lỗi để hợp đồng FAIL rõ ràng, tuyệt đối không được lặng lẽ bỏ qua.
 */
let distCssCache = null;
function loadDistCss() {
  if (distCssCache !== null) return distCssCache;
  let buildError = null;
  if (distCssFiles().length === 0) {
    const viteBin = resolve(root, "node_modules", "vite", "bin", "vite.js");
    if (!existsSync(viteBin)) {
      throw new Error(`hợp đồng CSS trên bản build không thể được đánh giá: thiếu ${viteBin}`);
    }
    try {
      execFileSync(process.execPath, [viteBin, "build"], { cwd: root, stdio: "pipe" });
    } catch (err) {
      buildError = err && err.stderr ? String(err.stderr) : String((err && err.message) || err);
    }
  }
  if (buildError !== null) {
    throw new Error(`hợp đồng CSS trên bản build không thể được đánh giá: vite build lỗi\n${buildError}`);
  }
  // Build song song của `pwa.test.mjs` có thể xoá `dist/` ngay sau khi build của ta xong:
  // chờ ngắn cho tới khi đọc được CSS rồi mới kết luận là không lấy được.
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const files = distCssFiles();
      if (files.length > 0) {
        distCssCache = files.map((file) => ({ name: file, css: readFileSync(file, "utf8") }));
        return distCssCache;
      }
    } catch {
      // build khác đang xoá/ghi lại dist/ — thử lại.
    }
    if (Date.now() > deadline) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
  }
  throw new Error(
    "hợp đồng CSS trên bản build không thể được đánh giá: không đọc được dist/assets/*.css",
  );
}

describe("khối thông tin — không còn lớp kính nào có thể nằm trên chữ", () => {
  it("1. KHÔNG rule nào của thanh khai backdrop-filter (nguồn)", () => {
    const found = [];
    for (const rule of barRules(source)) {
      for (const prop of GLASS) {
        const value = decl(rule.body, prop);
        if (value !== null) found.push(`${rule.selector} { ${prop}: ${value} }`);
      }
    }
    expect(found, "thanh trên còn lớp kính — WebKit sẽ vẽ nó lên trên chữ").toEqual([]);
  });

  it("2. không còn lớp kính giả (.infobar::before/::after) và không còn mẹo xếp lớp", () => {
    const pseudo = rules(source)
      .filter((r) => /^\.infobar::(before|after)$/.test(r.selector))
      .map((r) => r.selector);
    expect(pseudo, "lớp kính phải bị XOÁ, không phải chuyển sang pseudo-element").toEqual([]);

    const content = bodyOf(source, ".infobar > *");
    expect(content, "không được nâng nội dung thanh bằng z-index để né lớp kính").toBeNull();

    const tricks = [];
    for (const rule of barRules(source)) {
      for (const prop of LAYER_TRICKS) {
        const value = decl(rule.body, prop);
        if (value !== null && value !== "none") tricks.push(`${rule.selector} { ${prop}: ${value} }`);
      }
      // z-index của CHÍNH thanh là hợp lệ (thanh phải nằm trên .sheet-backdrop, z-index 50).
      // Điều bị cấm là xếp lớp cho NỘI DUNG trong thanh để né một lớp kính.
      if (rule.selector !== ".infobar") {
        const z = zIndexOf(rule.body);
        if (z !== null && z > 1) tricks.push(`${rule.selector} { z-index: ${z} }`);
      }
    }
    expect(tricks, "không thêm mẹo xếp lớp nào khác trên đường đi của thanh").toEqual([]);
  });

  it("3. nền của chính thanh là ĐỤC (màu surface của chủ đề)", () => {
    const bar = bodyOf(source, ".infobar");
    expect(bar, "thiếu rule .infobar").not.toBeNull();
    const background = decl(bar, "background") ?? decl(bar, "background-color");
    expect(
      isOpaqueBackground(background, source),
      `nền thanh phải đục — đang là: ${background} (${opacityReason(background, source)})`,
    ).toBe(true);
    expect(background).toMatch(/var\(--surface\)/);
  });

  it("4. không rule nào của thanh làm nhạt chữ (opacity < 1, filter, mix-blend-mode)", () => {
    const bad = [];
    for (const rule of barRules(source)) {
      const opacity = decl(rule.body, "opacity");
      if (opacity !== null && Number(opacity) < 1) bad.push(`${rule.selector} → opacity: ${opacity}`);
      const filter = decl(rule.body, "filter");
      if (filter !== null && filter !== "none") bad.push(`${rule.selector} → filter: ${filter}`);
      const blend = decl(rule.body, "mix-blend-mode");
      if (blend !== null && blend !== "normal") bad.push(`${rule.selector} → mix-blend-mode: ${blend}`);
    }
    expect(bad).toEqual([]);
  });

  it("5. hai dòng chữ (tên sân, giờ đang tính) không cần z-index/opacity để nổi lên", () => {
    const bad = [];
    for (const selector of [".infobar-loc-name", ".infobar-time-value"]) {
      const body = bodyOf(source, selector);
      if (body === null) continue;
      for (const prop of ["z-index", "opacity", "position"]) {
        const value = decl(body, prop);
        if (value !== null) bad.push(`${selector} { ${prop}: ${value} }`);
      }
    }
    expect(bad, "nền đã đục — chữ không được phụ thuộc vào thứ tự lớp nữa").toEqual([]);
  });

  it("6. nút X của sheet vẫn ≥ 44×44 và có touch-action cho cú chạm tức thì", () => {
    for (const selector of [".sheet-close", ".banner-dismiss"]) {
      const body = bodyOf(source, selector);
      expect(body, `thiếu rule ${selector}`).not.toBeNull();
      const px = (value) => Number.parseFloat(String(value).replace("px", ""));
      expect(px(decl(body, "width")), `${selector} phải rộng ≥ 44px`).toBeGreaterThanOrEqual(44);
      const height = decl(body, "height");
      const h = height !== null ? px(height) : px(decl(body, "min-height"));
      expect(h, `${selector} phải cao ≥ 44px`).toBeGreaterThanOrEqual(44);
    }
    expect(decl(bodyOf(source, ".sheet-close"), "touch-action")).toBe("manipulation");

    // Dòng tóm tắt của khối Địa điểm (trước đây là nút .infobar-loc) dùng mẫu gấp chung
    // .collapse-summary: vẫn phải ≥ 44×44 và rộng hết dòng.
    const loc = bodyOf(source, ".collapse-summary");
    expect(loc, "thiếu rule .collapse-summary").not.toBeNull();
    const pxOf = (value) => Number.parseFloat(String(value).replace("px", ""));
    expect(pxOf(decl(loc, "min-height")), ".collapse-summary phải cao ≥ 44px").toBeGreaterThanOrEqual(44);
    expect(decl(loc, "width"), ".collapse-summary phải rộng hết dòng").toBe("100%");
    // Override riêng cho khối địa điểm vẫn phải tồn tại (giữ nhịp lề trong thẻ .infobar).
    expect(bodyOf(source, ".infobar-summary"), "thiếu rule .infobar-summary").not.toBeNull();
    // Vẫn không có mẹo xếp lớp / làm nhạt chữ nào trên dòng tóm tắt.
    for (const prop of ["z-index", "opacity", "position"]) {
      expect(decl(loc, prop), `.collapse-summary không được có ${prop}`).toBeNull();
    }
  });
});

describe("khối thông tin — CSS ĐÃ BUILD cũng phải sạch kính", () => {
  it("7. không `backdrop-filter` nào trên đường đi của thanh trong dist/assets/*.css", () => {
    const files = loadDistCss();
    const offenders = [];
    for (const { name, css } of files) {
      for (const rule of barRules(css)) {
        for (const prop of GLASS) {
          const value = decl(rule.body, prop);
          if (value !== null) offenders.push(`${name.split("/").pop()} → ${rule.selector} { ${prop}: ${value} }`);
        }
      }
    }
    expect(offenders, "bản build vẫn còn kính trên thanh (minifier giữ lại bản -webkit-)").toEqual([]);
  });

  it("8. trong bản build, `.infobar` có nền đục và không có pseudo-element kính", () => {
    const files = loadDistCss();
    for (const { name, css } of files) {
      const bar = bodyOf(css, ".infobar");
      if (bar === null) continue;
      const background = decl(bar, "background") ?? decl(bar, "background-color");
      expect(
        isOpaqueBackground(background, css),
        `${name} — nền .infobar phải đục — đang là: ${background} (${opacityReason(background, css)})`,
      ).toBe(true);
      expect(
        rules(css).some((r) => /^\.infobar::(before|after)$/.test(r.selector)),
        `${name} còn .infobar::before/::after`,
      ).toBe(false);
    }
  });
});
