import { beforeEach, describe, expect, it } from "vitest";
import { solarPosition } from "../sun";
import { APP_TIMEZONE, zonedToUtc } from "../time";
import {
  courtDiagram,
  resetCourtDiagrams,
  shadowLengthPx,
  sunArcPoints,
  sunDistanceForAltitude,
  sunOpacityForAltitude,
  sunPointAt,
  sunSizeForAltitude,
  updateCourtDiagramSun,
  type CourtDiagramSunRange,
  type CourtDiagramVariant,
} from "./court-diagram";
import { diagramLabelFor } from "./sun-range";

// Mô hình mặt trời GPM-SUNMODEL-1: dùng CẢ phương vị LẪN cao độ. Test đo trực tiếp các
// thuộc tính DOM do chính module vẽ phơi ra, đối chiếu với helper thuần của app.
// Ngày/vị trí: 2026-09-18, sân mặc định Dietzenbach (Europe/Berlin).

const LAT = 49.9960846;
const LON = 8.7605459;
const DAY = "2026-09-18";
const LANGS = ["vi", "de", "en"] as const;

/** Trần bóng full: 17.2·cot(alt) = 140 → alt ≈ 7.0012°. */
const FULL_CLAMP_ALT = Math.atan((0.86 * 20) / 140) * (180 / Math.PI);
/** Trần bóng compact: 17.2·cot(alt) = 70 → alt ≈ 13.8069°. */
const COMPACT_CLAMP_ALT = Math.atan((0.86 * 20) / 70) * (180 / Math.PI);

// ---------------------------------------------------------------- DOM tối giản

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attrs: Record<string, string> = {};
  className = "";
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
  resetCourtDiagrams();
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

// ------------------------------------------------------------- dữ liệu mặt trời

function at(hour: string) {
  return solarPosition(zonedToUtc(`${DAY}T${hour}:00`, APP_TIMEZONE), LAT, LON);
}

function rangeOf(from: string, to: string): CourtDiagramSunRange {
  const start = at(from);
  const end = at(to);
  return {
    start: { azimuth: start.azimuth, elevation: start.elevation, label: from },
    end: { azimuth: end.azimuth, elevation: end.elevation, label: to },
  };
}

type DiagramState = Parameters<typeof diagramLabelFor>[0];

function fakeState(lang: (typeof LANGS)[number]): DiagramState {
  return {
    lang,
    evaluation: { point: { is_day: 1 }, sun: at("11") },
  } as unknown as DiagramState;
}

function draw(
  variant: CourtDiagramVariant,
  sun: { azimuth: number; elevation: number },
  range: CourtDiagramSunRange | null,
  ariaLabel = "aria",
  ariaLabelFor?: (bearing: number, range: CourtDiagramSunRange | null) => string,
): FakeNode {
  return courtDiagram({
    bearing: 0,
    sun,
    sunRange: range,
    isDay: true,
    variant,
    ariaLabel,
    ariaLabelFor,
    northLabel: "N",
    noSunLabel: "no-sun",
  }) as unknown as FakeNode;
}

const glyphTuple = (node: FakeNode): string[] => [
  node.attrs["data-sun-distance"],
  node.attrs["data-sun-size"],
  node.attrs.opacity,
];

describe("GPM-SUNMODEL-1 — mô hình mặt trời dùng cả phương vị lẫn cao độ", () => {
  it("khoảng cách glyph ĐÃ VẼ theo cao độ, khác nhau giữa giờ cao và giờ thấp", () => {
    const high = at("13"); // cao độ lớn
    const low = at("09"); // cao độ thấp hơn hẳn
    const highSvg = draw("full", high, null);
    const lowSvg = draw("full", low, null);
    const highGlyph = byAttr(highSvg, "data-sun-distance")[0];
    const lowGlyph = byAttr(lowSvg, "data-sun-distance")[0];
    expect(highGlyph, "thiếu data-sun-distance cho giờ cao").toBeDefined();
    expect(lowGlyph, "thiếu data-sun-distance cho giờ thấp").toBeDefined();
    const highDist = Number(highGlyph.attrs["data-sun-distance"]);
    const lowDist = Number(lowGlyph.attrs["data-sun-distance"]);
    expect(highDist).toBe(sunDistanceForAltitude(high.elevation));
    expect(lowDist).toBe(sunDistanceForAltitude(low.elevation));
    // Mặt trời cao thì gần sân hơn; thấp thì ra xa hơn.
    expect(lowDist, "giờ thấp phải xa tâm sân hơn giờ cao").toBeGreaterThan(highDist);
    // Mô hình cũ ghim cứng 143 px; mô hình mới không còn như vậy.
    expect(highDist).not.toBe(143);
    expect(Number(highGlyph.attrs["data-sun-size"])).toBe(sunSizeForAltitude(high.elevation));
    expect(Number(highGlyph.attrs.opacity)).toBe(sunOpacityForAltitude(high.elevation));
  });

  it("độ dài bóng ĐÃ VẼ = 17.2·cot(alt) (sai số 0.5%) với alt ≥ 8°, và bằng 140 khi bị kẹp", () => {
    const checked: string[] = [];
    for (const hour of ["09", "10", "11", "12", "13", "14", "15", "16", "17", "18"]) {
      const point = at(hour);
      if (point.elevation < 8) continue;
      const svg = draw("full", point, null);
      const drawn = Number(svg.attrs["data-shadow-length-px"]);
      const expected = (0.86 * 20) / Math.tan((point.elevation * Math.PI) / 180);
      expect(Math.abs(drawn - expected) / expected, `${hour}: bóng lệch quá 0.5%`).toBeLessThan(0.005);
      expect(drawn).toBe(shadowLengthPx(point.elevation, "full"));
      checked.push(hour);
    }
    expect(checked.length, "phải kiểm được nhiều giờ có alt ≥ 8°").toBeGreaterThanOrEqual(8);

    // 19:00 ngày 2026-09-18 có alt ≈ 4.34° < ngưỡng kẹp full ≈ 7.0012° → đúng 140 px.
    const clampedAlt = at("19").elevation;
    expect(clampedAlt).toBeLessThan(FULL_CLAMP_ALT);
    const clamped = draw("full", at("19"), null);
    expect(Number(clamped.attrs["data-shadow-length-px"])).toBe(140);
    expect(shadowLengthPx(clampedAlt, "full")).toBe(140);
    // Bản compact kẹp ở 70 px với cùng giờ.
    expect(shadowLengthPx(clampedAlt, "compact")).toBe(70);
    expect(Number(draw("compact", at("19"), null).attrs["data-shadow-length-px"])).toBe(70);
    // Ngưỡng kẹp compact ≈ 13.8069°: 18:00 (alt 13.88°) vẫn theo công thức, chưa kẹp.
    const justAboveCompact = at("18").elevation;
    expect(justAboveCompact).toBeGreaterThan(COMPACT_CLAMP_ALT);
    expect(shadowLengthPx(justAboveCompact, "compact")).toBeLessThan(70);
  });

  it("bán kính mẫu cung KHÔNG hằng số khi hai đầu lệch cao độ và khớp glyph hai đầu", () => {
    const range = rangeOf("09", "13"); // alt 17.34° → 41.60°
    const svg = draw("full", at("11"), range);
    const min = Number(svg.attrs["data-sun-arc-radius-min"]);
    const max = Number(svg.attrs["data-sun-arc-radius-max"]);
    expect(Number.isFinite(min) && Number.isFinite(max)).toBe(true);
    expect(min, "mô hình bán kính cố định sẽ cho min = max").not.toBe(max);
    expect(min).toBeLessThan(max);

    const samples = sunArcPoints(range).filter((point) => point.altitude > 0);
    expect(min).toBe(Math.min(...samples.map((point) => point.radius)));
    expect(max).toBe(Math.max(...samples.map((point) => point.radius)));

    const startDistance = sunDistanceForAltitude(range.start.elevation);
    const endDistance = sunDistanceForAltitude(range.end.elevation);
    expect(Number(svg.attrs["data-sun-distance-start"])).toBe(startDistance);
    expect(Number(svg.attrs["data-sun-distance-end"])).toBe(endDistance);
    const glyphDistances = byAttr(svg, "data-sun-distance").map((node) =>
      Number(node.attrs["data-sun-distance"]),
    );
    expect(glyphDistances).toContain(startDistance);
    expect(glyphDistances).toContain(endDistance);

    // Polyline bắt đầu/kết thúc đúng tại tâm glyph.
    const arc = byClass(svg, "cd-sun-arc")[0];
    const coords = [...arc.attrs.d.matchAll(/([ML])\s+(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => ({
      x: Number(m[2]),
      y: Number(m[3]),
    }));
    const first = sunPointAt(range.start.azimuth, range.start.elevation);
    const last = sunPointAt(range.end.azimuth, range.end.elevation);
    expect(Math.abs(coords[0].x - first.x)).toBeLessThan(0.01);
    expect(Math.abs(coords[0].y - first.y)).toBeLessThan(0.01);
    expect(Math.abs(coords[coords.length - 1].x - last.x)).toBeLessThan(0.01);
    expect(Math.abs(coords[coords.length - 1].y - last.y)).toBeLessThan(0.01);
  });

  it("đầu khoảng có alt ≤ 0 thì KHÔNG vẽ .cd-sun-core cho nó", () => {
    const range = rangeOf("18", "20"); // alt 13.88° → -5.29°
    expect(range.start.elevation).toBeGreaterThan(0);
    expect(range.end.elevation).toBeLessThanOrEqual(0);
    const svg = draw("full", at("19"), range); // giờ giữa vẫn ban ngày (alt 4.34°)
    expect(byClass(svg, "cd-sun-core").length, "chỉ một đầu có mặt trời").toBe(1);
    expect(byClass(svg, "cd-sun-arc").length, "cung cắt còn đoạn trên chân trời").toBe(1);

    // Một giờ dưới chân trời: giữ hành vi đêm cũ (mặt trăng), KHÔNG bịa mặt trời.
    const night = draw("full", at("20"), null);
    expect(night.attrs["data-sun-state"]).toBe("night");
    expect(byClass(night, "cd-sun-core").length).toBe(0);
    expect(byClass(night, "cd-moon").length).toBe(1);
  });

  it("variant compact cho cùng distance/size/opacity/shadow với variant full ở cùng giờ", () => {
    const sun = at("11");
    const range = rangeOf("09", "13");
    const full = draw("full", sun, range);
    const compact = draw("compact", sun, range);
    for (const attr of ["data-sun-distance-start", "data-sun-distance-end", "data-sun-arc-radius-min", "data-sun-arc-radius-max", "data-shadow-length-px"]) {
      expect(compact.attrs[attr], `compact lệch ${attr}`).toBe(full.attrs[attr]);
    }
    const fullGlyphs = byAttr(full, "data-sun-distance").map(glyphTuple);
    const compactGlyphs = byAttr(compact, "data-sun-distance").map(glyphTuple);
    expect(compactGlyphs).toEqual(fullGlyphs);
    // Chỉ nhãn chữ khác: compact bỏ hẳn chữ nhưng vẫn đủ hai mặt trời.
    expect(byClass(compact, "cd-sun-hour").length).toBe(0);
    expect(byClass(compact, "cd-sun-core").length).toBe(2);
    expect(full.attrs["data-variant"]).toBe("full");
    expect(compact.attrs["data-variant"]).toBe("compact");
  });

  it("cả hai variant cùng mô hình aria và cùng vẽ lại khi đổi khoảng giờ", () => {
    const range = rangeOf("09", "13");
    const next = rangeOf("10", "15");
    const state = fakeState("vi");
    const labelFor = (value: CourtDiagramSunRange | null): string => diagramLabelFor(state, 0, value);
    const full = draw("full", at("11"), range, labelFor(range), (_bearing, value) => labelFor(value));
    const compact = draw("compact", at("11"), range, labelFor(range), (_bearing, value) => labelFor(value));
    expect(compact.attrs["aria-label"]).toBe(full.attrs["aria-label"]);
    expect(full.attrs["aria-label"]).toContain(String(Math.round(range.start.elevation)));
    expect(full.attrs["aria-label"]).toContain(String(Math.round(range.end.elevation)));

    updateCourtDiagramSun(full as unknown as SVGElement, next);
    updateCourtDiagramSun(compact as unknown as SVGElement, next);
    for (const svg of [full, compact]) {
      expect(svg.attrs["data-sun-azimuth-end"]).toBe(String(next.end.azimuth));
      expect(svg.attrs["data-sun-distance-end"]).toBe(String(sunDistanceForAltitude(next.end.elevation)));
      expect(svg.attrs["aria-label"]).toBe(labelFor(next));
      expect(byClass(svg, "cd-sun-core").length).toBe(2);
    }
  });

  it("nhãn aria khoảng nêu cả phương vị lẫn cao độ ở cả ba ngôn ngữ", () => {
    // 10:00→11:00: az 122→137, alt 26→33 — các số không lồng vào nhau.
    const range = rangeOf("10", "11");
    for (const lang of LANGS) {
      const label = diagramLabelFor(fakeState(lang), 0, range);
      for (const expected of [
        String(Math.round(range.start.azimuth)),
        String(Math.round(range.end.azimuth)),
        String(Math.round(range.start.elevation)),
        String(Math.round(range.end.elevation)),
      ]) {
        expect(label, `${lang} thiếu ${expected}`).toContain(expected);
      }
      // Giữ nguyên phương vị, chỉ đổi cao độ cuối → nhãn phải đổi (placeholder cao độ thật).
      const higher = {
        ...range,
        end: { ...range.end, elevation: range.end.elevation + 10 },
      };
      expect(diagramLabelFor(fakeState(lang), 0, higher), `${lang} cao độ không vào nhãn`).not.toBe(label);
    }
  });
});
