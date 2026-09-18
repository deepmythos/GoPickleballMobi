import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Hợp đồng CSS của thanh trên: KHÔNG được có lớp kính nào trên đường đi của thanh.
 *
 * Vì sao có test này (lần 2 — lần 1 đã sai): trên iPhone, tên sân và giờ đang tính bị
 * nhạt đi trong khi toạ độ, độ lệch UTC và điểm số vẫn nét. Bản sửa lần 1 tách kính ra
 * `.appbar::before` (z-index 0) rồi nâng chữ lên `z-index: 1`; trên máy thật WebKit vẫn
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
  return rules(css).filter((r) => /\.appbar\b/.test(r.selector));
}

function bodyOf(css, selector) {
  const hit = rules(css).find((r) => r.selector === selector);
  return hit ? hit.body : null;
}

/** true khi giá trị nền là ĐỤC: không trong suốt, không alpha < 1, không color-mix với transparent. */
function isOpaqueBackground(value) {
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

const GLASS = ["backdrop-filter", "-webkit-backdrop-filter"];
const LAYER_TRICKS = ["isolation", "transform", "will-change", "filter", ...GLASS];

function distCssFiles() {
  const dir = resolve(root, "dist", "assets");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".css"))
    .map((name) => resolve(dir, name));
}

describe("thanh trên — không còn lớp kính nào có thể nằm trên chữ", () => {
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

  it("2. không còn lớp kính giả (.appbar::before/::after) và không còn mẹo xếp lớp", () => {
    const pseudo = rules(source)
      .filter((r) => /^\.appbar::(before|after)$/.test(r.selector))
      .map((r) => r.selector);
    expect(pseudo, "lớp kính phải bị XOÁ, không phải chuyển sang pseudo-element").toEqual([]);

    const content = bodyOf(source, ".appbar > *");
    expect(content, "không được nâng nội dung thanh bằng z-index để né lớp kính").toBeNull();

    const tricks = [];
    for (const rule of barRules(source)) {
      for (const prop of LAYER_TRICKS) {
        const value = decl(rule.body, prop);
        if (value !== null && value !== "none") tricks.push(`${rule.selector} { ${prop}: ${value} }`);
      }
      // z-index của CHÍNH thanh là hợp lệ (thanh phải nằm trên .sheet-backdrop, z-index 50).
      // Điều bị cấm là xếp lớp cho NỘI DUNG trong thanh để né một lớp kính.
      if (rule.selector !== ".appbar") {
        const z = zIndexOf(rule.body);
        if (z !== null && z > 1) tricks.push(`${rule.selector} { z-index: ${z} }`);
      }
    }
    expect(tricks, "không thêm mẹo xếp lớp nào khác trên đường đi của thanh").toEqual([]);
  });

  it("3. nền của chính thanh là ĐỤC (màu surface của chủ đề)", () => {
    const bar = bodyOf(source, ".appbar");
    expect(bar, "thiếu rule .appbar").not.toBeNull();
    const background = decl(bar, "background") ?? decl(bar, "background-color");
    expect(
      isOpaqueBackground(background),
      `nền thanh phải đục — đang là: ${background}`,
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
    for (const selector of [".appbar-loc-name", ".appbar-time-value"]) {
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
    for (const selector of [".sheet-close", ".appbar-back", ".banner-dismiss"]) {
      const body = bodyOf(source, selector);
      expect(body, `thiếu rule ${selector}`).not.toBeNull();
      const px = (value) => Number.parseFloat(String(value).replace("px", ""));
      expect(px(decl(body, "width")), `${selector} phải rộng ≥ 44px`).toBeGreaterThanOrEqual(44);
      const height = decl(body, "height");
      const h = height !== null ? px(height) : px(decl(body, "min-height"));
      expect(h, `${selector} phải cao ≥ 44px`).toBeGreaterThanOrEqual(44);
    }
    expect(decl(bodyOf(source, ".sheet-close"), "touch-action")).toBe("manipulation");
  });
});

describe("thanh trên — CSS ĐÃ BUILD cũng phải sạch kính", () => {
  const files = distCssFiles();
  const run = files.length > 0 ? it : it.skip;

  run("7. không `backdrop-filter` nào trên đường đi của thanh trong dist/assets/*.css", () => {
    const offenders = [];
    for (const file of files) {
      const css = readFileSync(file, "utf8");
      for (const rule of barRules(css)) {
        for (const prop of GLASS) {
          const value = decl(rule.body, prop);
          if (value !== null) offenders.push(`${file.split("/").pop()} → ${rule.selector} { ${prop}: ${value} }`);
        }
      }
    }
    expect(offenders, "bản build vẫn còn kính trên thanh (minifier giữ lại bản -webkit-)").toEqual([]);
  });

  run("8. trong bản build, `.appbar` có nền đục và không có pseudo-element kính", () => {
    for (const file of files) {
      const css = readFileSync(file, "utf8");
      const bar = bodyOf(css, ".appbar");
      if (bar === null) continue;
      expect(isOpaqueBackground(decl(bar, "background") ?? decl(bar, "background-color"))).toBe(true);
      expect(
        rules(css).some((r) => /^\.appbar::(before|after)$/.test(r.selector)),
        `${file} còn .appbar::before/::after`,
      ).toBe(false);
    }
  });
});
