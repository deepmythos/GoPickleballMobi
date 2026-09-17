import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readText(...segments) {
  return readFileSync(resolve(root, ...segments), "utf8");
}

/** Bỏ các khối KHAI BÁO TOKEN; phần còn lại phải là rule component. */
function stripTokenBlocks(css) {
  return css
    .replace(/:root\s*\{[^}]*\}/g, "")
    .replace(/:root:not\(\[data-theme="light"\]\)\s*\{[^}]*\}/g, "")
    .replace(/:root\[data-theme="dark"\]\s*\{[^}]*\}/g, "");
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Lấy mọi khối `@media (<query>) { ... }` bằng cách đếm ngoặc. */
function mediaBlocks(css, query) {
  const marker = `@media (${query})`;
  const blocks = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf(marker, from);
    if (start === -1) break;
    const open = css.indexOf("{", start);
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
    blocks.push(css.slice(start, end));
    from = end;
  }
  return blocks;
}

const css = readText("src", "styles.css");
const html = readText("index.html");

describe("design tokens — colors stay in token blocks", () => {
  it("1. no literal hex/rgb/hsl color outside the token blocks", () => {
    const outside = stripComments(stripTokenBlocks(css));
    const literals = outside.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g);
    expect(literals).toBeNull();
  });

  it("2. no CSS named color outside the token blocks", () => {
    const outside = stripComments(stripTokenBlocks(css));
    const named =
      /\b(?:white|black|red|blue|green|yellow|orange|purple|gray|grey|silver|maroon|navy|teal|olive|lime|aqua|fuchsia|pink|brown|gold|beige|ivory|khaki|coral|salmon|crimson|indigo|violet|tan|azure|magenta|cyan)\b(?!-)/gi;
    expect(outside.match(named)).toBeNull();
  });

  it("3. every var(--x) used is declared, and no declared token is dead", () => {
    const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
    expect([...used].filter((name) => !declared.has(name))).toEqual([]);
    expect([...declared].filter((name) => !used.has(name))).toEqual([]);
  });

  it("4. every font-size outside token blocks goes through --fs-*", () => {
    const outside = stripComments(stripTokenBlocks(css));
    const bad = [...outside.matchAll(/font-size\s*:\s*([^;]+);/g)]
      .map((m) => m[1].trim())
      .filter((value) => !value.startsWith("var(--fs-"));
    expect(bad).toEqual([]);
  });

  it("5. every padding/margin/gap uses the 4px space scale or 0/auto", () => {
    const outside = stripComments(stripTokenBlocks(css));
    const bad = [];
    for (const m of outside.matchAll(
      /(padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap|row-gap|column-gap)\s*:\s*([^;]+);/g,
    )) {
      const value = m[2].trim();
      if (value.includes("var(--space-") || value.includes("var(--gutter)")) continue;
      if (/^(0|auto)(\s+(0|auto))*$/.test(value)) continue;
      bad.push(`${m[1]}: ${value}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("design tokens — required groups exist", () => {
  it("6. type scale, rhythm, radius, elevation, motion and line-height tokens", () => {
    for (const name of [
      "--fs-display",
      "--fs-2xl",
      "--fs-xl",
      "--fs-lg",
      "--fs-md",
      "--fs-sm",
      "--fs-xs",
      "--fs-2xs",
      "--lh-tight",
      "--lh-normal",
      "--tracking-caps",
      "--space-1",
      "--space-2",
      "--space-3",
      "--space-4",
      "--space-5",
      "--space-6",
      "--space-7",
      "--space-8",
      "--radius-xs",
      "--radius-sm",
      "--radius-md",
      "--radius-lg",
      "--radius-pill",
      "--elev-1",
      "--elev-2",
      "--elev-3",
      "--dur-fast",
      "--dur-base",
      "--dur-slow",
      "--ease-out",
      "--ease-in-out",
    ]) {
      expect(css, `thiếu token ${name}`).toMatch(new RegExp(`${name}\\s*:`));
    }
  });

  it("7. --gutter points at a 4px-grid space step", () => {
    expect(css).toMatch(/--gutter\s*:\s*var\(--space-[1-8]\)/);
  });

  it("8. both light and dark declare color-scheme", () => {
    expect(css).toMatch(/color-scheme\s*:\s*light/);
    expect(css).toMatch(/color-scheme\s*:\s*dark/);
    expect(css).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
    expect(css).toMatch(/:root\[data-theme="dark"\]/);
  });

  it("9. semantic color names exist for light and both dark paths", () => {
    const names = [
      "--bg",
      "--surface",
      "--surface-2",
      "--text",
      "--muted",
      "--faint",
      "--border",
      "--border-strong",
      "--good",
      "--good-soft",
      "--maybe",
      "--maybe-soft",
      "--bad",
      "--bad-soft",
      "--info",
      "--info-soft",
    ];
    const light = css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)"));
    const darkMatch = css.match(/:root\[data-theme="dark"\]\s*\{[^}]*\}/);
    expect(darkMatch, "thiếu khối :root[data-theme=\"dark\"]").toBeTruthy();
    const dark = darkMatch[0];
    for (const name of names) {
      expect(light, `light thiếu ${name}`).toMatch(new RegExp(`${name}\\s*:`));
      expect(dark, `dark thiếu ${name}`).toMatch(new RegExp(`${name}\\s*:`));
    }
  });
});

describe("theme — no flash before first paint", () => {
  it("10. inline script reuses THEME_STORAGE_KEY and runs before the module script", () => {
    const themeSource = readText("src", "ui", "theme.ts");
    const keyMatch = themeSource.match(/THEME_STORAGE_KEY\s*=\s*"([^"]+)"/);
    expect(keyMatch, "không tìm thấy THEME_STORAGE_KEY trong src/ui/theme.ts").toBeTruthy();
    const themeKey = keyMatch[1];

    const inlineMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(inlineMatch, "index.html thiếu inline script chống nháy theme").toBeTruthy();
    const inline = inlineMatch[1];
    const inlineStart = html.indexOf(inlineMatch[0]);
    const moduleStart = html.indexOf('<script type="module"');

    expect(inline).toContain(themeKey);
    expect(inline).toMatch(/document\.documentElement\.dataset\.theme|document\.documentElement\.setAttribute/);
    expect(inline).toMatch(/"light"/);
    expect(inline).toMatch(/"dark"/);
    expect(moduleStart).toBeGreaterThan(-1);
    expect(inlineStart).toBeLessThan(moduleStart);
  });

  it("11. main.ts reads the same key through the theme module, not a hard-coded literal", () => {
    const mainSource = readText("src", "main.ts");
    expect(mainSource).toContain("THEME_STORAGE_KEY");
    expect(mainSource).toMatch(/from "\.\/ui\/theme"/);
  });
});

describe("motion — reduced motion turns reveal off", () => {
  it("12. prefers-reduced-motion disables the reveal for the score block and factor list", () => {
    const blocks = mediaBlocks(css, "prefers-reduced-motion: reduce");
    expect(blocks.length).toBeGreaterThan(0);
    const combined = blocks.join("\n");
    expect(combined).toMatch(/animation:\s*none/);
    // .reveal bọc cả khối điểm (vòng) lẫn từng hàng yếu tố.
    expect(combined).toMatch(/\.reveal/);
    expect(combined).toMatch(/\.spin|\.skeleton/);
    expect(combined).toMatch(/\.factor|\.ring/);
  });

  it("13. reveal runs ≤ 220ms with a 24ms stagger, and the ring has no dash-offset transition", () => {
    const revealBlock = css.match(/\.reveal\s*\{[^}]*\}/);
    expect(revealBlock, "thiếu rule .reveal").toBeTruthy();
    expect(revealBlock[0]).toMatch(/var\(--dur-base\)/);
    const dur = css.match(/--dur-base:\s*(\d+)ms/);
    expect(dur, "thiếu --dur-base").toBeTruthy();
    expect(Number(dur[1])).toBeLessThanOrEqual(220);
    expect(css).toMatch(/animation-delay:\s*calc\(var\(--reveal-index\)\s*\*\s*24ms\)/);

    const ring = css.match(/\.ring-progress\s*\{[^}]*\}/);
    expect(ring, "thiếu rule .ring-progress").toBeTruthy();
    expect(ring[0]).not.toMatch(/transition/);
    expect(ring[0]).not.toMatch(/stroke-dashoffset/);
  });
});
