import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dictionaries, t } from "../i18n";
import { solarPosition } from "../sun";
import { APP_TIMEZONE, zonedToUtc } from "../time";
import { renderApp } from "./render";
import { initialSheetState } from "./sheet";

/**
 * Bốn chỉnh sửa nhỏ theo yêu cầu chủ sân (card t_5557b6f3):
 *
 *  1. XOÁ hai dòng chữ "Điều kiện thô" + "Giá trị API tại giờ đã chọn." — khỏi DOM **và** khỏi
 *     cả ba từ điển (khoá `raw.title`, `raw.subtitle`). Phần điều kiện thô và các giá trị/nguồn
 *     của nó phải còn nguyên.
 *  2. Hình minh hoạ sân KHÔNG còn ở dòng tóm tắt của hàng "chói nắng theo hướng sân" — nó nằm
 *     trong NỘI DUNG MỞ RỘNG (chỉ thấy khi bấm mở ô).
 *  3. Khối thông tin: lề trái = lề phải = lề dưới.
 *  4. Ngày/giờ xuống dòng riêng NGAY DƯỚI địa điểm (sau `.infobar-loc` trong DOM order).
 *
 * Môi trường test là "node" với DOM giả (như court-main.test.ts / infobar.test.ts) — không thêm
 * thư viện DOM nào. Số đo hình học thật (getBoundingClientRect / computed padding) được đo trong
 * trình duyệt headless và dán vào biên bản của card; ở đây khoá lại phần DOM + CSS nguồn.
 */

type AppState = Parameters<typeof renderApp>[1];
type Actions = Parameters<typeof renderApp>[2];
type Evaluation = NonNullable<AppState["evaluation"]>;
type Point = Evaluation["point"];
type Lang = AppState["lang"];

const LANGS = ["vi", "de", "en"] as const;
const TARGET_HOUR = "2026-09-18T14:00";
const DIETZENBACH = { lat: 49.9960846, lon: 8.7605459 };

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attrs: Record<string, string> = {};
  className = "";
  dataset: Record<string, string> = {};
  private ownText = "";

  constructor(readonly tagName: string) {}

  appendChild(child: FakeNode): FakeNode {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = String(value);
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  addEventListener(): void {
    /* render chỉ gắn callback; test này không mô phỏng sự kiện. */
  }

  set textContent(value: string) {
    this.ownText = String(value);
    this.children.length = 0;
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }
}

class FakeText extends FakeNode {
  constructor(text: string) {
    super("#text");
    this.textContent = text;
  }
}

beforeEach(() => {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new FakeNode(tag),
    createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
    createTextNode: (text: string) => new FakeText(text),
  };
  (globalThis as unknown as { Node: unknown }).Node = FakeNode;
});

function findAll(root: FakeNode, predicate: (node: FakeNode) => boolean): FakeNode[] {
  const found: FakeNode[] = [];
  const walk = (node: FakeNode): void => {
    if (predicate(node)) found.push(node);
    node.children.forEach(walk);
  };
  walk(root);
  return found;
}

/** Thứ tự DOM thật (duyệt trước-sau) — dùng để so "phần tử nào đứng trước". */
function documentOrder(root: FakeNode): FakeNode[] {
  const order: FakeNode[] = [];
  const walk = (node: FakeNode): void => {
    order.push(node);
    node.children.forEach(walk);
  };
  walk(root);
  return order;
}

function classesOf(node: FakeNode): string[] {
  return (node.attrs.class ?? node.className).split(/\s+/).filter((c) => c.length > 0);
}

function byClass(root: FakeNode, cls: string): FakeNode[] {
  return findAll(root, (node) => classesOf(node).includes(cls));
}

function one(root: FakeNode, cls: string): FakeNode {
  const hits = byClass(root, cls);
  expect(hits.length, `phải có đúng 1 .${cls}`).toBe(1);
  return hits[0];
}

function makePoint(): Point {
  return {
    time: TARGET_HOUR,
    temperature_2m: 20,
    apparent_temperature: 20,
    relative_humidity_2m: 50,
    dew_point_2m: 10,
    precipitation: 0,
    precipitation_probability: 0,
    rain: 0,
    weather_code: 0,
    cloud_cover: 10,
    visibility: 20000,
    wind_speed_10m: 5,
    wind_gusts_10m: 8,
    uv_index: 2,
    is_day: 1,
  };
}

const FACTORS: Evaluation["factors"] = [
  { id: "rain_current", value: 0, unit: "mm/h", impact: 8 },
  { id: "sun_bearing", value: 0, unit: "deg", impact: -4 },
  { id: "is_day", value: 1, unit: "bool", impact: 10 },
];

function state(overrides: Partial<AppState> = {}): AppState {
  const location = { ...DIETZENBACH, name: "Test court" };
  const sun = solarPosition(zonedToUtc(TARGET_HOUR, APP_TIMEZONE), location.lat, location.lon);
  const evaluation: Evaluation = {
    targetHour: TARGET_HOUR,
    utcOffsetMinutes: 120,
    localTime: TARGET_HOUR,
    detailHour: TARGET_HOUR,
    point: makePoint(),
    sun,
    sunStart: sun,
    sunEnd: sun,
    score: 80,
    verdict: "Nên đi",
    range: {
      from: TARGET_HOUR,
      to: TARGET_HOUR,
      spanHours: 0,
      midpointHour: TARGET_HOUR,
      hours: [{ hour: TARGET_HOUR, score: 80, verdict: "Nên đi" }],
      score: 80,
      verdict: "Nên đi",
      countedHours: 1,
      missingHours: [],
    },
    factors: FACTORS.map((factor) => ({ ...factor })),
    gates: [],
    missing: [],
    confidence: "high",
    rain3h: 0,
    rain3hComplete: true,
    aqi: null,
    pm25: null,
    pm10: null,
    sunrise: null,
    sunset: null,
    dataSource: { forecastBase: "https://api.open-meteo.com", fetchedAt: "2026-09-18T13:00" },
  };
  return {
    lang: "vi",
    location,
    targetHour: TARGET_HOUR,
    nowLocal: "2026-09-18T13:37",
    courtBearing: 0,
    lights: false,
    baseUrls: {
      forecastBase: "https://api.open-meteo.com",
      airQualityBase: "https://air-quality-api.open-meteo.com",
      geocodingBase: "https://geocoding-api.open-meteo.com",
    },
    status: "ready",
    evaluation,
    error: null,
    stale: false,
    forecast: null,
    air: null,
    fetchedAt: null,
    fetching: false,
    sheet: initialSheetState,
    rawOpen: true,
    blocksOpen: { timecourt: false, location: false },
    geoStatus: "idle",
    geoError: null,
    geoResults: [],
    searchQuery: "",
    draft: { ...location },
    atInput: TARGET_HOUR,
    applyErrorKey: null,
    theme: "system",
    offline: false,
    update: { available: false, dismissed: false },
    updateCheck: { status: "idle" },
    ...overrides,
  };
}

function render(s: AppState): FakeNode {
  const root = new FakeNode("div");
  renderApp(root as unknown as HTMLElement, s, {} as Actions);
  return root;
}

/** Hàng yếu tố "chói nắng theo hướng sân" (nhãn đúng theo ngôn ngữ đang xét). */
function glareRow(root: FakeNode, lang: Lang): FakeNode {
  const wanted = t(lang, "factor.sun_bearing");
  const rows = findAll(
    root,
    (n) => n.tagName === "li" && classesOf(n).includes("factor"),
  );
  const row = rows.find((li) => {
    const label = byClass(li, "factor-label")[0];
    return label !== undefined && label.textContent === wanted;
  });
  if (!row) throw new Error(`không tìm thấy hàng ${wanted}`);
  return row;
}

// ---------------------------------------------------------------- CSS nguồn

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(resolve(repoRoot, "src", "styles.css"), "utf8");

function ruleBody(source: string, selector: string): string | null {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    if (m[1].trim().replace(/\s+/g, " ") === selector) return m[2];
  }
  return null;
}

function decl(body: string, property: string): string | null {
  const m = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
}

/** Giá trị px của một token --space-N khai trong :root. */
function spacePx(token: string): number {
  const m = css.match(new RegExp(`${token}\\s*:\\s*(\\d+)px`));
  if (!m) throw new Error(`không tìm thấy ${token} trong styles.css`);
  return Number(m[1]);
}

/** Bốn cạnh của shorthand padding, đã quy về px qua các token --space-*. */
function paddingSides(body: string): { top: number; right: number; bottom: number; left: number } {
  const raw = decl(body, "padding");
  expect(raw, "thiếu khai báo padding").not.toBeNull();
  const parts = String(raw).split(/\s+/).map((part) => {
    if (part === "0") return 0;
    const token = part.match(/^var\((--space-\d)\)$/);
    if (token) return spacePx(token[1]);
    const px = part.match(/^(\d+)px$/);
    if (px) return Number(px[1]);
    throw new Error(`giá trị padding không đọc được: ${part}`);
  });
  const [top, right = top, bottom = top, left = right] = parts;
  return { top, right, bottom, left };
}

// ---------------------------------------------------------------- 1. hai dòng chữ bị xoá

/** Hai chuỗi đã bị xoá, ở cả ba ngôn ngữ (khoá i18n cũng bị xoá theo). */
const DELETED = {
  keys: ["raw.title", "raw.subtitle"],
  values: [
    "Điều kiện thô",
    "Giá trị API tại giờ đã chọn.",
    "Raw conditions",
    "API values for the selected hour.",
    "Rohdaten",
    "API-Werte zur gewählten Stunde.",
  ],
};

describe("1. bỏ tiêu đề + phụ đề mục điều kiện thô (DOM và từ điển)", () => {
  it("hai chuỗi bị xoá KHÔNG còn trong DOM (rawOpen = true), ở cả ba ngôn ngữ", () => {
    for (const lang of LANGS) {
      const root = render(state({ lang }));
      for (const gone of DELETED.values) {
        expect(root.textContent, `${lang} vẫn render: ${gone}`).not.toContain(gone);
      }
      // Không khoá thô nào bị render thay cho chuỗi (t() trả về chính khoá khi thiếu).
      for (const key of DELETED.keys) {
        expect(root.textContent, `${lang} render khoá thô ${key}`).not.toContain(key);
      }
    }
  });

  it("khoá raw.title / raw.subtitle đã bị XOÁ khỏi cả ba từ điển", () => {
    for (const lang of LANGS) {
      const dict = dictionaries[lang] as Record<string, string>;
      for (const key of DELETED.keys) {
        expect(
          Object.prototype.hasOwnProperty.call(dict, key),
          `${lang} vẫn còn khoá "${key}"`,
        ).toBe(false);
      }
      for (const gone of DELETED.values) {
        expect(Object.values(dict), `${lang} vẫn còn giá trị "${gone}"`).not.toContain(gone);
      }
    }
  });

  it("phần điều kiện thô vẫn CÒN: nút mở/đóng + 21 giá trị thô", () => {
    const root = render(state({ rawOpen: true }));
    expect(byClass(root, "raw").length, "thiếu section.raw").toBe(1);
    const toggle = byClass(root, "raw-toggle")[0];
    expect(toggle, "thiếu nút .raw-toggle").toBeDefined();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe(t("vi", "panel.hideRaw"));
    const stats = byClass(root, "stat");
    // Hợp nhất hai làn: main có 21 ô; làn mưa 3 giờ THÊM ô "Mưa 3 giờ trước" (raw.rain3h, khoá mới
    // trong cả ba từ điển) ⇒ 22 ô. Số ô là 22, không phải 21 như trước khi hợp nhất.
    expect(stats.length, "phải còn đủ 22 ô thông số thô (21 của main + ô mưa 3 giờ)").toBe(22);
    // Giá trị + nguồn vẫn hiện: nhiệt độ và nguồn dữ liệu ở phần giả định/dữ liệu gốc.
    expect(root.textContent).toContain(t("vi", "raw.temperature"));
    expect(root.textContent).toContain(t("vi", "raw.sunAzimuth"));
  });
});

// ---------------------------------------------------------------- 2. hình vào nội dung mở rộng

describe("2. hình minh hoạ sân nằm trong nội dung mở rộng của hàng chói nắng", () => {
  it("KHÔNG có hình trong summary, ĐÚNG 1 hình trong nội dung mở rộng (cả 3 ngôn ngữ)", () => {
    for (const lang of LANGS) {
      const root = render(state({ lang }));
      const row = glareRow(root, lang);
      const details = findAll(row, (n) => n.tagName === "details")[0];
      expect(details, "thiếu thẻ details trong hàng").toBeDefined();
      const summary = findAll(details, (n) => n.tagName === "summary")[0];
      expect(summary, "thiếu summary trong hàng").toBeDefined();
      const detail = findAll(details, (n) => n.tagName === "div" && classesOf(n).includes("factor-detail"))[0];
      expect(detail, `thiếu .factor-detail cho ${lang}`).toBeDefined();

      // Dòng tóm tắt: chỉ còn icon + nhãn + giá trị + tác động — không có hình, không có cột hình.
      expect(byClass(summary, "court-diagram").length, `${lang}: hình vẫn ở dòng tóm tắt`).toBe(0);
      expect(byClass(summary, "factor-diagram").length, `${lang}: khung hình vẫn ở dòng tóm tắt`).toBe(0);
      expect(summary.getAttribute("style"), `${lang}: dòng tóm tắt còn style cột hình`).toBeNull();

      // Nội dung mở rộng: đúng một hình, vẫn là module vẽ dùng chung, vẫn role="img" + nhãn.
      const inDetail = byClass(detail, "court-diagram");
      expect(inDetail.length, `${lang}: nội dung mở rộng phải có đúng 1 hình`).toBe(1);
      expect(inDetail[0].getAttribute("role")).toBe("img");
      const label = inDetail[0].getAttribute("aria-label") ?? "";
      expect(label.length, `${lang}: aria-label rỗng`).toBeGreaterThan(0);
      expect(inDetail[0].getAttribute("data-sun-azimuth")).not.toBeNull();
      // Phương vị vẽ = phương vị mặt trời đã tính (không tự tính lại trong hình).
      const rotor = findAll(detail, (n) => n.attrs["data-sun-rotor"] !== undefined)[0];
      expect(rotor, `${lang}: thiếu rotor mặt trời trong hình`).toBeDefined();
      const drawn = Number((rotor.attrs.transform.match(/rotate\(([-\d.]+)/) ?? [])[1]);
      const azimuth = Number(inDetail[0].getAttribute("data-sun-azimuth"));
      expect(Math.abs(drawn - azimuth), `${lang}: góc vẽ lệch phương vị`).toBeLessThanOrEqual(2);
    }
  });

  it("các hàng yếu tố khác không có hình, và khi sheet đóng app vẽ ĐÚNG 2 hình (full + compact)", () => {
    const root = render(state());
    // Hợp nhất hai làn: hình FULL (300px) đã dời lên màn hình chính, hình COMPACT 64px vẫn nằm
    // trong nội dung mở rộng của hàng "chói nắng" (chủ dự án quyết định GIỮ). Vì vậy số hình
    // khi sheet đóng là 2 — đúng một bản mỗi loại — chứ không còn là 1 như trước khi hợp nhất.
    const diagrams = byClass(root, "court-diagram");
    expect(diagrams.length, "phải có đúng 2 hình khi sheet đóng: full + compact").toBe(2);
    expect(diagrams.filter((n) => n.getAttribute("data-variant") === "full").length, "thiếu đúng 1 hình full").toBe(1);
    expect(diagrams.filter((n) => n.getAttribute("data-variant") === "compact").length, "thiếu đúng 1 hình compact").toBe(1);
    const rows = findAll(root, (n) => n.tagName === "li" && classesOf(n).includes("factor"));
    expect(rows.length, "phải có nhiều hàng yếu tố để đối chứng").toBeGreaterThan(1);
    for (const row of rows) {
      const inSummary = byClass(row, "factor-summary").flatMap((s) => byClass(s, "court-diagram"));
      expect(inSummary.length, "hình không được nằm ở dòng tóm tắt của bất kỳ hàng nào").toBe(0);
    }
  });
});

// ---------------------------------------------------------------- 3. lề khối thông tin

describe("3. khối thông tin: lề trái = lề phải = lề dưới", () => {
  it(".infobar chỉ khai một bước lề → bốn cạnh bằng nhau", () => {
    const body = ruleBody(css, ".infobar");
    expect(body, "thiếu rule .infobar").not.toBeNull();
    const sides = paddingSides(String(body));
    expect(sides.left, "lề trái phải bằng lề dưới").toBe(sides.bottom);
    expect(sides.right, "lề phải phải bằng lề dưới").toBe(sides.bottom);
    expect(sides.top, "lề trên phải bằng lề dưới (một bước chung)").toBe(sides.bottom);
    expect(sides.bottom, "lề dưới phải > 0 — khối không dính sát viền").toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- 4. ngày/giờ xuống dòng riêng

describe("4. ngày/giờ nằm sau địa điểm trong DOM order", () => {
  it(".infobar-time đứng SAU .infobar-loc-text trong CÙNG dòng tóm tắt .infobar-summary", () => {
    for (const lang of LANGS) {
      const root = render(state({ lang }));
      const bar = one(root, "infobar");
      const summary = one(bar, "infobar-summary");
      const locText = one(summary, "infobar-loc-text");
      const time = one(summary, "infobar-time");
      const order = documentOrder(summary);
      expect(order.indexOf(locText), `${lang}: không thấy .infobar-loc-text`).toBeGreaterThan(-1);
      expect(order.indexOf(time), `${lang}: không thấy .infobar-time`).toBeGreaterThan(-1);
      expect(
        order.indexOf(time) > order.indexOf(locText),
        `${lang}: .infobar-time phải đứng sau .infobar-loc-text`,
      ).toBe(true);
      // Không còn <button> lồng trong <summary> (markup tương tác lồng nhau không hợp lệ):
      // dòng tóm tắt LÀ điều khiển mở/gấp.
      expect(
        findAll(summary, (n) => n.tagName === "button").length,
        `${lang}: summary không được chứa <button>`,
      ).toBe(0);
      // Vẫn đủ 4 trường của khối thông tin.
      for (const cls of ["infobar-loc-name", "infobar-coords", "infobar-time-value", "infobar-offset"]) {
        expect(byClass(bar, cls).length, `${lang}: thiếu .${cls}`).toBe(1);
      }
      // Cấu trúc: .infobar có đúng một con là <details> gấp; nội dung điều khiển địa điểm
      // nằm trong .infobar-body (MỞ RỘNG), không còn trong sheet nào.
      const elements = (node: FakeNode): FakeNode[] => node.children.filter((c) => c.tagName !== "#text");
      const barChildren = elements(bar);
      expect(barChildren.length, `${lang}: .infobar phải chỉ chứa một <details>`).toBe(1);
      expect(barChildren[0].tagName).toBe("details");
      expect(barChildren[0].dataset.collapse).toBe("location");
      expect(one(bar, "infobar-body").tagName).toBe("div");
    }
  });

  it("mốc giờ vẫn là giờ đang tính kèm nhãn lệch UTC", () => {
    const root = render(state());
    const bar = one(root, "infobar");
    expect(one(bar, "infobar-time-value").textContent).toContain("14:00");
    expect(one(bar, "infobar-offset").textContent).toBe("(UTC+02:00)");
  });
});
