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
    blocksOpen: { timecourt: false, location: false },
    geoStatus: "idle",
    geoError: null,
    geoResults: [],
    searchQuery: "",
    draft: { ...DEFAULT_LOCATION },
    atInput: "2026-09-18T14:00",
    theme: "system",
    offline: false,
    update: { available: false, dismissed: false },
    updateCheck: { status: "idle" },
    applyErrorKey: null,
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
      const offset = byClass(root, "infobar-offset")[0];
      expect(offset, `thiếu .infobar-offset cho ${lang}`).toBeDefined();
      expect(offset.getAttribute("title")).toBe(t(lang, "time.offset"));
    }
  });
});

describe("app bar — toạ độ ĐANG DÙNG", () => {
  it("hiển thị toạ độ đã áp dụng với 4 số lẻ", () => {
    const root = render(state());
    const coords = byClass(root, "infobar-coords")[0];
    expect(coords, "thiếu .infobar-coords").toBeDefined();
    expect(coords.textContent).toBe("49.9961, 8.7605");
  });

  it("đổi toạ độ đã áp dụng thì thanh trên đổi theo, dù tên vẫn là tên cũ", () => {
    const root = render(state({ location: { lat: 0, lon: 8.7605459, name: DEFAULT_NAME } }));
    const coords = byClass(root, "infobar-coords")[0];
    expect(coords.textContent).toBe("0.0000, 8.7605");
    expect(root.textContent).toContain(DEFAULT_NAME);
    expect(root.textContent).not.toContain("49.9961");
  });
});

describe("app bar — targetHour không hợp lệ (hồi quy ?at=14)", () => {
  it("không ném lỗi và vẫn render khối thông tin kèm toạ độ khi targetHour không hợp lệ", () => {
    let root: FakeNode | undefined;
    expect(() => {
      root = render(state({ targetHour: "14:00" }));
    }).not.toThrow();
    const coords = byClass(root as FakeNode, "infobar-coords")[0];
    expect(coords, "thiếu .infobar-coords").toBeDefined();
    expect(coords.textContent).toBe("49.9961, 8.7605");
    expect(byClass(root as FakeNode, "infobar")[0], "thiếu .infobar").toBeDefined();
  });

  it("vẫn giữ nhãn offset UTC cho targetHour hợp lệ (G1)", () => {
    const root = render(state({ targetHour: "2026-09-18T14:00" }));
    const offset = byClass(root, "infobar-offset")[0];
    expect(offset, "thiếu .infobar-offset").toBeDefined();
    expect(offset.textContent).toBe("(UTC+02:00)");
  });
});

// --- card t_3c88db3b (bỏ thanh trên, dời nội dung xuống ngay trên danh sách yếu tố) ---

/** Ba dòng chữ đã bị xoá khỏi màn hình chính, ở cả ba ngôn ngữ (khoá i18n cũng đã bị xoá). */
const REMOVED_TEXT = [
  "Vì sao điểm này?",
  "Xếp theo mức ảnh hưởng, lớn nhất trước.",
  "Chạm để xem ngưỡng và trọng số.",
  "Giả định",
  "Tippen für Schwellenwert und Gewicht.",
  "Tap to see threshold and weight.",
];

describe("khối thông tin — đủ trường, không còn dòng tóm tắt verdict", () => {
  it("giữ đúng 4 trường: tên sân, toạ độ, mốc giờ, độ lệch UTC", () => {
    const root = render(state());
    for (const cls of ["infobar-loc-name", "infobar-coords", "infobar-time-value", "infobar-offset"]) {
      expect(byClass(root, cls).length, `thiếu .${cls}`).toBe(1);
    }
  });

  it("KHÔNG còn dòng tóm tắt verdict trong khối (verdict chỉ còn ở khu hero)", () => {
    const root = render(state());
    expect(byClass(root, "infobar-verdict").length).toBe(0);
    expect(byClass(root, "infobar")[0].textContent).not.toMatch(/\d+\/100/);
  });

  it("không còn tiêu đề/phụ đề mục lý do, dòng gợi ý chạm, hay khối Giả định", () => {
    const root = render(state());
    for (const line of REMOVED_TEXT) {
      expect(root.textContent, `vẫn còn: ${line}`).not.toContain(line);
    }
    expect(byClass(root, "assumption-list").length).toBe(0);
  });
});
