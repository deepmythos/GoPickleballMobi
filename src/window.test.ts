import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { dictionaries, t } from "./i18n";
import { classify } from "./scoring";
import type { HourlyPoint } from "./types";
import type { Actions, AppState } from "./ui/state";
import { renderApp } from "./ui/render";
import { initialSheetState, sheetReducer } from "./ui/sheet";
import type { Evaluation } from "./evaluate";
import {
  aggregateWindow,
  DEFAULT_SPAN_HOURS,
  defaultWindow,
  MAX_WINDOW_SPAN_HOURS,
  midpointHourOf,
  windowFromParams,
  windowHours,
  windowSpanHours,
  type HourScore,
  type WindowRange,
} from "./window";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readText(...segments: string[]): string {
  return readFileSync(resolve(root, ...segments), "utf8");
}

// ---------------------------------------------------------------- DOM tối giản

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attrs: Record<string, string> = {};
  readonly listeners: Record<string, ((event: unknown) => void)[]> = {};
  className = "";
  dataset: Record<string, string> = {};
  parentElement: FakeNode | null = null;
  private ownText = "";

  constructor(readonly tagName: string) {}

  appendChild(child: FakeNode): FakeNode {
    this.children.push(child);
    child.parentElement = this;
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
  // appendChildren() phân biệt Node với chuỗi bằng `instanceof Node`.
  (globalThis as unknown as { Node: unknown }).Node = FakeNode;
});

function findAll(node: FakeNode, predicate: (entry: FakeNode) => boolean): FakeNode[] {
  const found: FakeNode[] = [];
  const walk = (entry: FakeNode): void => {
    if (predicate(entry)) found.push(entry);
    entry.children.forEach(walk);
  };
  walk(node);
  return found;
}

function byClass(node: FakeNode, cls: string): FakeNode[] {
  return findAll(node, (entry) => entry.className.split(/\s+/).includes(cls));
}

// ------------------------------------------------------------------ fixtures

const TARGET = "2026-06-21T16:00";
const TO = "2026-06-21T18:00";

function hourScore(hour: string, score: number): HourScore {
  return { hour, score, verdict: classify(score) };
}

/** Cửa sổ 16:00–18:00 với điểm 55/62/68 -> mean 62 (làm tròn 61,67). */
function makeRange(): WindowRange {
  return aggregateWindow(TARGET, TO, [
    hourScore("2026-06-21T16:00", 55),
    hourScore("2026-06-21T17:00", 62),
    hourScore("2026-06-21T18:00", 68),
  ]);
}

function makePoint(): HourlyPoint {
  return {
    time: "2026-06-21T17:00",
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

function makeEvaluation(): Evaluation {
  const range = makeRange();
  return {
    targetHour: TARGET,
    utcOffsetMinutes: 120,
    localTime: range.midpointHour,
    detailHour: range.midpointHour,
    point: makePoint(),
    sun: { azimuth: 180, elevation: 40 },
    sunStart: { azimuth: 170, elevation: 42 },
    sunEnd: { azimuth: 190, elevation: 38 },
    score: range.score ?? 0,
    verdict: range.verdict ?? "Cân nhắc",
    range,
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
    dataSource: { forecastBase: "https://api.open-meteo.com", fetchedAt: "2026-06-21T15:00" },
  };
}

function openInputs(): AppState["sheet"] {
  return sheetReducer(initialSheetState, { type: "open", panel: "inputs" });
}

function state(overrides: Partial<AppState> = {}): AppState {
  const location = { lat: 49.9960846, lon: 8.7605459, name: "Test court" };
  return {
    lang: "vi",
    location,
    targetHour: TARGET,
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
    evaluation: makeEvaluation(),
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
    atInput: TARGET,
    toInput: TO,
    applyErrorKey: null,
    theme: "system",
    offline: false,
    update: { available: false, dismissed: false },
    updateCheck: { status: "idle" },
    ...overrides,
  };
}

function render(s: AppState): FakeNode {
  const node = new FakeNode("div");
  renderApp(node as unknown as HTMLElement, s, {} as Actions);
  return node;
}

// ---------------------------------------------------------------- CSS parsing

const css = readText("src", "styles.css");

function rule(selector: string): string {
  return css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*\\}`))?.[0] ?? "";
}

function pixels(block: string, property: string): number {
  const m = block.match(new RegExp(`${property}\\s*:\\s*(\\d+)px`));
  return m ? Number(m[1]) : 0;
}

// --------------------------------------------------------------------- tests

describe("window — cửa sổ giờ và trung bình cộng", () => {
  it("(a) cửa sổ mặc định là 2 giờ và gồm span+1 = 3 bucket", () => {
    expect(defaultWindow("2026-06-21T15:37")).toEqual({
      from: "2026-06-21T16:00",
      to: "2026-06-21T18:00",
    });
    expect(DEFAULT_SPAN_HOURS).toBe(2);
    expect(windowSpanHours("2026-06-21T16:00", "2026-06-21T18:00")).toBe(DEFAULT_SPAN_HOURS);

    const hours = windowHours("2026-06-21T16:00", "2026-06-21T18:00");
    expect(hours).toEqual(["2026-06-21T16:00", "2026-06-21T17:00", "2026-06-21T18:00"]);
    expect(hours.length).toBe(3);
    expect(midpointHourOf("2026-06-21T16:00", "2026-06-21T18:00")).toBe("2026-06-21T17:00");
  });

  it("(a2) windowHours vượt nửa đêm sang ngày kế tiếp", () => {
    expect(windowHours("2026-06-21T22:00", "2026-06-22T01:00")).toEqual([
      "2026-06-21T22:00",
      "2026-06-21T23:00",
      "2026-06-22T00:00",
      "2026-06-22T01:00",
    ]);
    expect(midpointHourOf("2026-06-21T22:00", "2026-06-22T02:00")).toBe("2026-06-22T00:00");
  });

  it("(b) điểm cửa sổ là TRUNG BÌNH CỘNG, không phải giờ xấu nhất/min/max", () => {
    const perHour = [hourScore("2026-06-21T16:00", 80), hourScore("2026-06-21T17:00", 40), hourScore("2026-06-21T18:00", 90)];
    const range = aggregateWindow(TARGET, TO, perHour);
    const raw = perHour.map((entry) => entry.score);
    // Bằng chứng để dán lại: 80,40,90 -> mean 70.
    console.log(`[window] raw per-hour scores = ${raw.join(", ")}; arithmetic mean = ${range.score}`);

    expect(range.score).toBe(70);
    expect(range.verdict).toBe(classify(70));
    expect(range.score).not.toBe(40);
    expect(range.score).not.toBe(Math.min(...raw));
    expect(range.score).not.toBe(Math.max(...raw));
    expect(range.countedHours).toBe(3);
    expect(range.missingHours).toEqual([]);
  });

  it("(b2) một giờ tốt 60 + một giờ xấu 20 => mean 40, KHÔNG phải 20", () => {
    const perHour = [hourScore("2026-06-21T16:00", 60), hourScore("2026-06-21T17:00", 20)];
    const range = aggregateWindow("2026-06-21T16:00", "2026-06-21T17:00", perHour);
    console.log(`[window] good 60 + bad 20 -> mean = ${range.score} (never the bad hour 20)`);
    expect(range.score).toBe(40);
    expect(range.score).not.toBe(20);
    expect(range.verdict).toBe(classify(40));
  });

  it("(b3) giờ thiếu dữ liệu bị LOẠI khỏi mean (không quy về 0)", () => {
    const range = aggregateWindow(TARGET, TO, [
      hourScore("2026-06-21T16:00", 80),
      hourScore("2026-06-21T18:00", 20),
    ]);
    expect(range.score).toBe(50);
    expect(range.countedHours).toBe(2);
    expect(range.missingHours).toEqual(["2026-06-21T17:00"]);
  });

  it("(b4) không giờ nào có dữ liệu => score null và verdict null", () => {
    const range = aggregateWindow(TARGET, TO, []);
    expect(range.score).toBeNull();
    expect(range.verdict).toBeNull();
    expect(range.countedHours).toBe(0);
    expect(range.missingHours.length).toBe(3);
  });

  it("(c) ?at giữ nguyên hành vi cũ: cửa sổ suy biến một bucket", () => {
    const now = "2026-06-21T15:37";
    const legacy = windowFromParams(new URLSearchParams("at=2026-06-21T16:00"), now);
    expect(legacy).toEqual({ from: "2026-06-21T16:00", to: "2026-06-21T16:00", source: "at" });
    expect(windowSpanHours(legacy.from, legacy.to)).toBe(0);
    expect(windowHours(legacy.from, legacy.to)).toEqual(["2026-06-21T16:00"]);

    const ranged = windowFromParams(
      new URLSearchParams("from=2026-06-21T16:00&to=2026-06-21T18:00"),
      now,
    );
    expect(ranged).toEqual({ from: "2026-06-21T16:00", to: "2026-06-21T18:00", source: "range" });

    const fallback = windowFromParams(new URLSearchParams(""), now);
    expect(fallback.source).toBe("default");
    expect(fallback.from).toBe("2026-06-21T16:00");
    expect(windowSpanHours(fallback.from, fallback.to)).toBe(DEFAULT_SPAN_HOURS);
  });

  it("(d) bộ chọn khoảng: đúng hai tay nắm 44px, caption khoảng + điểm, không còn 'giờ kế tiếp'", () => {
    const tree = render(state());

    const handles = findAll(
      tree,
      (entry) =>
        entry.tagName === "input" &&
        entry.attrs.type === "range" &&
        entry.className.split(/\s+/).includes("hour-range-handle"),
    );
    expect(handles.length).toBe(2);

    const fromHandle = handles.find((entry) => entry.dataset.handle === "from");
    const toHandle = handles.find((entry) => entry.dataset.handle === "to");
    expect(fromHandle, "thiếu tay nắm from").toBeDefined();
    expect(toHandle, "thiếu tay nắm to").toBeDefined();
    for (const handle of handles) {
      expect(handle.attrs.min).toBe("0");
      expect(handle.attrs.max).toBe("24");
      expect(handle.attrs.step).toBe("1");
      expect(handle.attrs["aria-valuetext"]).toMatch(/^\d{2}:00$/);
    }
    expect(fromHandle!.attrs["aria-label"]).toBe(t("vi", "time.from"));
    expect(toHandle!.attrs["aria-label"]).toBe(t("vi", "time.to"));
    expect(fromHandle!.attrs.value).toBe("16");
    expect(toHandle!.attrs.value).toBe("18");

    // Ngày của cửa sổ (from) nằm trong input[type=date].input.
    const dateInputs = findAll(
      tree,
      (entry) => entry.tagName === "input" && entry.attrs.type === "date" && entry.className.split(/\s+/).includes("input"),
    );
    expect(dateInputs.length).toBe(1);
    expect(dateInputs[0].attrs.value).toBe("2026-06-21");

    const container = byClass(tree, "hour-range")[0];
    expect(container, "thiếu .hour-range").toBeDefined();
    expect(container.dataset.fromHour).toBe("16");
    expect(container.dataset.toHour).toBe("18");
    expect(container.dataset.spanHours).toBe("2");

    const values = byClass(tree, "hour-range-value").map((entry) => entry.textContent);
    expect(values).toEqual(["16:00", "18:00"]);

    const span = byClass(tree, "hour-range-span")[0];
    expect(span, "thiếu .hour-range-span").toBeDefined();
    expect(span.textContent).toBe(t("vi", "time.span", { from: "16:00", to: "18:00", hours: "2" }));

    const score = byClass(tree, "hour-range-score")[0];
    expect(score, "thiếu .hour-range-score").toBeDefined();
    expect(score.textContent).toBe(
      t("vi", "time.rangeScore", { score: "62", verdict: t("vi", "verdict.maybe") }),
    );

    // Không còn điều khiển "giờ kế tiếp".
    const nextHourActions = findAll(tree, (entry) => entry.dataset.action === "next-hour");
    expect(nextHourActions).toEqual([]);
    const legacyStrings = ["giờ kế tiếp", "Giờ kế tiếp", "Next hour", "Nächste Stunde"];
    for (const button of findAll(tree, (entry) => entry.tagName === "button")) {
      for (const literal of legacyStrings) {
        expect(button.textContent).not.toContain(literal);
      }
    }
    for (const lang of ["vi", "de", "en"] as const) {
      const dict = dictionaries[lang] as Record<string, string | undefined>;
      expect(dict["time.nextHour"], `${lang} vẫn còn khoá time.nextHour`).toBeUndefined();
    }

    // Tay nắm >= 44x44 px cho CẢ hai engine theo rules trong src/styles.css.
    const handleRule = rule(".hour-range-handle");
    expect(pixels(handleRule, "height")).toBeGreaterThanOrEqual(44);
    const webkitThumb = rule(".hour-range-handle::-webkit-slider-thumb");
    const mozThumb = rule(".hour-range-handle::-moz-range-thumb");
    expect(pixels(webkitThumb, "width")).toBeGreaterThanOrEqual(44);
    expect(pixels(webkitThumb, "height")).toBeGreaterThanOrEqual(44);
    expect(pixels(mozThumb, "width")).toBeGreaterThanOrEqual(44);
    expect(pixels(mozThumb, "height")).toBeGreaterThanOrEqual(44);
  });

  it("(d2) oninput cập nhật nhãn/caption tại chỗ, onchange chốt qua setHourRange", () => {
    const calls: { from: string; to: string }[] = [];
    const actions = {
      setHourRange: (from: string, to: string) => calls.push({ from, to }),
    } as unknown as Actions;

    const node = new FakeNode("div");
    renderApp(node as unknown as HTMLElement, state(), actions);

    const handles = findAll(
      node,
      (entry) =>
        entry.tagName === "input" &&
        entry.attrs.type === "range" &&
        entry.className.split(/\s+/).includes("hour-range-handle"),
    );
    const fromHandle = handles.find((entry) => entry.dataset.handle === "from")!;
    const toHandle = handles.find((entry) => entry.dataset.handle === "to")!;

    // kéo tay nắm "to" xuống 19 -> nhãn đổi tại chỗ, caption span đổi theo
    toHandle.listeners.input[0]({ target: { value: "19" } });
    expect(byClass(node, "hour-range-value").map((entry) => entry.textContent)).toEqual([
      "16:00",
      "19:00",
    ]);
    expect(byClass(node, "hour-range-span")[0].textContent).toBe(
      t("vi", "time.span", { from: "16:00", to: "19:00", hours: "3" }),
    );
    expect(toHandle.attrs["aria-valuetext"]).toBe("19:00");

    // nhả tay -> setHourRange(from, to) với đúng cửa sổ đã chọn
    toHandle.listeners.change[0]({ target: { value: "19" } });
    expect(calls).toEqual([{ from: "2026-06-21T16:00", to: "2026-06-21T19:00" }]);

    // tay nắm "from" không được vượt qua "to"
    fromHandle.listeners.input[0]({ target: { value: "20" } });
    expect(byClass(node, "hour-range-value").map((entry) => entry.textContent)).toEqual([
      "20:00",
      "20:00",
    ]);
  });
});

describe("window — hardening biên (R1/R2)", () => {
  it("R1: windowHours bị chặn trần, không sinh hàng triệu mốc giờ", () => {
    const hours = windowHours("2026-09-18T00:00", "9999-12-31T00:00");
    console.log(`[window] clamped span -> ${hours.length} entries (cap ${MAX_WINDOW_SPAN_HOURS + 1})`);
    expect(MAX_WINDOW_SPAN_HOURS).toBe(24);
    expect(hours.length).toBeLessThanOrEqual(MAX_WINDOW_SPAN_HOURS + 1);
    expect(hours.length).toBe(MAX_WINDOW_SPAN_HOURS + 1);
    expect(hours[0]).toBe("2026-09-18T00:00");
    expect(hours[hours.length - 1]).toBe("2026-09-19T00:00");
  });

  it("R1: aggregateWindow cũng chỉ xét tối đa MAX+1 mốc", () => {
    const range = aggregateWindow("2026-09-18T00:00", "9999-12-31T00:00", []);
    expect(range.hours.length + range.missingHours.length).toBeLessThanOrEqual(
      MAX_WINDOW_SPAN_HOURS + 1,
    );
  });

  it("R2: from/to sai định dạng rơi về mặc định, không tạo cửa sổ rác", () => {
    const now = "2026-09-18T13:37";
    const dateOnly = windowFromParams(new URLSearchParams("from=2026-09-18&to=2026-09-18"), now);
    expect(dateOnly).toEqual({ from: "2026-09-18T14:00", to: "2026-09-18T16:00", source: "default" });
    const garbage = windowFromParams(new URLSearchParams("from=abc&to=def"), now);
    expect(garbage.source).toBe("default");
    // Không bao giờ ném lỗi.
    expect(() => windowFromParams(new URLSearchParams("from=2026-09-18&to=abc"), now)).not.toThrow();
  });

  it("R2: from/to đảo ngược hoặc quá dài rơi về at rồi mặc định; precedence giữ nguyên", () => {
    const now = "2026-09-18T13:37";
    const reversed = windowFromParams(
      new URLSearchParams("from=2026-09-18T18:00&to=2026-09-18T16:00"),
      now,
    );
    expect(reversed.source).toBe("default");
    const tooLong = windowFromParams(
      new URLSearchParams("from=2026-09-18T00:00&to=2030-01-01T00:00"),
      now,
    );
    expect(tooLong.source).toBe("default");
    const withAt = windowFromParams(
      new URLSearchParams("from=abc&to=def&at=2026-09-18T16:00"),
      now,
    );
    expect(withAt).toEqual({ from: "2026-09-18T16:00", to: "2026-09-18T16:00", source: "at" });
    const rangeOK = windowFromParams(
      new URLSearchParams("from=2026-09-18T14:00&to=2026-09-18T16:00"),
      now,
    );
    expect(rangeOK).toEqual({ from: "2026-09-18T14:00", to: "2026-09-18T16:00", source: "range" });
  });
});
