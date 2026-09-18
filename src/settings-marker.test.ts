// Marker phiên bản trong sheet "Điều chỉnh" (src/ui/render.ts → renderInputsSheet).
//
// Trạng thái ĐỎ/XANH trước khi sửa (đo trên cây render cũ):
//   (a) marker có trong DOM (nằm CUỐI sheet) → XANH trước khi sửa (chỉ chứng minh có mặt, không chứng minh vị trí).
//   (b) phần tử đầu sau h2.sheet-title phải là setting-block chứa marker → ĐỎ (trước đây là khối giờ).
//   (c) chưa có nút data-build-check / kết quả kiểm tra → ĐỎ.
//   (d) 5 khoá i18n build.check* chưa tồn tại → ĐỎ.
//   (e) marker mang class sheet-note (12px, màu --muted) → ĐỎ.
// Sau khi sửa: cả 5 khẳng định XANH; (b) mới là điều kiện thật sự được kiểm (marker ở đầu sheet).
//
// Môi trường test là "node" nên phải tự dựng DOM tối giản. appendChildren() trong render.ts
// phân biệt element với text bằng `child instanceof Node`, nên Node/document phải được gán vào
// globalThis TRƯỚC khi module render được nạp — vì vậy phần import render là dynamic import.

import { describe, expect, it } from "vitest";
import { BUILD_ID, BUILD_TIME } from "./build";
import { dictionaries, formatDateTime, t, type MessageKey } from "./i18n";
import type { Actions, AppState } from "./ui/state";

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

  addEventListener(): void {
    /* render chỉ gắn callback; test này không mô phỏng sự kiện. */
  }

  get childNodes(): FakeNode[] {
    return this.children;
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

(globalThis as unknown as { Node: unknown }).Node = FakeNode;
(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => new FakeNode(tag),
  createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
  createTextNode: (text: string) => new FakeText(text),
};

// PHẢI đứng sau khi globalThis.Node/document đã sẵn sàng (xem ghi chú đầu file).
const { renderApp } = await import("./ui/render");

const actions = {} as Actions;

function baseState(overrides: Partial<AppState> = {}): AppState {
  const location = {
    lat: 49.9960846,
    lon: 8.7605459,
    name: "Pickleball-Plätze, Offenthaler Straße, Dietzenbach",
  };
  return {
    lang: "vi",
    location,
    targetHour: "2026-09-18T14:00",
    nowLocal: "2026-09-18T13:37",
    courtBearing: 0,
    lights: false,
    baseUrls: {
      forecastBase: "https://api.open-meteo.com",
      airQualityBase: "https://air-quality-api.open-meteo.com",
      geocodingBase: "https://geocoding-api.open-meteo.com",
    },
    status: "loading",
    evaluation: null,
    error: null,
    stale: false,
    forecast: null,
    air: null,
    fetchedAt: null,
    fetching: false,
    sheet: { panel: "inputs", dragging: false, dragOffsetPx: 0 },
    rawOpen: false,
    geoStatus: "idle",
    geoError: null,
    geoResults: [],
    searchQuery: "",
    draft: { ...location },
    atInput: "2026-09-18T14:00",
    applyErrorKey: null,
    theme: "system",
    offline: false,
    update: { available: false, dismissed: false },
    updateCheck: { status: "idle" },
    ...overrides,
  };
}

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
  return findAll(root, (node) => node.className.split(/\s+/).includes(cls));
}

function byDataset(root: FakeNode, key: string, value: string): FakeNode[] {
  return findAll(root, (node) => node.dataset[key] === value);
}

function render(state: AppState): FakeNode {
  const root = new FakeNode("div");
  renderApp(root as unknown as HTMLElement, state, actions);
  return root;
}

describe("sheet Điều chỉnh — mã phiên bản và kiểm tra cập nhật", () => {
  it("(a) marker chứa mã build VÀ thời điểm build", () => {
    const root = render(baseState());
    const marker = byClass(root, "build-marker")[0];
    expect(marker, "thiếu .build-marker").toBeDefined();
    const time = BUILD_TIME
      ? formatDateTime("vi", BUILD_TIME.slice(0, 16))
      : t("vi", "common.none");
    expect(marker.textContent).toBe(`${BUILD_ID} · ${t("vi", "build.builtAt", { time })}`);
    expect(marker.textContent).toContain(BUILD_ID);
    if (BUILD_TIME) expect(marker.textContent).toContain(time);
  });

  it("(b) khối phiên bản là setting-block ĐẦU TIÊN ngay sau h2.sheet-title", () => {
    const root = render(baseState());
    const sheet = byClass(root, "sheet")[0];
    expect(sheet, "thiếu .sheet").toBeDefined();
    const children = sheet.children;
    expect(children[0].className).toContain("sheet-title");
    const firstSettingBlock = children.find((child) =>
      child.className.split(/\s+/).includes("setting-block"),
    );
    expect(firstSettingBlock).toBe(children[1]);
    expect(byClass(children[1], "build-marker").length).toBe(1);
  });

  it("(c) đúng một nút data-build-check với nhãn từ điển", () => {
    const root = render(baseState());
    const sheet = byClass(root, "sheet")[0];
    const buttons = byDataset(sheet, "buildCheck", "1");
    expect(buttons.length).toBe(1);
    expect(buttons[0].tagName).toBe("button");
    expect(buttons[0].textContent).toBe(t("vi", "build.checkUpdate"));
  });

  it("(d) 5 khoá build.check* có đủ và đúng ở cả vi/de/en", () => {
    const keys: { key: MessageKey; vi: string; de: string; en: string }[] = [
      {
        key: "build.checkUpdate",
        vi: "Kiểm tra cập nhật",
        de: "Nach Update suchen",
        en: "Check for update",
      },
      {
        key: "build.checking",
        vi: "Đang kiểm tra…",
        de: "Prüfe auf Update…",
        en: "Checking for updates…",
      },
      {
        key: "build.upToDate",
        vi: "Đang là bản mới nhất",
        de: "Du hast die neueste Version",
        en: "You have the latest version",
      },
      {
        key: "build.checkUnsupported",
        vi: "Thiết bị này không hỗ trợ kiểm tra cập nhật",
        de: "Dieses Gerät unterstützt die Update-Prüfung nicht",
        en: "This device does not support update checks",
      },
      {
        key: "build.checkFailed",
        vi: "Không kiểm tra được — thử lại sau",
        de: "Prüfung fehlgeschlagen — später erneut versuchen",
        en: "Could not check — try again later",
      },
    ];
    for (const { key, vi, de, en } of keys) {
      expect(dictionaries.vi[key]).toBe(vi);
      expect(dictionaries.de[key]).toBe(de);
      expect(dictionaries.en[key]).toBe(en);
    }
  });

  it("(e) marker KHÔNG mang class sheet-note (đủ lớn, đủ tương phản)", () => {
    const root = render(baseState());
    const marker = byClass(root, "build-marker")[0];
    expect(marker.className.split(/\s+/)).not.toContain("sheet-note");
  });
});
