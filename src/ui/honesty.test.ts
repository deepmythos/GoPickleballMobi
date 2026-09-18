import { beforeEach, describe, expect, it } from "vitest";
import { t } from "../i18n";
import { renderApp } from "./render";
import { initialSheetState, sheetReducer } from "./sheet";

// Chỉ import module đã có ở nhánh nền: ./render, ./sheet, ../i18n.
// Kiểu AppState/Actions suy trực tiếp từ chữ ký renderApp để không import ./state.
type AppState = Parameters<typeof renderApp>[1];
type Actions = Parameters<typeof renderApp>[2];

/**
 * DOM tối giản cho môi trường test "node".
 *
 * `render.ts` chỉ chạm tới createElement / createElementNS / createTextNode, appendChild,
 * setAttribute, className, dataset, textContent và addEventListener — nên một cây nút nhỏ là
 * đủ để khẳng định nội dung sheet, mà không phải kéo thêm một thư viện DOM nào vào dự án.
 * Bản này lưu lại listener để test gọi được oninput.
 */
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
  // appendChildren() phân biệt Node với chuỗi bằng `instanceof Node`.
  (globalThis as unknown as { Node: unknown }).Node = FakeNode;
});

const DEFAULT_NAME = "Pickleball-Plätze, Offenthaler Straße, Dietzenbach";
const DEFAULT_LOCATION = { lat: 49.9960846, lon: 8.7605459, name: DEFAULT_NAME };

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    lang: "vi",
    location: { ...DEFAULT_LOCATION },
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
    sheet: initialSheetState,
    rawOpen: false,
    geoStatus: "idle",
    geoError: null,
    geoResults: [],
    searchQuery: "",
    draft: { ...DEFAULT_LOCATION },
    atInput: "2026-09-18T14:00",
    applyErrorKey: null,
    theme: "system",
    offline: false,
    update: { available: false, dismissed: false },
    ...overrides,
  };
}

function openLocation(): AppState["sheet"] {
  return sheetReducer(initialSheetState, { type: "open", panel: "location" });
}

function openInputs(): AppState["sheet"] {
  return sheetReducer(initialSheetState, { type: "open", panel: "inputs" });
}

function render(s: AppState, actions: Actions = {} as Actions): FakeNode {
  const root = new FakeNode("div");
  renderApp(root as unknown as HTMLElement, s, actions);
  return root;
}

function byClass(root: FakeNode, cls: string): FakeNode[] {
  const found: FakeNode[] = [];
  const walk = (node: FakeNode): void => {
    if (node.className.split(/\s+/).includes(cls)) found.push(node);
    node.children.forEach(walk);
  };
  walk(root);
  return found;
}

const LANGS = ["vi", "de", "en"] as const;

describe("G3 — tìm địa điểm thất bại KHÔNG báo lỗi định vị", () => {
  it("hiện thông báo tìm kiếm thất bại ở cả 3 ngôn ngữ", () => {
    for (const lang of LANGS) {
      const root = render(
        state({ lang, sheet: openLocation(), geoStatus: "error", geoError: "search" }),
      );
      const notes = byClass(root, "error-text");
      expect(notes.length, `thiếu .error-text cho ${lang}`).toBe(1);
      expect(notes[0].textContent).toBe(t(lang, "location.searchFailed"));
      expect(notes[0].textContent).not.toBe(t(lang, "location.geoDenied"));
      expect(root.textContent).not.toContain(t(lang, "location.geoDenied"));
    }
  });

  it("vẫn báo lỗi định vị khi lỗi đến từ định vị", () => {
    const root = render(
      state({ sheet: openLocation(), geoStatus: "error", geoError: "locate" }),
    );
    const notes = byClass(root, "error-text");
    expect(notes[0].textContent).toBe(t("vi", "location.geoDenied"));
    expect(root.textContent).not.toContain(t("vi", "location.searchFailed"));
  });
});

describe("G4 — nhãn đang chờ nói đúng thao tác", () => {
  it("định vị đang chờ hiện nhãn định vị, không phải nhãn tìm kiếm", () => {
    for (const lang of LANGS) {
      const root = render(
        state({ lang, sheet: openLocation(), geoStatus: "loading", geoError: "locate" }),
      );
      const notes = byClass(root, "sheet-note").map((n) => n.textContent);
      expect(notes, `thiếu nhãn định vị cho ${lang}`).toContain(t(lang, "location.locating"));
      expect(notes.join(" ")).not.toContain(t(lang, "location.searching"));
    }
  });

  it("tìm kiếm đang chờ vẫn hiện nhãn tìm kiếm", () => {
    const root = render(
      state({ sheet: openLocation(), geoStatus: "loading", geoError: null }),
    );
    const notes = byClass(root, "sheet-note").map((n) => n.textContent);
    expect(notes).toContain(t("vi", "location.searching"));
    expect(notes.join(" ")).not.toContain(t("vi", "location.locating"));
  });
});

describe("G5 — ô vĩ độ bị xoá không bị ép thành 0", () => {
  it("oninput với ô rỗng đẩy về draft NaN, không phải 0", () => {
    let captured: { lat?: number; lon?: number; name?: string } | null = null;
    const actions = {
      patchDraft: (patch: { lat?: number; lon?: number; name?: string }) => {
        captured = patch;
      },
    } as unknown as Actions;

    const root = render(state({ sheet: openLocation() }), actions);
    const numberInputs = byClass(root, "input").filter((n) => n.attrs.type === "number");
    expect(numberInputs.length).toBe(2);
    const latInput = numberInputs[0];
    const handler = latInput.listeners.input?.[0];
    expect(handler, "thiếu listener oninput cho ô vĩ độ").toBeDefined();
    handler!({ target: { value: "" } });

    const patch = captured as { lat?: number } | null;
    expect(patch).not.toBeNull();
    expect(typeof patch!.lat).toBe("number");
    expect(Number.isNaN(patch!.lat as number)).toBe(true);
    expect(patch!.lat).not.toBe(0);
  });

  it("ô NaN không hiện chuỗi \"NaN\" mà để trống", () => {
    const root = render(state({ sheet: openLocation(), draft: { lat: Number.NaN, lon: 8.76, name: "x" } }));
    const numberInputs = byClass(root, "input").filter((n) => n.attrs.type === "number");
    expect(numberInputs[0].attrs.value).toBe("");
    expect(numberInputs[1].attrs.value).toBe("8.76");
  });
});

describe("G5 — lỗi áp dụng hiện ngay trong sheet, sheet vẫn mở", () => {
  it("panel location: hiện location.invalidCoords và giữ .sheet-wrap", () => {
    for (const lang of LANGS) {
      const root = render(
        state({ lang, sheet: openLocation(), applyErrorKey: "location.invalidCoords" }),
      );
      const errors = byClass(root, "apply-error");
      expect(errors.length, `thiếu .apply-error cho ${lang}`).toBe(1);
      expect(errors[0].textContent).toBe(t(lang, "location.invalidCoords"));
      expect(byClass(root, "sheet-wrap").length).toBe(1);
    }
  });

  it("panel inputs: hiện time.invalidTime và giữ .sheet-wrap", () => {
    for (const lang of LANGS) {
      const root = render(
        state({ lang, sheet: openInputs(), applyErrorKey: "time.invalidTime" }),
      );
      const errors = byClass(root, "apply-error");
      expect(errors.length, `thiếu .apply-error cho ${lang}`).toBe(1);
      expect(errors[0].textContent).toBe(t(lang, "time.invalidTime"));
      expect(byClass(root, "sheet-wrap").length).toBe(1);
    }
  });

  it("không hiện lỗi áp dụng khi applyErrorKey là null", () => {
    const root = render(state({ sheet: openLocation(), applyErrorKey: null }));
    expect(byClass(root, "apply-error").length).toBe(0);
  });
});
