import { beforeEach, describe, expect, it } from "vitest";
import type { ForecastData } from "../api";
import { evaluate } from "../evaluate";
import type { HourlyPoint } from "../types";
import { windowSpanHours } from "../window";
import { renderApp } from "./render";
import { initialSheetState, sheetReducer } from "./sheet";

// Hai khối NGÀY/GIỜ và HƯỚNG SÂN vừa được dời từ sheet Cài đặt lên MÀN HÌNH CHÍNH.
// Test này ghìm: vị trí trong <main>, việc VẮNG MẶT trong .sheet, thứ tự, và tự cập
// nhật TẠI CHỖ cả hình full lẫn hình compact (không render lại app giữa cử chỉ).
//
// Dùng evaluate() THẬT trên dự báo tổng hợp để có đủ yếu tố (kể cả sun_bearing) cho
// hình compact ở hàng "chói nắng".

const FROM = "2026-06-21T16:00";
const TO = "2026-06-21T18:00";
const LOC = { lat: 49.9960846, lon: 8.7605459 };

type AppState = Parameters<typeof renderApp>[1];
type Actions = Parameters<typeof renderApp>[2];

// ---------------------------------------------------------------- DOM tối giản
// Cùng phong cách court-sun-range.test.ts; listener ghi vào MẢNG để dispatch "input" thật.

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attrs: Record<string, string> = {};
  readonly listeners: Record<string, ((event: unknown) => void)[]> = {};
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
    (this.listeners[type] ??= []).push(handler);
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

function hasClass(node: FakeNode, cls: string): boolean {
  return (node.attrs.class ?? node.className).split(/\s+/).includes(cls);
}

function mainOf(root: FakeNode): FakeNode {
  const main = byClass(root, "main")[0];
  if (!main) throw new Error("thiếu <main class=main>");
  return main;
}

function diagramVariant(root: FakeNode, variant: string): FakeNode {
  const svg = findAll(
    root,
    (node) => hasClass(node, "court-diagram") && node.attrs["data-variant"] === variant,
  )[0];
  if (!svg) throw new Error(`thiếu svg.court-diagram[data-variant=${variant}]`);
  return svg;
}

function rangeHandle(root: FakeNode, handle: "from" | "to"): FakeNode {
  const input = findAll(
    root,
    (node) =>
      node.tagName === "input" &&
      node.attrs.type === "range" &&
      hasClass(node, "hour-range-handle") &&
      node.dataset.handle === handle,
  )[0];
  if (!input) throw new Error(`thiếu tay nắm ${handle}`);
  return input;
}

function bearingRange(root: FakeNode): FakeNode {
  const input = findAll(
    root,
    (node) =>
      node.tagName === "input" &&
      node.attrs.type === "range" &&
      !hasClass(node, "hour-range-handle") &&
      node.attrs["aria-label"] !== undefined,
  )[0];
  if (!input) throw new Error("thiếu thanh trượt hướng sân");
  return input;
}

// ------------------------------------------------------------- dự báo tổng hợp

function hourTime(hour: number): string {
  return `2026-06-21T${String(hour).padStart(2, "0")}:00`;
}

function point(hour: number): HourlyPoint {
  return {
    time: hourTime(hour),
    temperature_2m: 22,
    apparent_temperature: 22,
    relative_humidity_2m: 45,
    dew_point_2m: 10,
    precipitation: 0,
    precipitation_probability: 0,
    rain: 0,
    weather_code: 0,
    cloud_cover: 20,
    visibility: 30000,
    wind_speed_10m: 5,
    wind_gusts_10m: 9,
    uv_index: 3,
    is_day: 1,
  };
}

function makeForecast(): ForecastData {
  return {
    hourly: Array.from({ length: 24 }, (_, hour) => point(hour)),
    daily: {
      time: ["2026-06-21"],
      sunrise: ["2026-06-21T04:43"],
      sunset: ["2026-06-21T21:28"],
    },
  };
}

function openInputs(): AppState["sheet"] {
  return sheetReducer(initialSheetState, { type: "open", panel: "inputs" });
}

function makeState(sheet: AppState["sheet"]): AppState {
  const location = { lat: LOC.lat, lon: LOC.lon, name: "Test court" };
  return {
    lang: "vi",
    location,
    targetHour: FROM,
    toHour: TO,
    nowLocal: "2026-06-21T15:37",
    courtBearing: 0,
    lights: false,
    baseUrls: {
      forecastBase: "https://api.open-meteo.com",
      airQualityBase: "https://air-quality-api.open-meteo.com",
      geocodingBase: "https://geocoding-api.open-meteo.com",
    },
    status: "ready",
    evaluation: evaluate({
      location: { lat: LOC.lat, lon: LOC.lon, name: "Test court" },
      forecast: makeForecast(),
      air: null,
      targetHour: FROM,
      toHour: TO,
      courtBearing: 0,
      lights: false,
      baseUrls: {
        forecastBase: "https://api.open-meteo.com",
        airQualityBase: "https://air-quality-api.open-meteo.com",
        geocodingBase: "https://geocoding-api.open-meteo.com",
      },
      fetchedAt: "2026-06-21T15:00:00Z",
    }),
    error: null,
    stale: false,
    forecast: null,
    air: null,
    fetchedAt: null,
    fetching: false,
    sheet,
    rawOpen: false,
    geoStatus: "idle",
    geoError: null,
    geoResults: [],
    searchQuery: "",
    draft: { ...location },
    atInput: FROM,
    toInput: TO,
    applyErrorKey: null,
    theme: "system",
    offline: false,
    update: { available: false, dismissed: false },
    updateCheck: { status: "idle" },
  };
}

function render(state: AppState): FakeNode {
  const root = new FakeNode("div");
  renderApp(root as unknown as HTMLElement, state, {} as Actions);
  return root;
}

describe("màn hình chính — hai khối dời từ sheet Cài đặt", () => {
  it("(1) .hour-range và hình full nằm trong <main>, KHÔNG có trong .sheet (kể cả khi sheet mở)", () => {
    const root = render(makeState(openInputs()));
    const main = mainOf(root);
    const sheet = byClass(root, "sheet")[0];
    expect(sheet, "thiếu .sheet khi panel mở").toBeDefined();

    expect(byClass(main, "hour-range").length, "main phải có .hour-range").toBe(1);
    expect(
      diagramVariant(main, "full"),
      "main phải có svg.court-diagram[data-variant=full]",
    ).toBeDefined();

    expect(byClass(sheet, "hour-range").length, "sheet KHÔNG được còn .hour-range").toBe(0);
    expect(
      byClass(sheet, "court-diagram").length,
      "sheet KHÔNG được còn svg.court-diagram",
    ).toBe(0);
  });

  it("(2) thứ tự <main>: khối giờ rồi khối sân nằm ở ĐÁY, SAU .raw và ngay trước footer", () => {
    const root = render(makeState(initialSheetState));
    const main = mainOf(root);
    const heroIndex = main.children.findIndex((child) => hasClass(child, "hero"));
    const rawIndex = main.children.findIndex((child) => hasClass(child, "raw"));
    const reasonsIndex = main.children.findIndex((child) => hasClass(child, "reasons"));
    const timeIndex = main.children.findIndex((child) => child.dataset.block === "time");
    const courtIndex = main.children.findIndex((child) => child.dataset.block === "court");

    expect(heroIndex, "thiếu hero").toBeGreaterThanOrEqual(0);
    expect(reasonsIndex, "thiếu section.reasons").toBeGreaterThan(heroIndex);
    expect(rawIndex, "thiếu section.raw").toBeGreaterThan(reasonsIndex);
    // Hai khối KHÔNG còn ngay sau hero; chúng ở cuối <main>, sau .raw.
    expect(timeIndex, "thiếu section[data-block=time]").toBeGreaterThan(rawIndex);
    expect(courtIndex, "thiếu section[data-block=court]").toBe(timeIndex + 1);
    // "Ngay trước footer": footer là em của <main>, nên hai khối phải là hai con CUỐI của <main>.
    expect(courtIndex, "khối sân phải là con cuối cùng của <main>").toBe(main.children.length - 1);
    expect(timeIndex, "khối giờ phải ngay trước khối sân").toBe(courtIndex - 1);
  });

  it("(3) kéo tay nắm `to` 18 -> 19: CẢ HAI hình đổi đầu cuối trong cùng một turn, giữ nguyên <svg>", () => {
    const root = render(makeState(initialSheetState));
    const fullBefore = diagramVariant(root, "full");
    const compactBefore = diagramVariant(root, "compact");
    const fullEndBefore = Number(fullBefore.attrs["data-sun-azimuth-end"]);
    const compactEndBefore = Number(compactBefore.attrs["data-sun-azimuth-end"]);

    rangeHandle(root, "to").listeners.input[0]({ target: { value: "19" } });

    const fullAfter = diagramVariant(root, "full");
    const compactAfter = diagramVariant(root, "compact");
    const fullEndAfter = Number(fullAfter.attrs["data-sun-azimuth-end"]);
    const compactEndAfter = Number(compactAfter.attrs["data-sun-azimuth-end"]);

    // CÙNG node <svg> => không render lại app, chỉ vẽ lại lớp mặt trời tại chỗ.
    expect(fullAfter, "hình full phải giữ nguyên danh tính").toBe(fullBefore);
    expect(compactAfter, "hình compact phải giữ nguyên danh tính").toBe(compactBefore);
    // Cả hai mặt vẽ phải nhận CÙNG khoảng mới trong cùng turn.
    expect(fullEndAfter).not.toBe(fullEndBefore);
    expect(compactEndAfter).not.toBe(compactEndBefore);
    expect(compactEndAfter).toBe(fullEndAfter);
    expect(Number(fullAfter.attrs["data-sun-arc-end"])).toBe(fullEndAfter);
    expect(Number(compactAfter.attrs["data-sun-arc-end"])).toBe(compactEndAfter);
  });

  it("(4) kéo thanh bearing: data-court-bearing của CẢ HAI hình đổi cùng lúc + nhãn số đổi", () => {
    const root = render(makeState(initialSheetState));
    const full = diagramVariant(root, "full");
    const compact = diagramVariant(root, "compact");
    expect(full.attrs["data-court-bearing"]).toBe("0");
    expect(compact.attrs["data-court-bearing"]).toBe("0");

    bearingRange(root).listeners.input[0]({ target: { value: "90" } });

    expect(full.attrs["data-court-bearing"]).toBe("90");
    expect(compact.attrs["data-court-bearing"]).toBe("90");
    expect(byClass(root, "bearing-value")[0].textContent).toBe("90°");
  });

  it("(5) khoảng mặc định vẫn là 2 giờ (đọc từ windowSpanHours/evaluation, không bịa số)", () => {
    const state = makeState(initialSheetState);
    const root = render(state);
    const container = byClass(mainOf(root), "hour-range")[0];
    const evaluatedSpan = state.evaluation?.range.spanHours;
    expect(windowSpanHours(FROM, TO)).toBe(2);
    expect(evaluatedSpan).toBe(2);
    expect(container.dataset.spanHours).toBe(String(windowSpanHours(FROM, TO)));
  });
});
