import { beforeEach, describe, expect, it } from "vitest";
import { t } from "../i18n";
import { isExcludedTouchTarget } from "./gesture";
import { touchTargetTraits } from "./hit";
import { renderApp } from "./render";
import { initialSheetState, sheetReducer } from "./sheet";
import type { Actions, AppState } from "./state";

/**
 * HIT-TEST cho mọi nút đóng (X) — trên chính DOM mà `renderApp` dựng ra.
 *
 * Vì sao có test này: trên iPhone, nút X ở góc trên bên phải của sheet KHÔNG phản hồi
 * trong khi "Kéo xuống để đóng" vẫn chạy. Nguyên nhân (đã đo được, xem
 * `scripts/hit-test-close-controls.mjs`): cử chỉ kéo-để-đóng nghe `touchstart` trên
 * `document` cho MỌI cú chạm nằm trong `.sheet-wrap` — kể cả cú chạm vào nút X — rồi
 * gọi `preventDefault()` ở `touchmove`. `preventDefault()` đó HUỶ luôn sự kiện `click`
 * của nút, nên nút "không làm gì" dù nó vẫn nằm trên cùng (elementFromPoint vẫn trả về
 * chính nút: đây KHÔNG phải lỗi xếp lớp).
 *
 * Test này khẳng định ở tầng quyết định: cú chạm bắt đầu từ/trong một ĐIỀU KHIỂN thì
 * không được mở cử chỉ kéo; còn cú chạm vào tay nắm / thân sheet thì vẫn phải mở được
 * (kéo-để-đóng không được mất).
 *
 * Đặc điểm điểm chạm được trích bằng CHÍNH hàm `touchTargetTraits` mà `main.ts` dùng,
 * nên test không thể lệch khỏi hành vi thật của app.
 */

/** DOM tối giản cho môi trường test "node": đủ `classList`, `parentElement`, `hasAttribute`. */
class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attrs: Record<string, string> = {};
  readonly listeners: Record<string, unknown[]> = {};
  dataset: Record<string, string> = {};
  parentElement: FakeNode | null = null;
  private classNames: string[] = [];
  private ownText = "";

  constructor(readonly tagName: string) {}

  get classList(): string[] & { contains: (name: string) => boolean } {
    const list = [...this.classNames] as string[] & { contains: (name: string) => boolean };
    list.contains = (name: string) => this.classNames.includes(name);
    return list;
  }

  get className(): string {
    return this.classNames.join(" ");
  }

  set className(value: string) {
    this.classNames = String(value).split(/\s+/).filter(Boolean);
  }

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

  addEventListener(type: string, handler: unknown): void {
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

const DEFAULT_LOCATION = {
  lat: 49.9960846,
  lon: 8.7605459,
  name: "Pickleball-Plätze, Offenthaler Straße, Dietzenbach",
};

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
    theme: "system",
    offline: false,
    update: { available: false, dismissed: false },
    applyErrorKey: null,
    ...overrides,
  };
}

function openSheet(panel: "location" | "inputs"): AppState["sheet"] {
  return sheetReducer(sheetReducer(initialSheetState, { type: "open", panel }), { type: "dragEnd" });
}

// renderApp chỉ gọi callback khi người dùng tương tác, nhưng `h()` chỉ gắn listener khi
// giá trị là function — nên ở đây cần một object CÓ HÀM, nếu không test sẽ tưởng mọi nút
// đóng đều không có handler. Proxy trả hàm rỗng cho mọi khoá của Actions.
const actions = new Proxy({}, { get: () => () => undefined }) as Actions;

function render(s: AppState): FakeNode {
  const root = new FakeNode("div");
  renderApp(root as unknown as HTMLElement, s, actions);
  return root;
}

function byClass(root: FakeNode, cls: string): FakeNode[] {
  const found: FakeNode[] = [];
  const walk = (node: FakeNode): void => {
    node.classList.forEach((name) => {
      if (name === cls && !found.includes(node)) found.push(node);
    });
    node.children.forEach(walk);
  };
  walk(root);
  return found;
}

/**
 * Phần tử mà ngón tay trúng khi đặt vào giữa điều khiển: đi xuống con phần tử đầu tiên
 * (nút có icon thì cú chạm trúng `<svg>`/`<path>`, không trúng chính `<button>`).
 */
function tapTarget(control: FakeNode): FakeNode {
  let node = control;
  for (;;) {
    const next = node.children.find((child) => child.tagName !== "#text");
    if (!next) return node;
    node = next;
  }
}

function traitsOf(node: FakeNode) {
  return touchTargetTraits(node as unknown as Element);
}

function chainText(node: FakeNode): string {
  return traitsOf(node)
    .tags!.map((tag: string) => tag.toLowerCase())
    .join(" < ");
}

describe("nút X — hit-test: cú chạm thuộc về điều khiển, không bị cử chỉ kéo nuốt", () => {
  it("mọi nút đóng là <button> có handler click và bị loại khỏi cử chỉ kéo", () => {
    const cases: { name: string; card: AppState; cls: string }[] = [
      { name: "sheet Địa điểm", card: state({ sheet: openSheet("location") }), cls: "sheet-close" },
      { name: "sheet Thông số", card: state({ sheet: openSheet("inputs") }), cls: "sheet-close" },
      {
        name: "nút X của băng 'có bản mới'",
        card: state({ update: { available: true, dismissed: false } }),
        cls: "banner-dismiss",
      },
    ];

    const failures: string[] = [];
    for (const item of cases) {
      const root = render(item.card);
      const controls = byClass(root, item.cls);
      if (controls.length === 0) {
        failures.push(`${item.name}: không tìm thấy .${item.cls} trong DOM`);
        continue;
      }
      for (const control of controls) {
        const hit = tapTarget(control);
        const traits = traitsOf(hit);
        if (control.tagName.toLowerCase() !== "button") {
          failures.push(`${item.name}: .${item.cls} phải là <button>, đang là <${control.tagName}>`);
        }
        if (!(control.listeners.click ?? []).length) {
          failures.push(`${item.name}: .${item.cls} không có handler click`);
        }
        if (!isExcludedTouchTarget(traits)) {
          failures.push(
            `${item.name}: cú chạm vào .${item.cls} KHÔNG được nhận là "thuộc điều khiển" ` +
              `(chuỗi tổ tiên: ${chainText(hit)}) → cử chỉ kéo sẽ preventDefault() và nuốt cú click`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("cú chạm vào thân sheet và tay nắm vẫn KHÔNG bị loại — kéo-để-đóng còn nguyên", () => {
    const root = render(state({ sheet: openSheet("location") }));
    for (const cls of ["sheet-grab", "sheet-handle", "sheet-title"]) {
      const nodes = byClass(root, cls);
      expect(nodes.length, `thiếu .${cls}`).toBeGreaterThan(0);
      for (const node of nodes) {
        expect(
          isExcludedTouchTarget(traitsOf(node)),
          `.${cls} phải vẫn là điểm bắt đầu kéo được (chuỗi: ${chainText(node)})`,
        ).toBe(false);
      }
    }
  });

  it("nền sheet (.sheet-backdrop) là vùng bấm có handler click đóng sheet", () => {
    const root = render(state({ sheet: openSheet("location") }));
    const backdrops = byClass(root, "sheet-backdrop");
    expect(backdrops.length, "thiếu .sheet-backdrop").toBe(1);
    expect((backdrops[0].listeners.click ?? []).length, "nền sheet phải có handler click").toBeGreaterThan(0);
  });

  it("cú chạm vào nút trong sheet (ví dụ 'Đổi vị trí') cũng thuộc điều khiển", () => {
    const root = render(state({ sheet: openSheet("inputs") }));
    const buttons = byClass(root, "btn");
    expect(buttons.length, "sheet phải có ít nhất một nút .btn").toBeGreaterThan(0);
    for (const button of buttons) {
      expect(isExcludedTouchTarget(traitsOf(tapTarget(button)))).toBe(true);
    }
  });

  it("nhãn của băng chọn segmented vẫn bị loại như trước (không hồi quy)", () => {
    const root = render(state({ sheet: openSheet("inputs") }));
    const segments = byClass(root, "segment");
    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(isExcludedTouchTarget(traitsOf(tapTarget(segment)))).toBe(true);
    }
  });

  it("aria-label của nút X vẫn là chuỗi i18n 'đóng' (không đổi nhãn khi sửa lỗi)", () => {
    const root = render(state({ sheet: openSheet("location") }));
    const close = byClass(root, "sheet-close")[0];
    expect(close.getAttribute("aria-label")).toBe(t("vi", "common.close"));
  });
});
