import { beforeEach, describe, expect, it } from "vitest";
import { t, type MessageKey } from "../i18n";
import { solarPosition } from "../sun";
import { APP_TIMEZONE, zonedToUtc } from "../time";
import { renderApp } from "./render";
import { initialSheetState, sheetReducer } from "./sheet";

// Chỉ import các module đã có sẵn: ./render, ./sheet, ../i18n, ../sun, ../time.
// Module vẽ (./court-diagram) KHÔNG được import ở đây — test chứng minh qua DOM render.
type AppState = Parameters<typeof renderApp>[1];
type Actions = Parameters<typeof renderApp>[2];
type Evaluation = NonNullable<AppState["evaluation"]>;
type Point = Evaluation["point"];
type Lang = AppState["lang"];

const LANGS = ["vi", "de", "en"] as const;
const TARGET_HOUR = "2026-06-21T09:00";
const DIETZENBACH = { lat: 49.9960846, lon: 8.7605459 };
const TOKYO = { lat: 35.6762, lon: 139.6503 };

/**
 * DOM tối giản cho môi trường test "node" (copy nguyên cách dựng của court-settings.test.ts),
 * nhưng GHI LẠI listener để test gọi được handler "input" nếu cần.
 */
class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attrs: Record<string, string> = {};
  readonly listeners: Record<string, (event: unknown) => void> = {};
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

  addEventListener(type: string, handler: (event: unknown) => void): void {
    this.listeners[type] = handler;
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

function byClass(root: FakeNode, cls: string): FakeNode[] {
  return findAll(root, (node) => (node.attrs.class ?? node.className).split(/\s+/).includes(cls));
}

function byAttr(root: FakeNode, name: string): FakeNode[] {
  return findAll(root, (node) => node.attrs[name] !== undefined);
}

function rotationAngle(transform: string): number {
  const m = transform.match(/rotate\(([-\d.]+)/);
  return m ? Number.parseFloat(m[1]) : Number.NaN;
}

/** Khoảng cách góc nhỏ nhất giữa hai hướng (0..180). */
function angleDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Bản sao TÍNH TOÁN ĐỘC LẬP của phép chia 8 hướng, chỉ dùng trong test để suy ra
 * từ i18n mong đợi — không import ./court-diagram nên test không phụ thuộc module vẽ.
 */
type Sector = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
const SECTORS: Sector[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
function compassSector(deg: number): Sector {
  const norm = ((deg % 360) + 360) % 360;
  return SECTORS[Math.round(norm / 45) % 8];
}
function compassWord(lang: Lang, deg: number): string {
  return t(lang, `compass.${compassSector(deg)}` as MessageKey);
}

function makePoint(over: Partial<Point> = {}): Point {
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
    ...over,
  };
}

/** Vài yếu tố khác + sun_bearing để hàng "chói nắng" thực sự có mặt trong danh sách. */
const FACTORS: Evaluation["factors"] = [
  { id: "rain_current", value: 0, unit: "mm/h", impact: 8 },
  { id: "wind_speed", value: 5, unit: "km/h", impact: 2 },
  { id: "sun_bearing", value: 0, unit: "deg", impact: -4 },
  { id: "is_day", value: 1, unit: "bool", impact: 10 },
];

function makeEvaluation(
  sun: { azimuth: number; elevation: number },
  isDay = 1,
  range?: Evaluation["range"],
): Evaluation {
  return {
    targetHour: TARGET_HOUR,
    utcOffsetMinutes: 120,
    localTime: TARGET_HOUR,
    detailHour: TARGET_HOUR,
    point: makePoint({ is_day: isDay }),
    sun,
    sunStart: sun,
    sunEnd: sun,
    score: 80,
    verdict: "Nên đi",
    range: range ?? {
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
    dataSource: { forecastBase: "https://api.open-meteo.com", fetchedAt: "2026-06-21T07:00" },
  };
}

function openInputs(): AppState["sheet"] {
  return sheetReducer(initialSheetState, { type: "open", panel: "inputs" });
}

function state(overrides: Partial<AppState> = {}): AppState {
  const location = { ...DIETZENBACH, name: "Test court" };
  return {
    lang: "vi",
    location,
    targetHour: TARGET_HOUR,
    nowLocal: "2026-06-21T08:00",
    courtBearing: 0,
    lights: false,
    baseUrls: {
      forecastBase: "https://api.open-meteo.com",
      airQualityBase: "https://air-quality-api.open-meteo.com",
      geocodingBase: "https://geocoding-api.open-meteo.com",
    },
    status: "ready",
    evaluation: null,
    error: null,
    stale: false,
    forecast: null,
    air: null,
    fetchedAt: null,
    fetching: false,
    sheet: openInputs(),
    rawOpen: false,
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

function sunAt(hour: string, coords: { lat: number; lon: number }) {
  return solarPosition(zonedToUtc(hour, APP_TIMEZONE), coords.lat, coords.lon);
}

function diagramIn(root: FakeNode): FakeNode[] {
  return byClass(root, "court-diagram");
}

/** Hàng yếu tố có nhãn đúng "Chói nắng theo hướng sân" (theo ngôn ngữ đang xét). */
function findGlareRow(root: FakeNode, lang: Lang): FakeNode {
  const wanted = t(lang, "factor.sun_bearing");
  const rows = findAll(
    root,
    (n) => n.tagName === "li" && (n.attrs.class ?? n.className).split(/\s+/).includes("factor"),
  );
  const row = rows.find((li) => {
    const label = byClass(li, "factor-label")[0];
    return label !== undefined && label.textContent === wanted;
  });
  if (!row) throw new Error(`không tìm thấy hàng ${wanted}`);
  return row;
}

describe("Màn hình chính — hình sân thu gọn trong hàng 'chói nắng theo hướng sân'", () => {
  it("(a) góc vẽ ra khớp azimuth thật của solarPosition cho 2 bộ toạ độ", () => {
    const coords = [DIETZENBACH, TOKYO];
    const azimuths: number[] = [];
    for (const c of coords) {
      const sun = sunAt(TARGET_HOUR, c);
      azimuths.push(sun.azimuth);
      const root = render(
        state({ sheet: initialSheetState, evaluation: makeEvaluation(sun), location: { ...c, name: "x" } }),
      );
      const row = findGlareRow(root, "vi");
      const svg = diagramIn(row)[0];
      expect(svg, "thiếu svg.court-diagram trong hàng chói nắng").toBeDefined();
      const rotor = byAttr(row, "data-sun-rotor")[0];
      expect(rotor, "thiếu [data-sun-rotor] trong hàng chói nắng").toBeDefined();
      const drawn = rotationAngle(rotor.attrs.transform);
      const attrAz = Number(svg.attrs["data-sun-azimuth"]);
      expect(angleDelta(drawn, sun.azimuth), "góc vẽ lệch quá 2°").toBeLessThanOrEqual(2);
      expect(Math.abs(attrAz - sun.azimuth), "data-sun-azimuth lệch quá 2°").toBeLessThanOrEqual(2);
    }
    // Hai bộ toạ độ phải cho hai phương vị KHÁC NHAU (nếu không, phép so là vô nghĩa).
    expect(angleDelta(azimuths[0], azimuths[1])).toBeGreaterThan(2);
  });

  it("(b) hình full (màn chính) và hình compact (hàng chói) mang CÙNG bộ giá trị", () => {
    const sun = sunAt(TARGET_HOUR, DIETZENBACH);
    const range: Evaluation["range"] = {
      from: TARGET_HOUR,
      to: "2026-06-21T11:00",
      spanHours: 2,
      midpointHour: "2026-06-21T10:00",
      hours: [
        { hour: TARGET_HOUR, score: 80, verdict: "Nên đi" },
        { hour: "2026-06-21T10:00", score: 80, verdict: "Nên đi" },
        { hour: "2026-06-21T11:00", score: 80, verdict: "Nên đi" },
      ],
      score: 80,
      verdict: "Nên đi",
      countedHours: 3,
      missingHours: [],
    };
    const root = render(state({ sheet: openInputs(), evaluation: makeEvaluation(sun, 1, range) }));
    const row = findGlareRow(root, "vi");
    const compact = diagramIn(row)[0];
    const courtSection = findAll(root, (n) => n.dataset.block === "court")[0];
    expect(courtSection, "thiếu section[data-block=court]").toBeDefined();
    const full = diagramIn(courtSection)[0];
    expect(full, "thiếu hình full trong khối sân").toBeDefined();
    expect(compact, "thiếu hình compact trong hàng chói").toBeDefined();
    expect(full.attrs["data-variant"]).toBe("full");
    expect(compact.attrs["data-variant"]).toBe("compact");
    for (const attr of [
      "data-court-bearing",
      "data-sun-azimuth-start",
      "data-sun-azimuth-end",
      "data-sun-arc-start",
      "data-sun-arc-end",
    ]) {
      expect(compact.attrs[attr], `compact thiếu ${attr}`).toBeDefined();
      expect(compact.attrs[attr], `compact lệch ${attr} so với full`).toBe(full.attrs[attr]);
    }
  });

  it("(c) sheet đóng: hình full ở khối sân + hình compact ở hàng chói, hàng khác không có hình", () => {
    const sun = sunAt(TARGET_HOUR, DIETZENBACH);
    const root = render(state({ sheet: initialSheetState, evaluation: makeEvaluation(sun) }));
    const courtSection = findAll(root, (n) => n.dataset.block === "court")[0];
    expect(courtSection, "thiếu section[data-block=court]").toBeDefined();
    expect(diagramIn(courtSection).length, "khối sân phải có đúng 1 hình full").toBe(1);
    expect(diagramIn(root).length, "phải có đúng 2 hình khi sheet đóng (full + compact)").toBe(2);
    const row = findGlareRow(root, "vi");
    expect(diagramIn(row).length, "hình compact phải nằm trong hàng chói").toBe(1);
    const rows = findAll(
      root,
      (n) => n.tagName === "li" && (n.attrs.class ?? n.className).split(/\s+/).includes("factor"),
    );
    expect(rows.length, "phải có nhiều hàng yếu tố để đối chứng").toBeGreaterThan(1);
    for (const r of rows) {
      const count = diagramIn(r).length;
      if (r === row) expect(count).toBe(1);
      else expect(count, "hàng khác không được có hình").toBe(0);
    }
  });

  it("(d) role/aria hợp lệ, ba ngôn ngữ ba nhãn khác nhau, đủ từ hướng sân + hướng nắng", () => {
    const sun = sunAt(TARGET_HOUR, DIETZENBACH);
    const labels: string[] = [];
    for (const lang of LANGS) {
      const root = render(state({ lang, sheet: initialSheetState, evaluation: makeEvaluation(sun) }));
      const row = findGlareRow(root, lang);
      const svg = diagramIn(row)[0];
      expect(svg, `thiếu hình cho ${lang}`).toBeDefined();
      expect(svg.attrs.role).toBe("img");
      const label = svg.attrs["aria-label"];
      expect(label.length, `aria-label rỗng cho ${lang}`).toBeGreaterThan(0);
      expect(label, `${lang} thiếu hướng trục sân`).toContain(compassWord(lang, 0));
      expect(label, `${lang} thiếu hướng mặt trời`).toContain(compassWord(lang, sun.azimuth));
      labels.push(label);
    }
    expect(new Set(labels).size).toBe(3);
  });

  it("(e) trời tối: data-sun-state night, không có bóng, có nhãn 'không nắng'", () => {
    for (const lang of LANGS) {
      const cases = [
        { azimuth: 180, elevation: 30, isDay: 0 }, // is_day = 0 dù cao độ dương
        { azimuth: 180, elevation: -3, isDay: 1 }, // cao độ <= 0
      ];
      for (const c of cases) {
        const root = render(
          state({
            lang,
            sheet: initialSheetState,
            evaluation: makeEvaluation({ azimuth: c.azimuth, elevation: c.elevation }, c.isDay),
          }),
        );
        const row = findGlareRow(root, lang);
        const svg = diagramIn(row)[0];
        expect(svg.attrs["data-sun-state"], `sai trạng thái cho ${lang}`).toBe("night");
        expect(byClass(row, "cd-shadow").length, "trời tối không được vẽ bóng").toBe(0);
        // Bản compact đã bỏ HẲN chữ; nhãn "không nắng" còn ở hình FULL (khối sân).
        const courtSection = findAll(root, (n) => n.dataset.block === "court")[0];
        const full = diagramIn(courtSection)[0];
        expect(full.textContent, `thiếu nhãn không nắng cho ${lang}`).toContain(
          t(lang, "court.diagramNoSun"),
        );
        expect(findAll(svg, (n) => n.tagName === "text").length, "compact phải có 0 <text>").toBe(0);
      }
    }
  });

  it("(f) hình thu gọn mang kích thước 64×64", () => {
    const sun = sunAt(TARGET_HOUR, DIETZENBACH);
    const root = render(state({ sheet: initialSheetState, evaluation: makeEvaluation(sun) }));
    const row = findGlareRow(root, "vi");
    const svg = diagramIn(row)[0];
    const style = svg.attrs.style ?? "";
    expect(style).toContain("width:64px");
    expect(style).toContain("height:64px");
  });
});
