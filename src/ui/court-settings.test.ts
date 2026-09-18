import { beforeEach, describe, expect, it } from "vitest";
import { dictionaries, t } from "../i18n";
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

const LANGS = ["vi", "de", "en"] as const;
const TARGET_HOUR = "2026-06-21T09:00";
const DIETZENBACH = { lat: 49.9960846, lon: 8.7605459 };
const TOKYO = { lat: 35.6762, lon: 139.6503 };

/**
 * DOM tối giản cho môi trường test "node" (copy nguyên cách dựng của appbar.test.ts),
 * nhưng GHI LẠI listener để test gọi được handler "input" của thanh trượt.
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

function makeEvaluation(sun: { azimuth: number; elevation: number }, isDay = 1): Evaluation {
  return {
    targetHour: TARGET_HOUR,
    utcOffsetMinutes: 120,
    localTime: TARGET_HOUR,
    point: makePoint({ is_day: isDay }),
    sun,
    score: 80,
    verdict: "Nên đi",
    factors: [],
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

describe("sheet Cài đặt — hình sân đúng tỉ lệ + hướng nắng thật", () => {
  it("(a) góc vẽ ra khớp azimuth thật của solarPosition cho 2 bộ toạ độ", () => {
    const coords = [DIETZENBACH, TOKYO];
    const azimuths: number[] = [];
    for (const c of coords) {
      const sun = sunAt(TARGET_HOUR, c);
      azimuths.push(sun.azimuth);
      const root = render(
        state({ sheet: openInputs(), evaluation: makeEvaluation(sun), location: { ...c, name: "x" } }),
      );
      const svg = byClass(root, "court-diagram")[0];
      expect(svg, "thiếu svg.court-diagram").toBeDefined();
      const rotor = byAttr(root, "data-sun-rotor")[0];
      expect(rotor, "thiếu [data-sun-rotor]").toBeDefined();
      const drawn = rotationAngle(rotor.attrs.transform);
      const attrAz = Number(svg.attrs["data-sun-azimuth"]);
      expect(angleDelta(drawn, sun.azimuth), "góc vẽ lệch quá 2°").toBeLessThanOrEqual(2);
      expect(Math.abs(attrAz - sun.azimuth), "data-sun-azimuth lệch quá 2°").toBeLessThanOrEqual(2);
    }
    // Hai bộ toạ độ phải cho hai phương vị KHÁC NHAU (nếu không, phép so là vô nghĩa).
    expect(angleDelta(azimuths[0], azimuths[1])).toBeGreaterThan(2);
  });

  it("(b) mặc định Bắc–Nam: bearing 0, rotate(0 0 0), tỉ lệ 13.41/6.10", () => {
    const root = render(
      state({ sheet: openInputs(), courtBearing: 0, evaluation: makeEvaluation(sunAt(TARGET_HOUR, DIETZENBACH)) }),
    );
    const svg = byClass(root, "court-diagram")[0];
    expect(svg.attrs["data-court-bearing"]).toBe("0");
    const rotor = byAttr(root, "data-court-rotor")[0];
    expect(rotor.attrs.transform).toBe("rotate(0 0 0)");
    const rect = byClass(root, "cd-court")[0];
    const width = Number(rect.attrs.width);
    const height = Number(rect.attrs.height);
    const expected = 13.41 / 6.1;
    expect(Math.abs(height / width - expected) / expected).toBeLessThan(0.005);
  });

  it("(c) văn giải thích + nút Bắc/Nam đã biến mất ở cả 3 ngôn ngữ", () => {
    const oldStrings = [
      "0° = north–south, 90° = east–west. Used for the glare calculation.",
      "0° = Bắc–Nam, 90° = Đông–Tây. Dùng để tính chói nắng.",
      "0° = Nord–Süd, 90° = Ost–West. Wird für die Blendungsberechnung genutzt.",
      "North–South",
      "Bắc–Nam",
      "Nord–Süd",
    ];
    for (const lang of LANGS) {
      const root = render(state({ lang, sheet: openInputs() }));
      const sheet = byClass(root, "sheet")[0];
      expect(sheet, `thiếu .sheet cho ${lang}`).toBeDefined();
      for (const literal of oldStrings) {
        expect(sheet.textContent, `${lang} vẫn còn "${literal}"`).not.toContain(literal);
      }
      const dict = dictionaries[lang] as Record<string, string | undefined>;
      expect(dict["court.bearingHint"], `${lang} còn khoá court.bearingHint`).toBeUndefined();
      expect(dict["court.northSouth"], `${lang} còn khoá court.northSouth`).toBeUndefined();
    }
  });

  it("(d) hình có mặt: role/aria, chữ N, đủ nét sân", () => {
    for (const lang of LANGS) {
      const root = render(
        state({ lang, sheet: openInputs(), evaluation: makeEvaluation(sunAt(TARGET_HOUR, DIETZENBACH)) }),
      );
      const svg = byClass(root, "court-diagram")[0];
      expect(svg, `thiếu svg cho ${lang}`).toBeDefined();
      expect(svg.attrs.role).toBe("img");
      const label = svg.attrs["aria-label"];
      expect(label.length, `aria-label rỗng cho ${lang}`).toBeGreaterThan(0);
      if (lang === "en") {
        expect(label.includes("north") || label.includes("east")).toBe(true);
      }
      const north = byClass(root, "cd-north")[0];
      expect(north, `thiếu chữ N cho ${lang}`).toBeDefined();
      expect(north.textContent).toBe(t(lang, "compass.n"));
    }
    const en = render(
      state({ lang: "en", sheet: openInputs(), evaluation: makeEvaluation(sunAt(TARGET_HOUR, DIETZENBACH)) }),
    );
    expect(byClass(en, "cd-line").length).toBeGreaterThanOrEqual(3); // lưới + 2 kitchen
    expect(byClass(en, "cd-service").length).toBeGreaterThanOrEqual(2); // 2 vạch service
  });

  it("(e) kéo thanh trượt cập nhật hình TẠI CHỖ, không render lại app", () => {
    const root = render(
      state({ lang: "vi", sheet: openInputs(), evaluation: makeEvaluation(sunAt(TARGET_HOUR, DIETZENBACH)) }),
    );
    const range = findAll(root, (n) => n.attrs.type === "range")[0];
    expect(range, "thiếu input[type=range]").toBeDefined();
    const handler = range.listeners.input;
    expect(handler, "thiếu listener 'input'").toBeDefined();
    handler({ target: { value: "90" } });

    const svg = byClass(root, "court-diagram")[0];
    const rotor = byAttr(root, "data-court-rotor")[0];
    const value = byClass(root, "bearing-value")[0];
    expect(svg.attrs["data-court-bearing"]).toBe("90");
    expect(rotor.attrs.transform).toBe("rotate(90 0 0)");
    expect(value.textContent).toBe("90°");
  });

  it("(f) mặt trời thấp → bóng dài hơn, đúng 0.86/tan(elevation)", () => {
    const high = render(state({ sheet: openInputs(), evaluation: makeEvaluation({ azimuth: 180, elevation: 55 }) }));
    const low = render(state({ sheet: openInputs(), evaluation: makeEvaluation({ azimuth: 180, elevation: 12 }) }));
    const depthHigh = Number(byClass(high, "court-diagram")[0].attrs["data-shadow-depth-m"]);
    const depthLow = Number(byClass(low, "court-diagram")[0].attrs["data-shadow-depth-m"]);
    expect(depthLow).toBeGreaterThan(depthHigh);
    const expectedLow = 0.86 / Math.tan((12 * Math.PI) / 180);
    const expectedHigh = 0.86 / Math.tan((55 * Math.PI) / 180);
    expect(Math.abs(depthLow - expectedLow) / expectedLow).toBeLessThan(0.01);
    expect(Math.abs(depthHigh - expectedHigh) / expectedHigh).toBeLessThan(0.01);
  });

  it("(g) trời tối → night không bóng; chưa có evaluation → unknown không bóng", () => {
    for (const lang of LANGS) {
      const night = render(
        state({ lang, sheet: openInputs(), evaluation: makeEvaluation({ azimuth: 180, elevation: -3 }, 0) }),
      );
      const nsvg = byClass(night, "court-diagram")[0];
      expect(nsvg.attrs["data-sun-state"]).toBe("night");
      expect(nsvg.attrs["data-shadow-depth-m"]).toBe("");
      expect(night.textContent).toContain(t(lang, "court.diagramNoSun"));

      // is_day = 0 dù cao độ dương vẫn là ban đêm.
      const dark = render(
        state({ lang, sheet: openInputs(), evaluation: makeEvaluation({ azimuth: 180, elevation: 30 }, 0) }),
      );
      expect(byClass(dark, "court-diagram")[0].attrs["data-sun-state"]).toBe("night");

      const unknown = render(state({ lang, sheet: openInputs(), evaluation: null }));
      const usvg = byClass(unknown, "court-diagram")[0];
      expect(usvg.attrs["data-sun-state"]).toBe("unknown");
      expect(usvg.attrs["data-shadow-depth-m"]).toBe("");
    }
  });

  it("nhãn aria đi qua i18n: ba ngôn ngữ cho ba nhãn KHÁC NHAU", () => {
    const sun = sunAt(TARGET_HOUR, DIETZENBACH);
    const labels = LANGS.map((lang) => {
      const root = render(state({ lang, sheet: openInputs(), evaluation: makeEvaluation(sun) }));
      return byClass(root, "court-diagram")[0].attrs["aria-label"];
    });
    expect(new Set(labels).size).toBe(3);
  });
});
