import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Hợp đồng CSS cho thanh trên: tên sân và giờ đang tính phải được vẽ TRÊN lớp kính
 * (nền mờ) của thanh, ở độ đục đầy đủ.
 *
 * Vì sao có test này: trên iPhone, hai dòng đó bị mờ/nhạt đi trong khi dòng toạ độ,
 * độ lệch UTC và điểm số vẫn nét. Nguyên nhân không nằm ở DOM (không có phần tử nào
 * phủ lên chúng) mà ở chỗ thanh TỰ tô nền mờ + `backdrop-filter` trên chính nó, nên
 * WebKit có thể ghép lớp kính lên trên chữ của thanh. Cách sửa là tách lớp kính ra
 * một lớp riêng LUÔN nằm dưới nội dung; test này khoá lại thứ tự đó.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(resolve(root, "src", "styles.css"), "utf8");

/** Bỏ các khối at-rule (@keyframes/@media/...) bằng cách đếm ngoặc. */
function stripAtBlocks(source, at) {
  const marker = `@${at}`;
  let out = "";
  let from = 0;
  for (;;) {
    const start = source.indexOf(marker, from);
    if (start === -1) {
      out += source.slice(from);
      return out;
    }
    out += source.slice(from, start);
    const open = source.indexOf("{", start);
    if (open === -1) {
      out += source.slice(start);
      return out;
    }
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1;
      else if (source[end] === "}") {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }
    from = end;
  }
}

/** Mọi khối rule `<selectors> { <decls> }` (đã bỏ at-rule + comment). */
function rules(source) {
  const clean = stripAtBlocks(source.replace(/\/\*[\s\S]*?\*\//g, ""), "keyframes");
  const found = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    found.push({ selector: m[1].trim().replace(/\s+/g, " "), body: m[2] });
  }
  return found;
}

const all = rules(css);

function bodyOf(selector) {
  const hit = all.find((r) => r.selector === selector);
  return hit ? hit.body : null;
}

function decl(body, property) {
  const m = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, ""));
  return m ? m[1].trim() : null;
}

function zIndexOf(body) {
  const value = decl(body, "z-index");
  return value === null ? null : Number(value);
}

/** Các rule có thể áp lên một phần tử trong thanh trên (thanh, con của thanh, chính hai dòng). */
function rulesTouchingAppBar() {
  return all.filter((r) => /\.appbar\b/.test(r.selector));
}

describe("thanh trên — thứ tự lớp: chữ phải nằm trên lớp kính", () => {
  it("1. lớp kính là một lớp RIÊNG (.appbar::before), không phải nền của chính thanh", () => {
    const bar = bodyOf(".appbar");
    expect(bar, "thiếu rule .appbar").not.toBeNull();
    expect(decl(bar, "backdrop-filter"), "thanh không được tự làm mờ nền").toBeNull();
    expect(
      decl(bar, "-webkit-backdrop-filter"),
      "thanh không được tự làm mờ nền (bản -webkit-)",
    ).toBeNull();

    const scrim = bodyOf(".appbar::before");
    expect(scrim, "thiếu lớp kính .appbar::before").not.toBeNull();
    expect(decl(scrim, "backdrop-filter")).toMatch(/blur\(/);
    expect(decl(scrim, "-webkit-backdrop-filter")).toMatch(/blur\(/);
    expect(decl(scrim, "position")).toBe("absolute");
    expect(zIndexOf(scrim), "lớp kính phải ở mức 0").toBe(0);
  });

  it("2. nội dung thanh trên nằm TRÊN lớp kính (z-index ≥ 1 + đã định vị)", () => {
    const content = bodyOf(".appbar > *");
    expect(content, "thiếu rule .appbar > * (lớp nội dung)").not.toBeNull();
    expect(decl(content, "position")).not.toBe("static");
    expect(zIndexOf(content)).toBeGreaterThan(0);
    expect(zIndexOf(bodyOf(".appbar::before"))).toBeLessThan(zIndexOf(content));
  });

  it("3. tên sân và giờ đang tính: đục hoàn toàn (opacity 1), tự định vị, trên lớp kính", () => {
    for (const sel of [".appbar-loc-name", ".appbar-time-value"]) {
      const body = bodyOf(sel);
      expect(body, `thiếu rule ${sel}`).not.toBeNull();
      expect(decl(body, "opacity"), `${sel} phải khai opacity: 1`).toBe("1");
      expect(decl(body, "position"), `${sel} phải được định vị`).not.toBe("static");
      expect(zIndexOf(body), `${sel} phải nằm trên lớp kính`).toBeGreaterThan(0);
    }
  });

  it("4. không rule nào được làm nhạt/mờ chữ của thanh (opacity < 1, filter, blend)", () => {
    const bad = [];
    for (const r of rulesTouchingAppBar()) {
      const opacity = decl(r.body, "opacity");
      if (opacity !== null && Number(opacity) < 1) bad.push(`${r.selector} → opacity: ${opacity}`);
      const filter = decl(r.body, "filter");
      if (filter !== null && filter !== "none") bad.push(`${r.selector} → filter: ${filter}`);
      const blend = decl(r.body, "mix-blend-mode");
      if (blend !== null && blend !== "normal") bad.push(`${r.selector} → mix-blend-mode: ${blend}`);
    }
    expect(bad).toEqual([]);
  });

  it("5. hai dòng đó không rơi vào nền trong suốt/ô phủ nào của thanh", () => {
    // Nền của thanh giờ là trong suốt (lớp kính đảm nhiệm) — nếu ai đó trả nền về
    // cho chính thanh thì chữ lại có nguy cơ bị lớp kính của thanh che.
    const bar = bodyOf(".appbar");
    expect(
      decl(bar, "background"),
      "nền của thanh phải là trong suốt — lớp kính (.appbar::before) mới tô nền",
    ).toMatch(/^(var\(--transparent\)|none|transparent)$/);
  });
});
