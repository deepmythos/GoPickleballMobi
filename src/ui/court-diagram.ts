// Hình sân pickleball nhìn từ trên xuống, đúng tỉ lệ, kèm hướng nắng THẬT.
//
// Module này KHÔNG đọc AppState và KHÔNG import "../sun" / i18n: mọi chuỗi do caller
// truyền vào, còn phương vị/cao độ mặt trời thì nhận nguyên từ evaluation.sun. Nhờ vậy
// hình chỉ VẼ lại dữ liệu đã tính, tuyệt đối không tự tính lại mặt trời.
//
// Màu sắc đi qua các class "cd-*" trong một <style> con nằm trong <svg>, dùng design token.

const SVG_NS = "http://www.w3.org/2000/svg";

/** px trên mét — hình vẽ đúng tỉ lệ theo hằng số này. */
export const COURT_SCALE = 20;
/** Sân pickleball dài 13.41 m. */
export const COURT_LENGTH_M = 13.41;
/** Sân pickleball rộng 6.10 m. */
export const COURT_WIDTH_M = 6.10;
/** Vùng non-volley (kitchen) sâu 2.13 m mỗi bên lưới. */
export const KITCHEN_M = 2.13;
/** Cao lưới, dùng để tính bóng. */
export const NET_HEIGHT_M = 0.86;

const HALF_W = (COURT_WIDTH_M * COURT_SCALE) / 2; // 61
const HALF_L = (COURT_LENGTH_M * COURT_SCALE) / 2; // 134.1
const KITCHEN_PX = KITCHEN_M * COURT_SCALE; // 42.6
const DIAL_R = 168;
const SUN_DIST = 143;
const SUN_R = 11;
const VIEW = "-176 -176 352 352";
const SHADOW_MAX_FULL = 140;
const SHADOW_MAX_COMPACT = 70;

export type CourtDiagramVariant = "full" | "compact";

/** Một đầu của khoảng mặt trời: phương vị/cao độ + nhãn giờ caller đã dịch. */
export interface CourtDiagramSunPoint {
  azimuth: number;
  elevation: number;
  label: string;
}

export interface CourtDiagramSunRange {
  start: CourtDiagramSunPoint;
  end: CourtDiagramSunPoint;
  /** Giờ giữa khoảng (caller dịch), chỉ dùng cho nhãn aria — hình không vẽ. */
  midpoint?: string;
}

export interface CourtDiagramInput {
  /** Hướng trục dài sân, độ, thuận chiều kim đồng hồ tính từ Bắc. */
  bearing: number;
  /** LẤY TỪ evaluation.sun; null = chưa biết. */
  sun: { azimuth: number; elevation: number } | null;
  /**
   * Khoảng mặt trời (evaluation.sunStart -> evaluation.sunEnd) để vẽ HAI mặt trời + cung
   * chuyển động. Chỉ có tác dụng khi `sun` (giờ giữa) là ban ngày; ban đêm/chưa biết giữ
   * nguyên hành vi cũ (mặt trăng / không vẽ gì).
   */
  sunRange?: CourtDiagramSunRange | null;
  /** = evaluation.point.is_day !== 0. */
  isDay?: boolean;
  /** Mặc định "full". */
  variant?: CourtDiagramVariant;
  /** Caller dựng sẵn (i18n nằm ở render.ts). */
  ariaLabel: string;
  /**
   * Dựng lại nhãn aria theo bearing + khoảng mặt trời HIỆN TẠI. Nhờ vậy khi kéo tay nắm
   * hoặc xoay bearing, hình tự cập nhật nhãn tại chỗ mà không cần render lại app.
   */
  ariaLabelFor?: (bearing: number, range: CourtDiagramSunRange | null) => string;
  /** Chữ N trên hình, caller truyền (vi "B", de/en "N"). */
  northLabel: string;
  /** Nhãn NGẮN hiện khi trời tối. */
  noSunLabel?: string;
}

export type CompassSector = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const SECTORS: CompassSector[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

/** 8 hướng, mỗi hướng 45°, tâm ở 0/45/90… */
export function compassSector(deg: number): CompassSector {
  const norm = ((deg % 360) + 360) % 360;
  return SECTORS[Math.round(norm / 45) % 8];
}

type Attrs = Record<string, string | number | null | undefined>;

function el(tag: string, attrs: Attrs = {}, ...children: (Node | string)[]): SVGElement {
  const node = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (typeof child === "string") node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

type SunState = "day" | "night" | "unknown";

function resolveSunState(sun: CourtDiagramInput["sun"], isDay: boolean | undefined): SunState {
  if (sun === null) return "unknown";
  if (isDay === false || sun.elevation <= 0) return "night";
  return "day";
}

interface ShadowVector {
  dx: number;
  dy: number;
  deltaPx: number;
}

/**
 * Bóng lưới: chỉ dùng lượng giác của phép quay + cao độ đã cho.
 * Mặt trời càng thấp → bóng càng dài; kẹp ở 140 px (full) / 70 px (compact).
 */
function shadowVector(
  sun: { azimuth: number; elevation: number },
  bearing: number,
  variant: CourtDiagramVariant,
): ShadowVector {
  const maxPx = variant === "compact" ? SHADOW_MAX_COMPACT : SHADOW_MAX_FULL;
  let deltaPx: number;
  if (sun.elevation <= 2) {
    deltaPx = maxPx;
  } else {
    deltaPx = (NET_HEIGHT_M * COURT_SCALE) / Math.tan((sun.elevation * Math.PI) / 180);
  }
  if (!Number.isFinite(deltaPx) || deltaPx > maxPx) deltaPx = maxPx;
  if (deltaPx < 0) deltaPx = 0;
  const rel = ((sun.azimuth + 180 - bearing) * Math.PI) / 180;
  return { dx: deltaPx * Math.sin(rel), dy: -deltaPx * Math.cos(rel), deltaPx };
}

function shadowPoints(v: ShadowVector): string {
  return [
    `${-HALF_W},0`,
    `${HALF_W},0`,
    `${HALF_W + v.dx},${v.dy}`,
    `${-HALF_W + v.dx},${v.dy}`,
  ].join(" ");
}

function shadowDepth(px: number): string {
  return (px / COURT_SCALE).toFixed(3);
}

const DIAGRAM_STYLE = [
  ".cd-court{fill:var(--surface-2);stroke:var(--border-strong);stroke-width:1.5}",
  ".cd-line{stroke:var(--border-strong);stroke-width:1.2}",
  ".cd-kitchen,.cd-service{stroke:var(--border);stroke-width:1}",
  ".cd-net{stroke-width:2.4}",
  ".cd-dial{fill:none;stroke:var(--faint);stroke-width:1}",
  ".cd-tick{stroke:var(--faint);stroke-width:1}",
  ".cd-north{fill:var(--muted);font-size:11px;font-weight:600}",
  ".cd-sun-core{fill:var(--maybe)}",
  ".cd-sun-ray{stroke:var(--maybe);stroke-width:1.6}",
  ".cd-sun-hour{fill:var(--text);font-size:10px;font-weight:600}",
  ".cd-sun-arc{fill:none;stroke:var(--maybe);stroke-width:1.6;stroke-dasharray:4 4}",
  ".cd-sun-arc-head{fill:var(--maybe)}",
  ".cd-arrow{stroke:var(--muted);stroke-width:1.4}",
  ".cd-arrow-head{fill:var(--muted)}",
  ".cd-moon{fill:var(--muted)}",
  ".cd-shadow{fill:var(--good-soft);opacity:0.8}",
  ".cd-label{fill:var(--text);font-size:10px}",
].join("");

interface Registered {
  redraw: (bearing: number, ariaLabel?: string) => void;
  /** Vẽ lại phần mặt trời tại chỗ khi khoảng giờ đổi (không render lại app). */
  redrawSun: (sunRange: CourtDiagramSunRange | null | undefined) => void;
}

// Tham chiếu nội bộ để xoay lại mà không cần querySelector (test node dựng DOM giả).
const registry = new WeakMap<SVGElement, Registered>();
// Danh sách hình ĐANG SỐNG. DOM bị xoá mỗi lần renderApp nên renderApp gọi
// resetCourtDiagrams() ở đầu để không giữ tham chiếu tới cây DOM cũ.
const liveDiagrams = new Set<SVGElement>();

let clipSeq = 0;

function buildSunGlyph(): SVGElement {
  const glyph = el("g", { transform: `translate(0 ${-SUN_DIST})` });
  for (let i = 0; i < 8; i++) {
    const a = (i * 45 * Math.PI) / 180;
    glyph.appendChild(
      el("line", {
        class: "cd-sun-ray",
        x1: (SUN_R + 2) * Math.sin(a),
        y1: -(SUN_R + 2) * Math.cos(a),
        x2: (SUN_R + 7) * Math.sin(a),
        y2: -(SUN_R + 7) * Math.cos(a),
      }),
    );
  }
  glyph.appendChild(el("circle", { class: "cd-sun-core", cx: 0, cy: 0, r: SUN_R }));
  return glyph;
}

function buildMoonGlyph(): SVGElement {
  return el("path", {
    class: "cd-moon",
    transform: `translate(0 ${-SUN_DIST})`,
    d: "M 4,-10.5 A 11,11 0 1 0 4,10.5 A 8.5,8.5 0 1 1 4,-10.5 Z",
  });
}

/** Mũi tên chỉ vào tâm = hướng ánh sáng truyền tới. */
function buildLightArrow(): SVGElement {
  const head = el("polygon", {
    class: "cd-arrow-head",
    points: `0,${-(SUN_DIST - 35)} -5,${-(SUN_DIST - 26)} 5,${-(SUN_DIST - 26)}`,
  });
  const shaft = el("line", {
    class: "cd-arrow",
    x1: 0,
    y1: -(SUN_DIST - 15),
    x2: 0,
    y2: -(SUN_DIST - 27),
  });
  return el("g", {}, shaft, head);
}

/** Điểm trên vòng bán kính `radius` tại phương vị `azimuth` (0° = Bắc/trên, thuận chiều kim đồng hồ). */
function polarPoint(azimuth: number, radius: number): { x: number; y: number } {
  const a = (azimuth * Math.PI) / 180;
  return { x: radius * Math.sin(a), y: -radius * Math.cos(a) };
}

/** Cung phương vị TĂNG dần (azimuth lớn dần = thuận chiều kim đồng hồ khi Bắc ở trên). */
function increasingSweep(startAzimuth: number, endAzimuth: number): number {
  return (((endAzimuth - startAzimuth) % 360) + 360) % 360;
}

/**
 * Một mặt trời của khoảng. Bản "full" kèm nhãn giờ nằm ngang (xoay bù -azimuth để chữ
 * không nghiêng); bản "compact" bỏ HẲN chữ vì ở ô 64px không còn đọc được.
 */
function buildRangeSunGlyph(point: CourtDiagramSunPoint, showLabel: boolean): SVGElement {
  const group = el("g", { transform: `rotate(${point.azimuth} 0 0)` });
  group.appendChild(buildSunGlyph());
  if (showLabel) {
    group.appendChild(
      el(
        "text",
        {
          class: "cd-sun-hour",
          transform: `translate(0 ${-(SUN_DIST - 26)}) rotate(${-point.azimuth})`,
          "text-anchor": "middle",
        },
        point.label,
      ),
    );
  }
  return group;
}

/**
 * Cung nối hai mặt trời theo chiều phương vị TĂNG, kèm đầu mũi tên tiếp tuyến ở CUỐI cung.
 * `sweep-flag = 1` (chiều dương SVG = thuận chiều kim đồng hồ với trục y hướng xuống).
 */
function buildSunArc(range: CourtDiagramSunRange): SVGElement | null {
  const sweep = increasingSweep(range.start.azimuth, range.end.azimuth);
  if (sweep <= 0.001) return null;
  const start = polarPoint(range.start.azimuth, SUN_DIST);
  const end = polarPoint(range.end.azimuth, SUN_DIST);
  const largeArc = sweep > 180 ? 1 : 0;
  const group = el("g", { "data-sun-arc-group": "1" });
  group.appendChild(
    el("path", {
      class: "cd-sun-arc",
      d: `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${SUN_DIST} ${SUN_DIST} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
      "data-sun-arc-start": range.start.azimuth,
      "data-sun-arc-end": range.end.azimuth,
      "data-sun-arc-sweep": "1",
    }),
  );
  // Đầu mũi tên tại điểm cuối, tiếp tuyến theo hướng phương vị tăng dần.
  const a = (range.end.azimuth * Math.PI) / 180;
  const tangent = { x: Math.cos(a), y: Math.sin(a) };
  const normal = { x: -Math.sin(a), y: Math.cos(a) };
  const head = 12;
  const half = 5;
  const tip = { x: end.x + (tangent.x * head) / 2, y: end.y + (tangent.y * head) / 2 };
  const b1 = {
    x: end.x - (tangent.x * head) / 2 + normal.x * half,
    y: end.y - (tangent.y * head) / 2 + normal.y * half,
  };
  const b2 = {
    x: end.x - (tangent.x * head) / 2 - normal.x * half,
    y: end.y - (tangent.y * head) / 2 - normal.y * half,
  };
  group.appendChild(
    el("polygon", {
      class: "cd-sun-arc-head",
      points: `${tip.x.toFixed(2)},${tip.y.toFixed(2)} ${b1.x.toFixed(2)},${b1.y.toFixed(2)} ${b2.x.toFixed(2)},${b2.y.toFixed(2)}`,
    }),
  );
  return group;
}

/** Ghi/ghi đè các thuộc tính mô tả cung lên <svg>. */
function markSunRange(svg: SVGElement, range: CourtDiagramSunRange | null): void {
  if (!range) return;
  svg.setAttribute("data-sun-azimuth-start", String(range.start.azimuth));
  svg.setAttribute("data-sun-azimuth-end", String(range.end.azimuth));
  svg.setAttribute("data-sun-arc-start", String(range.start.azimuth));
  svg.setAttribute("data-sun-arc-end", String(range.end.azimuth));
  svg.setAttribute("data-sun-arc-sweep", "1");
}

/**
 * Lớp mặt trời/mặt trăng. Ban ngày + có khoảng -> hai mặt trời + cung; ngược lại giữ
 * nguyên một mặt trời/mặt trăng như trước. Bóng KHÔNG nằm ở đây: nó vẽ riêng cho giờ giữa.
 */
function buildSunLayer(
  state: SunState,
  sun: { azimuth: number; elevation: number } | null,
  sunRange: CourtDiagramSunRange | null,
  noSunLabel: string | undefined,
  showLabels: boolean,
): SVGElement {
  const layer = el("g", { "data-sun-layer": "1" });
  if (state === "unknown" || !sun) return layer;
  if (state === "day" && sunRange) {
    const arc = buildSunArc(sunRange);
    if (arc) layer.appendChild(arc);
    layer.appendChild(buildRangeSunGlyph(sunRange.start, showLabels));
    layer.appendChild(buildRangeSunGlyph(sunRange.end, showLabels));
    return layer;
  }
  const sunRotor = el("g", { "data-sun-rotor": "1", transform: `rotate(${sun.azimuth} 0 0)` });
  if (state === "day") {
    sunRotor.appendChild(buildSunGlyph());
    sunRotor.appendChild(buildLightArrow());
  } else {
    sunRotor.appendChild(buildMoonGlyph());
    if (noSunLabel && showLabels) {
      sunRotor.appendChild(
        el(
          "text",
          {
            class: "cd-label",
            transform: `translate(0 ${-(SUN_DIST - 26)}) rotate(${-sun.azimuth})`,
            "text-anchor": "middle",
          },
          noSunLabel,
        ),
      );
    }
  }
  layer.appendChild(sunRotor);
  return layer;
}

export function courtDiagram(input: CourtDiagramInput): SVGElement {
  const variant = input.variant ?? "full";
  const size = variant === "compact" ? 150 : 300;
  const sun = input.sun;
  const state = resolveSunState(sun, input.isDay);

  const svg = el("svg", {
    class: "court-diagram",
    role: "img",
    "aria-label": input.ariaLabel,
    viewBox: VIEW,
    width: size,
    height: size,
    xmlns: SVG_NS,
    "data-variant": variant,
    "data-court-bearing": String(input.bearing),
    "data-sun-azimuth": sun ? String(sun.azimuth) : "",
    "data-sun-elevation": sun ? String(sun.elevation) : "",
    "data-sun-state": state,
    "data-shadow-depth-m": "",
  });
  svg.appendChild(el("style", {}, DIAGRAM_STYLE));

  // Vòng dial cố định theo thế giới (Bắc ở trên); compact chỉ còn chữ N và mặt trời.
  if (variant === "full") {
    svg.appendChild(el("circle", { class: "cd-dial", cx: 0, cy: 0, r: DIAL_R, "stroke-dasharray": "3 6" }));
    for (let i = 0; i < 8; i++) {
      const a = (i * 45 * Math.PI) / 180;
      svg.appendChild(
        el("line", {
          class: "cd-tick",
          x1: (DIAL_R - 8) * Math.sin(a),
          y1: -(DIAL_R - 8) * Math.cos(a),
          x2: DIAL_R * Math.sin(a),
          y2: -DIAL_R * Math.cos(a),
        }),
      );
    }
  }
  // Bản "compact" bỏ HẲN chữ trang trí (kể cả chữ N) — ở ô 64px chúng không đọc được.
  if (variant === "full") {
    svg.appendChild(
      el("text", { class: "cd-north", x: 0, y: -DIAL_R, "text-anchor": "middle" }, input.northLabel),
    );
  }

  // Toàn bộ sân nằm trong nhóm xoay theo bearing (mặc định 0 = Bắc–Nam).
  const rotor = el("g", { "data-court-rotor": "1", transform: `rotate(${input.bearing} 0 0)` });
  rotor.appendChild(
    el("rect", { class: "cd-court", x: -HALF_W, y: -HALF_L, width: HALF_W * 2, height: HALF_L * 2 }),
  );
  rotor.appendChild(el("line", { class: "cd-line cd-net", x1: -HALF_W, y1: 0, x2: HALF_W, y2: 0 }));
  rotor.appendChild(
    el("line", { class: "cd-line cd-kitchen", x1: -HALF_W, y1: -KITCHEN_PX, x2: HALF_W, y2: -KITCHEN_PX }),
  );
  rotor.appendChild(
    el("line", { class: "cd-line cd-kitchen", x1: -HALF_W, y1: KITCHEN_PX, x2: HALF_W, y2: KITCHEN_PX }),
  );
  rotor.appendChild(
    el("line", { class: "cd-line cd-service", x1: 0, y1: -HALF_L, x2: 0, y2: -KITCHEN_PX }),
  );
  rotor.appendChild(
    el("line", { class: "cd-line cd-service", x1: 0, y1: KITCHEN_PX, x2: 0, y2: HALF_L }),
  );

  let shadow: SVGElement | null = null;
  if (state === "day" && sun) {
    const clipId = `cd-clip-${++clipSeq}`;
    svg.appendChild(
      el(
        "defs",
        {},
        el("clipPath", { id: clipId }, el("rect", { x: -HALF_W, y: -HALF_L, width: HALF_W * 2, height: HALF_L * 2 })),
      ),
    );
    const vector = shadowVector(sun, input.bearing, variant);
    shadow = el("polygon", {
      class: "cd-shadow",
      points: shadowPoints(vector),
      "clip-path": `url(#${clipId})`,
    });
    rotor.appendChild(shadow);
    svg.setAttribute("data-shadow-depth-m", shadowDepth(vector.deltaPx));
  }
  svg.appendChild(rotor);

  // Glyph mặt trời/mặt trăng + mũi tên sáng. Khi có KHOẢNG và giờ giữa là ban ngày thì
  // vẽ hai mặt trời + cung chuyển động; ban đêm/chưa biết giữ nguyên hành vi cũ
  // (mặt trăng kèm nhãn `noSunLabel` / không vẽ gì). Bóng vẫn chỉ vẽ MỘT bộ cho giờ giữa.
  const showLabels = variant === "full";
  const sunLayer = buildSunLayer(
    state,
    sun,
    state === "day" ? (input.sunRange ?? null) : null,
    input.noSunLabel,
    showLabels,
  );
  if (state !== "unknown" && sun) {
    svg.appendChild(sunLayer);
    if (state === "day" && input.sunRange) markSunRange(svg, input.sunRange);
  }

  // Trạng thái "đang sống" của hình để hai updater tại chỗ (xoay / đổi khoảng giờ)
  // luôn dựng lại được nhãn aria đúng với dữ liệu hiện tại.
  let currentBearing = input.bearing;
  let currentRange: CourtDiagramSunRange | null = state === "day" ? (input.sunRange ?? null) : null;
  const ariaFor = input.ariaLabelFor;

  const applyAria = (bearing: number): void => {
    if (ariaFor) svg.setAttribute("aria-label", ariaFor(bearing, currentRange));
  };

  const redraw = (bearing: number, ariaLabel?: string): void => {
    currentBearing = bearing;
    rotor.setAttribute("transform", `rotate(${bearing} 0 0)`);
    svg.setAttribute("data-court-bearing", String(bearing));
    if (ariaLabel !== undefined) svg.setAttribute("aria-label", ariaLabel);
    else applyAria(bearing);
    if (shadow && sun && state === "day") {
      const vector = shadowVector(sun, bearing, variant);
      shadow.setAttribute("points", shadowPoints(vector));
      svg.setAttribute("data-shadow-depth-m", shadowDepth(vector.deltaPx));
    }
  };

  // Cập nhật TẠI CHỖ phần mặt trời khi khoảng giờ đổi: xoá lớp cũ rồi dựng lại đúng
  // logic lúc render đầu. Chỉ làm khi giờ giữa là ban ngày (ban đêm giữ mặt trăng).
  const redrawSun = (sunRange: CourtDiagramSunRange | null | undefined, ariaLabel?: string): void => {
    if (state !== "day" || !sun) return;
    currentRange = sunRange ?? null;
    sunLayer.textContent = "";
    if (sunRange) {
      const arc = buildSunArc(sunRange);
      if (arc) sunLayer.appendChild(arc);
      sunLayer.appendChild(buildRangeSunGlyph(sunRange.start, showLabels));
      sunLayer.appendChild(buildRangeSunGlyph(sunRange.end, showLabels));
      markSunRange(svg, sunRange);
    } else {
      const sunRotor = el("g", { "data-sun-rotor": "1", transform: `rotate(${sun.azimuth} 0 0)` });
      sunRotor.appendChild(buildSunGlyph());
      sunRotor.appendChild(buildLightArrow());
      sunLayer.appendChild(sunRotor);
    }
    if (ariaLabel !== undefined) svg.setAttribute("aria-label", ariaLabel);
    else applyAria(currentBearing);
  };

  registry.set(svg, { redraw, redrawSun });
  liveDiagrams.add(svg);
  return svg;
}

/** Xoay hình ngay khi kéo thanh trượt — cập nhật tại chỗ, không render lại app. */
export function rotateCourtDiagram(svg: SVGElement, bearing: number, ariaLabel?: string): void {
  registry.get(svg)?.redraw(bearing, ariaLabel);
}

/**
 * Vẽ lại RIÊNG phần mặt trời (hai mặt trời + cung) tại chỗ khi khoảng giờ đổi, ví dụ
 * lúc kéo tay nắm — cùng cơ chế registry/updater với `rotateCourtDiagram`. Việc xoay
 * theo bearing và việc đổi khoảng giờ độc lập nhau nên hai updater cùng tồn tại.
 */
export function updateCourtDiagramSun(svg: SVGElement, sunRange: CourtDiagramSunRange | null): void {
  registry.get(svg)?.redrawSun(sunRange);
}

/**
 * Quên mọi hình của lần render trước. renderApp gọi hàm này NGAY ĐẦU mỗi lần dựng lại
 * DOM; không có nó, updater sẽ vẽ vào các <svg> đã bị tháo khỏi cây.
 */
export function resetCourtDiagrams(): void {
  liveDiagrams.clear();
}

/**
 * Vẽ lại phần mặt trời cho MỌI hình đang sống (bản full trên màn hình chính + bản
 * compact ở hàng "chói nắng") trong cùng một nhịp kéo tay nắm, không render lại app.
 */
export function updateAllCourtDiagramsSun(sunRange: CourtDiagramSunRange | null): void {
  for (const svg of liveDiagrams) registry.get(svg)?.redrawSun(sunRange);
}

/** Xoay MỌI hình đang sống tại chỗ khi kéo thanh bearing, không render lại app. */
export function rotateAllCourtDiagrams(bearing: number): void {
  for (const svg of liveDiagrams) registry.get(svg)?.redraw(bearing);
}
