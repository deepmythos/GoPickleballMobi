import { beforeEach, describe, expect, it } from "vitest";
import type { ForecastData } from "../api";
import { evaluate } from "../evaluate";
import { solarPosition } from "../sun";
import { APP_TIMEZONE, zonedToUtc } from "../time";
import type { HourlyPoint } from "../types";
import { courtDiagram } from "./court-diagram";
import { renderApp } from "./render";
import { initialSheetState, sheetReducer } from "./sheet";

// Test khoảng mặt trời trên hình sân: HAI mặt trời + cung chuyển động, và cập nhật TẠI CHỖ
// khi kéo tay nắm. Chạy evaluate() THẬT trên dự báo tổng hợp, rồi soi DOM render ra.
// Phương vị kỳ vọng được tính ĐỘC LẬP bằng ../sun + ../time, KHÔNG đọc lại từ input.

const FROM = "2026-06-21T16:00";
const TO = "2026-06-21T18:00";
const LOC = { lat: 49.9960846, lon: 8.7605459 };

type AppState = Parameters<typeof renderApp>[1];
type Actions = Parameters<typeof renderApp>[2];

// ---------------------------------------------------------------- DOM tối giản
// Cùng phong cách court-settings.test.ts; GHI LẠI listener để dispatch "input" thật.

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

/**
 * Hình sân ĐẦY ĐỦ trên MÀN HÌNH CHÍNH (khối sân vừa dời khỏi sheet Cài đặt).
 * Bỏ qua hình compact ở hàng "chói nắng" bằng selector data-variant="full".
 */
function fullDiagram(root: FakeNode): FakeNode {
  const svg = byClass(root, "court-diagram").find((node) => node.attrs["data-variant"] === "full");
  if (!svg) throw new Error("thiếu svg.court-diagram[data-variant=full] trên màn hình chính");
  return svg;
}

function angleDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
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

function evaluateWindow() {
  return evaluate({
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
  });
}

function openInputs(): AppState["sheet"] {
  return sheetReducer(initialSheetState, { type: "open", panel: "inputs" });
}

function makeState(): AppState {
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
    evaluation: evaluateWindow(),
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

function sunAt(hour: string) {
  return solarPosition(zonedToUtc(hour, APP_TIMEZONE), LOC.lat, LOC.lon);
}

describe("hình sân — khoảng mặt trời (hai mặt trời + cung chuyển động)", () => {
  it("(i–iv) vẽ đúng hai đầu, cung tăng dần, hai nhãn giờ và aria-label mô tả cả khoảng", () => {
    const root = render(makeState());
    const svg = fullDiagram(root);
    expect(svg, "thiếu svg.court-diagram").toBeDefined();

    // (i) Phương vị hai đầu khớp solarPosition() tính ĐỘC LẬP trong test (±2°).
    const expectedStart = sunAt(FROM);
    const expectedEnd = sunAt(TO);
    const drawnStart = Number(svg.attrs["data-sun-azimuth-start"]);
    const drawnEnd = Number(svg.attrs["data-sun-azimuth-end"]);
    expect(Number.isFinite(drawnStart), "thiếu data-sun-azimuth-start").toBe(true);
    expect(Number.isFinite(drawnEnd), "thiếu data-sun-azimuth-end").toBe(true);
    expect(angleDelta(drawnStart, expectedStart.azimuth)).toBeLessThanOrEqual(2);
    expect(angleDelta(drawnEnd, expectedEnd.azimuth)).toBeLessThanOrEqual(2);
    // Phép so chỉ có nghĩa khi mặt trời thực sự đã đi sang hướng mới.
    expect(angleDelta(expectedStart.azimuth, expectedEnd.azimuth)).toBeGreaterThan(2);
    // 0° = Bắc/trên, phương vị tăng dần = thuận chiều kim đồng hồ.
    expect(expectedEnd.azimuth).toBeGreaterThan(expectedStart.azimuth);
    console.log(
      `[court-sun] start 16:00 az=${expectedStart.azimuth.toFixed(2)}°, end 18:00 az=${expectedEnd.azimuth.toFixed(2)}°`,
    );

    // (ii) Một path cung của hình FULL, có dấu chiều tăng dần, hai góc = hai phương vị, sweep-flag = 1.
    const arcs = byClass(svg, "cd-sun-arc");
    expect(arcs.length, "phải có đúng một cung cd-sun-arc trên hình full").toBe(1);
    const arc = arcs[0];
    expect(arc.tagName).toBe("path");
    expect(arc.attrs["data-sun-arc-sweep"]).toBe("1");
    expect(angleDelta(Number(arc.attrs["data-sun-arc-start"]), expectedStart.azimuth)).toBeLessThanOrEqual(2);
    expect(angleDelta(Number(arc.attrs["data-sun-arc-end"]), expectedEnd.azimuth)).toBeLessThanOrEqual(2);
    const sweep = (((Number(arc.attrs["data-sun-arc-end"]) - Number(arc.attrs["data-sun-arc-start"])) % 360) + 360) % 360;
    expect(sweep).toBeGreaterThan(0);
    expect(sweep).toBeLessThan(360);
    expect(arc.attrs.d, "cung phải dùng sweep-flag = 1").toMatch(/A\s+[\d.]+\s+[\d.]+\s+0\s+[01]\s+1\s/);
    expect(byClass(svg, "cd-sun-arc-head").length, "thiếu đầu mũi tên cung").toBe(1);

    // (iii) Đúng hai nhãn giờ mang hai mốc của cửa sổ.
    const hourLabels = byClass(svg, "cd-sun-hour").map((node) => node.textContent);
    expect(hourLabels.length).toBe(2);
    expect([...hourLabels].sort()).toEqual(["16:00", "18:00"]);

    // (iv) aria-label nêu cả hai giờ và chiều chuyển động.
    const label = svg.attrs["aria-label"];
    expect(label).toContain("16:00");
    expect(label).toContain("18:00");
    expect(label).toContain("chiều kim đồng hồ");
  });

  it("cập nhật TẠI CHỖ khi kéo tay nắm `to`: cùng <svg>, đầu cuối đổi theo", () => {
    const root = render(makeState());
    const svg = fullDiagram(root);
    const toHandle = findAll(
      root,
      (node) =>
        node.tagName === "input" &&
        node.attrs.type === "range" &&
        (node.attrs.class ?? node.className).split(/\s+/).includes("hour-range-handle") &&
        node.dataset.handle === "to",
    )[0];
    expect(toHandle, "thiếu tay nắm `to`").toBeDefined();

    const beforeEnd = Number(svg.attrs["data-sun-azimuth-end"]);
    const beforeArcEnd = Number(byClass(svg, "cd-sun-arc")[0].attrs["data-sun-arc-end"]);

    // Kéo `to` từ 18:00 lên 19:00.
    toHandle.listeners.input({ target: { value: "19" } });

    const afterSvg = fullDiagram(root);
    const afterArc = byClass(afterSvg, "cd-sun-arc")[0];
    const afterEnd = Number(afterSvg.attrs["data-sun-azimuth-end"]);
    const afterArcEnd = Number(afterArc.attrs["data-sun-arc-end"]);
    const expectedNewEnd = sunAt("2026-06-21T19:00");

    console.log(
      `[court-sun] in-place: end az ${beforeEnd.toFixed(2)}° -> ${afterEnd.toFixed(2)}°; ` +
        `arc end ${beforeArcEnd.toFixed(2)}° -> ${afterArcEnd.toFixed(2)}°`,
    );

    // CÙNG một node <svg> => không render lại app, chỉ vẽ lại phần mặt trời.
    expect(afterSvg, "svg phải giữ nguyên danh tính (không full re-render)").toBe(svg);
    expect(afterEnd).not.toBe(beforeEnd);
    expect(afterArcEnd).not.toBe(beforeArcEnd);
    expect(angleDelta(afterEnd, expectedNewEnd.azimuth)).toBeLessThanOrEqual(2);
    // Nhãn giờ cuối cũng đổi theo, và vẫn còn đủ hai mặt trời.
    expect([...byClass(afterSvg, "cd-sun-hour").map((node) => node.textContent)].sort()).toEqual([
      "16:00",
      "19:00",
    ]);
  });

  it("(2.4) bản compact không còn chữ trang trí: 0 <text>, vẫn đủ hai mặt trời + cung tăng dần", () => {
    const start = sunAt(FROM);
    const end = sunAt(TO);
    const svg = courtDiagram({
      bearing: 0,
      sun: { azimuth: (start.azimuth + end.azimuth) / 2, elevation: 30 },
      sunRange: {
        start: { azimuth: start.azimuth, elevation: start.elevation, label: "16:00" },
        end: { azimuth: end.azimuth, elevation: end.elevation, label: "18:00" },
      },
      isDay: true,
      variant: "compact",
      ariaLabel: "compact range",
      northLabel: "B",
    }) as unknown as FakeNode;

    // F: bản compact BỎ HẲN chữ trang trí — ở ô 64px chữ 10–11px chỉ còn ~1.8–2.0px.
    expect(svg.attrs["data-variant"]).toBe("compact");
    expect(findAll(svg, (node) => node.tagName === "text").length, "compact phải có 0 <text>").toBe(0);
    expect(byClass(svg, "cd-north").length).toBe(0);
    expect(byClass(svg, "cd-sun-hour").length).toBe(0);

    // Không hề bỏ sót hình: vẫn đủ hai lõi mặt trời, một cung, đầu mũi tên.
    expect(byClass(svg, "cd-sun-core").length).toBe(2);
    expect(byClass(svg, "cd-sun-arc").length).toBe(1);
    expect(byClass(svg, "cd-sun-arc-head").length).toBe(1);
    const sweep =
      (((Number(byClass(svg, "cd-sun-arc")[0].attrs["data-sun-arc-end"]) -
        Number(byClass(svg, "cd-sun-arc")[0].attrs["data-sun-arc-start"])) %
        360) +
        360) %
      360;
    expect(sweep, "cung compact phải tăng dần").toBeGreaterThan(0);
    expect(sweep).toBeLessThan(360);
  });
});
