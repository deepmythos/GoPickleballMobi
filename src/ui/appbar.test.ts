import { beforeEach, describe, expect, it } from "vitest";
import { t } from "../i18n";
import { renderApp } from "./render";
import { initialSheetState } from "./sheet";
import type { Actions, AppState } from "./state";

/**
 * DOM tối giản cho môi trường test "node".
 *
 * `render.ts` chỉ chạm tới createElement / createElementNS / createTextNode, appendChild,
 * setAttribute, className, dataset, textContent và addEventListener — nên một cây nút nhỏ là
 * đủ để khẳng định nội dung thanh trên cùng, mà không phải kéo thêm một thư viện DOM nào vào
 * dự án chỉ để chạy test.
 */
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
    geoResults: [],
    searchQuery: "",
    draft: { ...DEFAULT_LOCATION },
    atInput: "2026-09-18T14:00",
    theme: "system",
    offline: false,
    update: { available: false, dismissed: false },
    ...overrides,
  };
}

// renderApp chỉ gọi callback khi người dùng tương tác, nên một object rỗng là đủ.
const actions = {} as Actions;

function render(s: AppState): FakeNode {
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

describe("app bar — giờ đang tính kèm nhãn offset UTC", () => {
  it("hiển thị nhãn offset của chính mốc giờ đang tính (mùa hè: UTC+02:00)", () => {
    const root = render(state({ targetHour: "2026-09-18T14:00" }));
    expect(root.textContent).toContain("14:00");
    expect(root.textContent).toContain("(UTC+02:00)");
  });

  it("đổi theo DST: mốc giờ mùa đông là UTC+01:00", () => {
    const root = render(state({ targetHour: "2026-01-15T14:00" }));
    expect(root.textContent).toContain("(UTC+01:00)");
    expect(root.textContent).not.toContain("(UTC+02:00)");
  });

  it("dùng key có sẵn time.offset làm nhãn cho nhãn offset, ở cả ba ngôn ngữ", () => {
    for (const lang of ["vi", "de", "en"] as const) {
      const root = render(state({ lang }));
      const offset = byClass(root, "appbar-offset")[0];
      expect(offset, `thiếu .appbar-offset cho ${lang}`).toBeDefined();
      expect(offset.getAttribute("title")).toBe(t(lang, "time.offset"));
    }
  });
});

describe("app bar — toạ độ ĐANG DÙNG", () => {
  it("hiển thị toạ độ đã áp dụng với 4 số lẻ", () => {
    const root = render(state());
    const coords = byClass(root, "appbar-coords")[0];
    expect(coords, "thiếu .appbar-coords").toBeDefined();
    expect(coords.textContent).toBe("49.9961, 8.7605");
  });

  it("đổi toạ độ đã áp dụng thì thanh trên đổi theo, dù tên vẫn là tên cũ", () => {
    const root = render(state({ location: { lat: 0, lon: 8.7605459, name: DEFAULT_NAME } }));
    const coords = byClass(root, "appbar-coords")[0];
    expect(coords.textContent).toBe("0.0000, 8.7605");
    expect(root.textContent).toContain(DEFAULT_NAME);
    expect(root.textContent).not.toContain("49.9961");
  });
});
