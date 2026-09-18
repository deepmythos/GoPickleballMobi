import { beforeEach, describe, expect, it } from "vitest";
import type { ForecastData } from "../api";
import { evaluate } from "../evaluate";
import { t } from "../i18n";
import type { HourlyPoint } from "../types";
import { windowSpanHours } from "../window";
import { renderApp } from "./render";
import { initialSheetState, sheetReducer } from "./sheet";

/**
 * Hợp đồng của card GPM-COLLAPSE-1:
 *   A) khối NGÀY/GIỜ + HƯỚNG SÂN gộp thành MỘT <details data-collapse="timecourt">, mặc định gấp,
 *      dòng tóm tắt tự đổi TẠI CHỖ khi kéo tay nắm / thanh bearing (không render lại app);
 *   B) khối ĐỊA ĐIỂM thành khối gấp trong trang, điều khiển nằm trong nội dung mở rộng;
 *   C) KHÔNG còn route popup/sheet cho địa điểm;
 *   D) trạng thái gấp/mở đi qua state.blocksOpen nên sống sót qua re-render.
 *
 * Test chạy trên DOM giả cùng phong cách src/ui/main-blocks.test.ts; listener được ghi lại để
 * dispatch sự kiện "input"/"toggle" thật, và `closest()` được mô phỏng để kiểm tra chuỗi cha.
 */

const FROM = "2026-06-21T16:00";
const TO = "2026-06-21T18:00";
const LOC = { lat: 49.9960846, lon: 8.7605459 };
const LANGS = ["vi", "de", "en"] as const;

type AppState = Parameters<typeof renderApp>[1];
type Actions = Parameters<typeof renderApp>[2];

// ---------------------------------------------------------------- DOM tối giản

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attrs: Record<string, string> = {};
  readonly listeners: Record<string, ((event: unknown) => void)[]> = {};
  parentElement: FakeNode | null = null;
  className = "";
  dataset: Record<string, string> = {};
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

  hasAttribute(name: string): boolean {
    return name in this.attrs;
  }

  removeAttribute(name: string): void {
    delete this.attrs[name];
  }

  /** `closest()` tối giản: test chỉ cần selector `details[data-collapse]`. */
  closest(selector: string): FakeNode | null {
    const detailsCollapse = selector === "details[data-collapse]";
    let node: FakeNode | null = this;
    while (node) {
      if (
        detailsCollapse &&
        node.tagName.toLowerCase() === "details" &&
        node.dataset.collapse !== undefined
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
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

function classesOf(node: FakeNode): string[] {
  return (node.attrs.class ?? node.className).split(/\s+/).filter(Boolean);
}

function byClass(root: FakeNode, cls: string): FakeNode[] {
  return findAll(root, (node) => classesOf(node).includes(cls));
}

function byDataset(root: FakeNode, key: string, value: string): FakeNode[] {
  return findAll(root, (node) => node.dataset[key] === value);
}

function diagramVariant(root: FakeNode, variant: string): FakeNode[] {
  return findAll(
    root,
    (node) => classesOf(node).includes("court-diagram") && node.attrs["data-variant"] === variant,
  );
}

function picker(root: FakeNode): FakeNode {
  const hit = byClass(root, "hour-range")[0];
  if (!hit) throw new Error("thiếu .hour-range");
  return hit;
}

function rangeHandle(root: FakeNode, handle: "from" | "to"): FakeNode {
  const input = findAll(
    root,
    (node) =>
      node.tagName === "input" &&
      node.attrs.type === "range" &&
      classesOf(node).includes("hour-range-handle") &&
      node.dataset.handle === handle,
  )[0];
  if (!input) throw new Error(`thiếu tay nắm ${handle}`);
  return input;
}

function hasAncestorClass(node: FakeNode, cls: string): boolean {
  let current: FakeNode | null = node.parentElement;
  while (current) {
    if (classesOf(current).includes(cls)) return true;
    current = current.parentElement;
  }
  return false;
}

/** Mô phỏng cơ chế gốc của <details>: đổi thuộc tính `open` rồi phát sự kiện `toggle`. */
function toggleDetails(details: FakeNode, open: boolean): void {
  if (open) details.setAttribute("open", "");
  else details.removeAttribute("open");
  for (const handler of details.listeners.toggle ?? []) handler({ type: "toggle" });
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

const BASE_URLS = {
  forecastBase: "https://api.open-meteo.com",
  airQualityBase: "https://air-quality-api.open-meteo.com",
  geocodingBase: "https://geocoding-api.open-meteo.com",
};

function makeState(overrides: Partial<AppState> = {}): AppState {
  const location = { lat: LOC.lat, lon: LOC.lon, name: "Test court" };
  return {
    lang: "vi",
    location,
    targetHour: FROM,
    toHour: TO,
    nowLocal: "2026-06-21T15:37",
    courtBearing: 0,
    lights: false,
    baseUrls: BASE_URLS,
    status: "ready",
    evaluation: evaluate({
      location,
      forecast: makeForecast(),
      air: null,
      targetHour: FROM,
      toHour: TO,
      courtBearing: 0,
      lights: false,
      baseUrls: BASE_URLS,
      fetchedAt: "2026-06-21T15:00:00Z",
    }),
    error: null,
    stale: false,
    forecast: null,
    air: null,
    fetchedAt: null,
    fetching: false,
    sheet: initialSheetState,
    rawOpen: false,
    blocksOpen: { timecourt: false, location: false },
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
    ...overrides,
  };
}

function render(state: AppState): FakeNode {
  const root = new FakeNode("div");
  renderApp(root as unknown as HTMLElement, state, {} as Actions);
  return root;
}

const TIME_COURT_SUMMARY: Record<(typeof LANGS)[number], string> = {
  vi: "16:00 – 18:00 · 2 giờ · Bắc–Nam · 0°",
  de: "16:00 – 18:00 · 2 Std. · Norden–Süden · 0°",
  en: "16:00 – 18:00 · 2 h · north–south · 0°",
};

const TIME_COURT_PARTS: Record<(typeof LANGS)[number], { span: string; axis: string }> = {
  vi: { span: "16:00 – 18:00 · 2 giờ", axis: "Bắc–Nam · 0°" },
  de: { span: "16:00 – 18:00 · 2 Std.", axis: "Norden–Süden · 0°" },
  en: { span: "16:00 – 18:00 · 2 h", axis: "north–south · 0°" },
};

describe("A — khối gộp Ngày/giờ + Hướng sân", () => {
  it("(a) đúng MỘT details[data-collapse] chứa cả picker lẫn hình full; toàn tài liệu một .hour-range + một hình full", () => {
    for (const lang of LANGS) {
      const root = render(makeState({ lang }));
      const detailsList = findAll(
        root,
        (node) => node.tagName === "details" && node.dataset.collapse === "timecourt",
      );
      expect(detailsList.length, `${lang}: phải có đúng MỘT details[data-collapse=timecourt]`).toBe(1);
      const details = detailsList[0];
      expect(details.dataset.collapse).toBe("timecourt");
      expect(byClass(root, "hour-range").length, `${lang}: chỉ một .hour-range toàn tài liệu`).toBe(1);
      const fullDiagrams = diagramVariant(root, "full");
      expect(fullDiagrams.length, `${lang}: chỉ một hình full toàn tài liệu`).toBe(1);

      // Chuỗi cha: cả picker lẫn hình full cùng thuộc MỘT <details data-collapse>.
      const pickerDetails = picker(root).closest("details[data-collapse]");
      const diagramDetails = fullDiagrams[0].closest("details[data-collapse]");
      expect(pickerDetails, `${lang}: picker không nằm trong details gấp`).not.toBeNull();
      expect(diagramDetails, `${lang}: hình full không nằm trong details gấp`).not.toBeNull();
      expect(diagramDetails, `${lang}: picker và hình full khác details`).toBe(pickerDetails);
      expect(pickerDetails).toBe(details);
    }
  });

  it("(b) mặc định GẤP: không có thuộc tính open, summary aria-expanded=false, nội dung nằm trong details đóng", () => {
    for (const lang of LANGS) {
      const root = render(makeState({ lang }));
      const details = findAll(root, (n) => n.tagName === "details" && n.dataset.collapse === "timecourt")[0];
      expect(details, `${lang}: thiếu details timecourt`).toBeDefined();
      expect(details.hasAttribute("open"), `${lang}: mặc định phải GẤP`).toBe(false);
      const summary = byClass(details, "collapse-summary")[0];
      expect(summary, `${lang}: thiếu .collapse-summary`).toBeDefined();
      expect(summary.getAttribute("aria-expanded"), `${lang}: aria-expanded sai`).toBe("false");
      expect(byClass(summary, "collapse-span").length, `${lang}: thiếu .collapse-span`).toBe(1);
      expect(byClass(summary, "collapse-axis").length, `${lang}: thiếu .collapse-axis`).toBe(1);
      // Nội dung (picker + hình) nằm BÊN TRONG details vừa đóng.
      const body = byClass(details, "collapse-body")[0];
      expect(body, `${lang}: thiếu .collapse-body`).toBeDefined();
      expect(byClass(body, "hour-range").length).toBe(1);
      expect(diagramVariant(body, "full").length).toBe(1);
    }
  });

  it("(b2) dòng tóm tắt mặc định khớp ĐÚNG chuỗi hợp đồng ở cả ba ngôn ngữ", () => {
    for (const lang of LANGS) {
      const root = render(makeState({ lang }));
      const details = findAll(root, (n) => n.tagName === "details" && n.dataset.collapse === "timecourt")[0];
      const summary = byClass(details, "collapse-summary")[0];
      expect(summary.textContent, `${lang}: tóm tắt sai`).toBe(TIME_COURT_SUMMARY[lang]);
      // Hai mảnh cũng đứng riêng đúng như hợp đồng.
      expect(byClass(summary, "collapse-span")[0].textContent, `${lang}: mảnh khoảng giờ`).toBe(
        TIME_COURT_PARTS[lang].span,
      );
      expect(byClass(summary, "collapse-axis")[0].textContent, `${lang}: mảnh trục sân`).toBe(
        TIME_COURT_PARTS[lang].axis,
      );
    }
  });

  it("(b3) khi state.blocksOpen.timecourt = true thì render lại gắn `open` + aria-expanded=true", () => {
    const root = render(makeState({ blocksOpen: { timecourt: true, location: false } }));
    const details = findAll(root, (n) => n.tagName === "details" && n.dataset.collapse === "timecourt")[0];
    expect(details.hasAttribute("open")).toBe(true);
    expect(byClass(details, "collapse-summary")[0].getAttribute("aria-expanded")).toBe("true");
  });

  it("(d) chu trình gấp → mở → gấp chỉ đổi blocksOpen, mọi giá trị khác giữ nguyên", () => {
    const state = makeState();
    const root = render(state);
    const details = findAll(root, (n) => n.tagName === "details" && n.dataset.collapse === "timecourt")[0];
    const summary = byClass(details, "collapse-summary")[0];

    const before = {
      from: state.targetHour,
      to: state.toHour,
      bearing: state.courtBearing,
      location: { ...state.location },
      verdict: state.evaluation?.verdict,
    };

    toggleDetails(details, true);
    expect(state.blocksOpen.timecourt, "mở phải ghi state = true").toBe(true);
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    toggleDetails(details, false);
    expect(state.blocksOpen.timecourt, "gấp lại phải ghi state = false").toBe(false);
    expect(summary.getAttribute("aria-expanded")).toBe("false");

    expect(state.targetHour).toBe(before.from);
    expect(state.toHour).toBe(before.to);
    expect(state.courtBearing).toBe(before.bearing);
    expect(state.location).toEqual(before.location);
    expect(state.evaluation?.verdict).toBe(before.verdict);
  });

  it("(e) khi GẤP, dispatch `input` ở tay nắm `from` cập nhật mảnh tóm tắt VÀ aria-label hình ngay tại chỗ", () => {
    const state = makeState();
    const root = render(state);
    const details = findAll(root, (n) => n.tagName === "details" && n.dataset.collapse === "timecourt")[0];
    expect(details.hasAttribute("open"), "ca này phải chạy lúc khối đang GẤP").toBe(false);

    const spanBefore = byClass(root, "collapse-span")[0].textContent;
    const svgBefore = diagramVariant(root, "full")[0];
    const labelBefore = svgBefore.getAttribute("aria-label");
    const evaluationBefore = state.evaluation;

    // Kéo `from` từ 16:00 xuống 15:00 (cửa sổ thành 3 giờ) — KHÔNG gọi render().
    rangeHandle(root, "from").listeners.input[0]({ target: { value: "15" } });

    const spanAfter = byClass(root, "collapse-span")[0].textContent;
    const svgAfter = diagramVariant(root, "full")[0];
    const labelAfter = svgAfter.getAttribute("aria-label");

    expect(spanAfter, "mảnh khoảng giờ của tóm tắt phải đổi").not.toBe(spanBefore);
    expect(spanAfter).toBe(t("vi", "time.span", { from: "15:00", to: "18:00", hours: "3" }));
    expect(labelAfter, "aria-label hình full phải đổi theo").not.toBe(labelBefore);
    expect(labelAfter).toContain("15:00");
    // CÙNG node <svg> => cập nhật tại chỗ, không render lại app.
    expect(svgAfter, "svg phải giữ nguyên danh tính").toBe(svgBefore);
    expect(state.evaluation, "evaluation không bị đụng tới khi chỉ kéo xem trước").toBe(evaluationBefore);
    // Trạng thái gấp không đổi.
    expect(details.hasAttribute("open")).toBe(false);
  });

  it("(e2) kéo thanh bearing khi GẤP cập nhật mảnh trục sân của tóm tắt tại chỗ", () => {
    const root = render(makeState());
    const axisBefore = byClass(root, "collapse-axis")[0].textContent;
    const bearingSlider = findAll(
      root,
      (n) => n.tagName === "input" && n.attrs.type === "range" && !classesOf(n).includes("hour-range-handle"),
    )[0];
    expect(bearingSlider, "thiếu thanh trượt bearing").toBeDefined();
    bearingSlider.listeners.input[0]({ target: { value: "90" } });
    const axisAfter = byClass(root, "collapse-axis")[0].textContent;
    expect(axisAfter).not.toBe(axisBefore);
    expect(axisAfter).toBe(t("vi", "court.axis", { dir: "Đông–Tây", deg: "90" }));
  });
});

describe("B + C — khối Địa điểm trong trang, không còn popup/sheet", () => {
  it("(c1) KHÔNG còn [data-sheet-opener=location] hay route sheet địa điểm", () => {
    const inputsSheet = sheetReducer(initialSheetState, { type: "open", panel: "inputs" });
    const root = render(makeState({ sheet: inputsSheet }));
    expect(byDataset(root, "sheetOpener", "location").length, "còn nút mở sheet vị trí").toBe(0);
    // Không panel location nào được dựng: tiêu đề sheet vẫn là "Cài đặt".
    const sheet = byClass(root, "sheet")[0];
    expect(sheet, "thiếu .sheet").toBeDefined();
    expect(byClass(sheet, "sheet-title")[0].textContent).toBe(t("vi", "sheet.title"));
  });

  it("(c2) sheet Cài đặt KHÔNG chứa điều khiển địa điểm nào", () => {
    const inputsSheet = sheetReducer(initialSheetState, { type: "open", panel: "inputs" });
    const root = render(makeState({ sheet: inputsSheet }));
    const sheet = byClass(root, "sheet")[0];
    expect(byClass(sheet, "search-row").length, "sheet còn ô tìm địa điểm").toBe(0);
    expect(byClass(sheet, "infobar-body").length, "sheet còn thân khối địa điểm").toBe(0);
    expect(sheet.textContent).not.toContain(t("vi", "location.useMyLocation"));
    expect(sheet.textContent).not.toContain(t("vi", "location.apply"));
  });

  it("(c3) điều khiển địa điểm nằm trong nội dung MỞ RỘNG của khối trong trang, không trong sheet", () => {
    for (const lang of LANGS) {
      const root = render(
        makeState({ lang, blocksOpen: { timecourt: false, location: true } }),
      );
      const bar = byClass(root, "infobar")[0];
      expect(bar, `${lang}: thiếu .infobar`).toBeDefined();
      expect(bar.dataset.block, `${lang}: khối địa điểm phải có data-block=location`).toBe("location");
      const body = byClass(bar, "infobar-body")[0];
      expect(body, `${lang}: thiếu .infobar-body`).toBeDefined();
      // Ô tìm kiếm + nút "dùng vị trí của tôi" + nút "áp dụng" đều nằm TRONG khối trong trang.
      expect(
        findAll(body, (n) => n.tagName === "input" && n.attrs.type === "search").length,
        `${lang}: thiếu ô tìm kiếm trong khối`,
      ).toBe(1);
      const buttons = findAll(body, (n) => n.tagName === "button").map((n) => n.textContent);
      expect(buttons, `${lang}: thiếu nút dùng vị trí của tôi`).toContain(t(lang, "location.useMyLocation"));
      expect(buttons, `${lang}: thiếu nút áp dụng`).toContain(t(lang, "location.apply"));
      // Và KHÔNG nằm trong bất kỳ sheet nào.
      expect(hasAncestorClass(body, "sheet"), `${lang}: điều khiển địa điểm lọt vào sheet`).toBe(false);
      expect(hasAncestorClass(body, "sheet-backdrop"), `${lang}: điều khiển địa điểm lọt vào sheet`).toBe(false);
    }
  });

  it("(b4) khối địa điểm cũng mặc định gấp và giữ đúng 4 trường tóm tắt", () => {
    const root = render(makeState());
    const details = findAll(root, (n) => n.tagName === "details" && n.dataset.collapse === "location")[0];
    expect(details, "thiếu details location").toBeDefined();
    expect(details.hasAttribute("open")).toBe(false);
    const summary = byClass(details, "collapse-summary")[0];
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    for (const cls of ["infobar-loc-name", "infobar-coords", "infobar-time-value", "infobar-offset"]) {
      expect(byClass(summary, cls).length, `thiếu .${cls}`).toBe(1);
    }
    // Không còn <button> lồng trong <summary>.
    expect(findAll(summary, (n) => n.tagName === "button").length).toBe(0);
  });

  it("(d2) chu trình gấp/mở khối địa điểm chỉ đổi blocksOpen.location", () => {
    const state = makeState();
    const root = render(state);
    const details = findAll(root, (n) => n.tagName === "details" && n.dataset.collapse === "location")[0];
    const locationBefore = { ...state.location };
    toggleDetails(details, true);
    expect(state.blocksOpen.location).toBe(true);
    toggleDetails(details, false);
    expect(state.blocksOpen.location).toBe(false);
    expect(state.location).toEqual(locationBefore);
  });

  it("(F) khoảng mặc định vẫn là 2 giờ và picker vẫn nằm trong khối gộp", () => {
    const state = makeState();
    const root = render(state);
    expect(windowSpanHours(FROM, TO)).toBe(2);
    expect(picker(root).dataset.spanHours).toBe("2");
  });
});
