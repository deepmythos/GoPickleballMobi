import {
  bandFor,
  formatClock,
  formatDateTime,
  formatNumber,
  t,
  weatherCodeKey,
  type MessageKey,
} from "../i18n";
import { FACTOR_META } from "../scoring";
import { APP_TIMEZONE, formatLocalISO, formatUtcOffset, getOffsetMinutes, zonedToUtc } from "../time";
import { BUILD_ID, BUILD_TIME } from "../build";
import type { Evaluation } from "../evaluate";
import type { Lang } from "../types";
import { unitText } from "../units";
import { compassSector, courtDiagram, rotateCourtDiagram } from "./court-diagram";
import { dragVisual, type SheetPanel } from "./sheet";
import { factorIcon, gateIcon, makeIcon, ICONS } from "./icons";
import { impactBar } from "./impact";
import type { Actions, AppState } from "./state";
import { parseCoordInput } from "./validate";

type Child = Node | string | number | null | undefined | false;

type Attrs = Record<string, unknown>;

function appendChildren(el: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key === "text") el.textContent = String(value);
    else if (key === "dataset") Object.assign(el.dataset, value as Record<string, string>);
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  appendChildren(el, children);
  return el;
}

function svgEl(tag: string, attrs: Attrs = {}, ...children: Child[]): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    el.setAttribute(key, String(value));
  }
  appendChildren(el, children);
  return el;
}

const MSG = (key: string): MessageKey => key as MessageKey;

/**
 * Cờ module-level: chuyển động vào chỉ chạy ở lần render ĐẦU TIÊN có kết quả.
 * Mọi render sau (mở sheet, mở details, đổi giờ…) tái dùng DOM tĩnh, không phát lại.
 */
let revealed = false;

/** So le hàng yếu tố: kẹp chỉ số ở 8 để tổng thời gian không phình. */
function revealStyle(index: number): string {
  return `--reveal-index: ${Math.min(index, 8)}`;
}

/** Host thật của một URL dữ liệu; lỗi parse thì trả nguyên chuỗi. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Đưa ô nhập vào tầm nhìn khi bàn phím iOS mở ra (không để bàn phím che). */
function focusScroll(e: FocusEvent): void {
  const target = e.target as HTMLElement | null;
  target?.scrollIntoView({ block: "nearest" });
}

function signed(lang: Lang, value: number): string {
  if (value === 0) return "0";
  const formatted = formatNumber(lang, Math.abs(value), { maximumFractionDigits: 1 });
  return value > 0 ? `+${formatted}` : `\u2212${formatted}`;
}

function verdictClass(verdict: string): string {
  if (verdict === "Nên đi") return "go";
  if (verdict === "Cân nhắc") return "maybe";
  return "no";
}

function verdictLabel(lang: Lang, verdict: string): string {
  if (verdict === "Nên đi") return t(lang, "verdict.go");
  if (verdict === "Cân nhắc") return t(lang, "verdict.maybe");
  return t(lang, "verdict.no");
}

function idealText(lang: Lang, id: string): string {
  if (id === "is_day") return t(lang, "ideal.day");
  const meta = FACTOR_META[id];
  if (!meta || (meta.idealMin === null && meta.idealMax === null)) return t(lang, "ideal.none");
  const min = meta.idealMin;
  const max = meta.idealMax;
  if (min !== null && max !== null) {
    if (min === max) return t(lang, "ideal.exact", { value: min });
    return t(lang, "ideal.range", { min, max });
  }
  if (min === null && max !== null) return t(lang, "ideal.max", { max });
  return t(lang, "ideal.min", { min: min as number });
}

function confidenceLabel(lang: Lang, confidence: string): string {
  if (confidence === "high") return t(lang, "confidence.high");
  if (confidence === "medium") return t(lang, "confidence.medium");
  return t(lang, "confidence.low");
}

function fetchedLabel(lang: Lang, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatDateTime(lang, formatLocalISO(date, APP_TIMEZONE));
}

/**
 * Nhãn aria cho hình sân — DÙNG CHUNG cho sheet Cài đặt và hàng yếu tố trên màn hình chính.
 * Phương vị/cao độ truyền vào lấy nguyên từ evaluation.sun, không tính lại mặt trời.
 */
function courtDiagramLabel(lang: Lang, ev: Evaluation | null, bearing: number): string {
  const axis = Math.round(((bearing % 360) + 360) % 360) % 360;
  const axisDir = t(lang, MSG(`compass.${compassSector(bearing)}`));
  if (!ev) return t(lang, "court.diagramLabelUnknown", { axis, axisDir });
  if (ev.point.is_day === 0 || ev.sun.elevation <= 0) {
    return t(lang, "court.diagramLabelNight", { axis, axisDir });
  }
  return t(lang, "court.diagramLabel", {
    axis,
    axisDir,
    sun: Math.round(ev.sun.azimuth),
    sunDir: t(lang, MSG(`compass.${compassSector(ev.sun.azimuth)}`)),
    alt: Math.round(ev.sun.elevation),
    shadowDir: t(lang, MSG(`compass.${compassSector(ev.sun.azimuth + 180)}`)),
  });
}

function factorSentence(lang: Lang, id: string, impact: number): string {
  const band = bandFor(impact);
  const label = t(lang, MSG(`factor.${id}`));
  const note =
    band === "neutral"
      ? t(lang, "reason.neutral", { label })
      : t(lang, MSG(`factor.note.${band}.${id}`));
  const template =
    band === "good"
      ? "reason.upTemplate"
      : band === "bad"
        ? "reason.downTemplate"
        : "reason.flatTemplate";
  return t(lang, MSG(template), {
    note,
    points: formatNumber(lang, Math.abs(impact), { maximumFractionDigits: 1 }),
  });
}

function weatherText(lang: Lang, code: number | null): string {
  const key = weatherCodeKey(code);
  return key ? t(lang, key) : t(lang, "common.none");
}

function renderScoreRing(lang: Lang, score: number, verdict: string): HTMLElement {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
  const ring = svgEl(
    "svg",
    { viewBox: "0 0 120 120", class: "ring-svg", "aria-hidden": "true" },
    svgEl("circle", { cx: 60, cy: 60, r: radius, class: "ring-track" }),
    svgEl("circle", {
      cx: 60,
      cy: 60,
      r: radius,
      class: "ring-progress",
      "stroke-dasharray": circumference.toFixed(2),
      "stroke-dashoffset": offset.toFixed(2),
      transform: "rotate(-90 60 60)",
    }),
  );
  const value = h(
    "div",
    { class: "ring-value" },
    h("span", { class: "ring-score", text: formatNumber(lang, score) }),
    h("span", { class: "ring-outof", text: t(lang, "hero.outOf") }),
  );
  return h(
    "div",
    { class: "ring", "data-verdict": verdictClass(verdict) },
    ring,
    h("div", { class: "ring-center" }, value, h("span", { class: "ring-label", text: t(lang, "hero.scoreLabel") })),
  );
}

function renderGates(lang: Lang, gates: string[]): HTMLElement {
  const list = h(
    "ul",
    { class: "gate-list" },
    ...gates.map((gate) =>
      h(
        "li",
        { class: "gate-item" },
        gateIcon(gate),
        h("span", { text: t(lang, MSG(`reason.gate.${gate}`)) }),
      ),
    ),
  );
  return h(
    "div",
    { class: "gates" },
    h(
      "div",
      { class: "gates-head" },
      makeIcon(ICONS.shieldAlert, 18),
      h("span", { text: t(lang, "reason.gatesTitle") }),
    ),
    list,
  );
}

function renderFactors(state: AppState, actions: Actions, animate: boolean): HTMLElement {
  const ev = state.evaluation!;
  const lang = state.lang;
  const sorted = [...ev.factors].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const items = sorted.map((factor, index) => {
    const band = bandFor(factor.impact);
    const meta = FACTOR_META[factor.id];
    // Riêng hàng "chói nắng theo hướng sân" mới nhận thêm hình sân thu gọn.
    const isSunBearing = factor.id === "sun_bearing";
    const valueText =
      factor.id === "is_day"
        ? factor.value === 1
          ? t(lang, "raw.day")
          : t(lang, "raw.night")
        : factor.unit === "bool"
          ? t(lang, "common.none")
          : `${formatNumber(lang, factor.value, { maximumFractionDigits: 1 })} ${unitText(lang, factor.unit)}`;
    // Thanh tác động: độ dài THẬT tính từ |impact| / maxWeight, không bịa.
    const bar = impactBar(factor.impact, meta ? meta.maxWeight : 0);
    const summary = h(
      "summary",
      { class: "factor-summary" },
      h("span", { class: `factor-icon band-${band}` }, factorIcon(factor.id, 20)),
      h("span", {
        class: "factor-label",
        text: t(lang, MSG(`factor.${factor.id}`)),
      }),
      h("span", { class: "factor-value", text: valueText }),
      h(
        "span",
        { class: "factor-impact" },
        h("span", { class: `impact-value side-${bar.side}`, text: signed(lang, factor.impact) }),
        h(
          "span",
          { class: "impact-track", "aria-hidden": "true" },
          h("span", { class: `impact-bar side-${bar.side}`, style: `width:${bar.widthPct}%` }),
        ),
      ),
    );
    // Hình minh hoạ sân giờ nằm trong NỘI DUNG MỞ RỘNG của ô, không còn ở dòng tóm tắt:
    // dòng tóm tắt chỉ còn nhãn + giá trị + tác động (thấp hơn trước), hình chỉ hiện khi
    // người dùng bấm mở ô. Module vẽ dùng chung vẫn là nguồn duy nhất → góc vẽ = phương vị thật.
    let rowFigure: HTMLElement | null = null;
    if (isSunBearing) {
      const rowDiagram = courtDiagram({
        bearing: state.courtBearing,
        sun: ev ? { azimuth: ev.sun.azimuth, elevation: ev.sun.elevation } : null,
        isDay: ev ? ev.point.is_day !== 0 : undefined,
        variant: "compact",
        ariaLabel: courtDiagramLabel(lang, ev, state.courtBearing),
        northLabel: t(lang, "compass.n"),
        noSunLabel: t(lang, "court.diagramNoSun"),
      });
      rowDiagram.setAttribute("style", "width:64px;height:64px;display:block");
      rowFigure = h(
        "span",
        {
          class: "factor-diagram",
          style: "display:flex;align-items:center;justify-content:center;width:64px;height:64px",
        },
        rowDiagram,
      );
    }
    const detail = h(
      "div",
      { class: "factor-detail" },
      rowFigure,
      h("p", { class: "factor-note", text: factorSentence(lang, factor.id, factor.impact) }),
      h(
        "dl",
        { class: "factor-meta" },
        h("div", {}, h("dt", { text: t(lang, "detail.value") }), h("dd", { text: valueText })),
        h("div", {}, h("dt", { text: t(lang, "detail.ideal") }), h("dd", { text: idealText(lang, factor.id) })),
        h(
          "div",
          {},
          h("dt", { text: t(lang, "detail.weight") }),
          h("dd", {
            text: meta
              ? `\u00b1${formatNumber(lang, meta.maxWeight)} ${t(lang, "detail.points")}`
              : t(lang, "common.none"),
          }),
        ),
        h("div", {}, h("dt", { text: t(lang, "detail.impact") }), h("dd", { text: `${signed(lang, factor.impact)} ${t(lang, "detail.points")}` })),
      ),
    );
    return h(
      "li",
      { class: `factor${animate ? " reveal" : ""}`, style: animate ? revealStyle(index) : undefined },
      h("details", {}, summary, detail),
    );
  });

  return h(
    "section",
    { class: "section reasons" },
    renderInfo(state, actions),
    ev.gates.length > 0 ? renderGates(lang, ev.gates) : null,
    h("ul", { class: "factor-list" }, ...items),
  );
}

function stat(label: string, value: string): HTMLElement {
  return h(
    "div",
    { class: "stat" },
    h("dt", { text: label }),
    h("dd", { text: value }),
  );
}

function renderRaw(state: AppState, actions: Actions): HTMLElement {
  const ev = state.evaluation!;
  const lang = state.lang;
  const p = ev.point;
  const n = (v: number | null, opts: Intl.NumberFormatOptions = {}) =>
    v === null ? t(lang, "common.none") : formatNumber(lang, v, opts);
  const u = (v: number | null, unit: string, opts: Intl.NumberFormatOptions = {}) =>
    v === null ? t(lang, "common.none") : `${formatNumber(lang, v, opts)} ${unit}`;
  const visibility = (v: number | null) =>
    v === null
      ? t(lang, "common.none")
      : v >= 1000
        ? `${formatNumber(lang, v / 1000, { maximumFractionDigits: 1 })} ${t(lang, "unit.km")}`
        : `${formatNumber(lang, v)} ${t(lang, "unit.meter")}`;

  // Chỉ dựng 21 ô "thông số thô" khi panel thực sự đang mở.
  const buildStats = (): HTMLElement[] => [
    stat(t(lang, "raw.temperature"), u(p.temperature_2m, t(lang, "unit.celsius"), { maximumFractionDigits: 1 })),
    stat(t(lang, "raw.apparent"), u(p.apparent_temperature, t(lang, "unit.celsius"), { maximumFractionDigits: 1 })),
    stat(t(lang, "raw.humidity"), u(p.relative_humidity_2m, t(lang, "unit.percent"))),
    stat(t(lang, "raw.dewPoint"), u(p.dew_point_2m, t(lang, "unit.celsius"), { maximumFractionDigits: 1 })),
    stat(t(lang, "raw.precipitation"), u(p.precipitation, t(lang, "unit.mm"), { maximumFractionDigits: 1 })),
    stat(t(lang, "raw.precipProbability"), u(p.precipitation_probability, t(lang, "unit.percent"))),
    stat(t(lang, "raw.rain"), u(p.rain, t(lang, "unit.mm"), { maximumFractionDigits: 1 })),
    stat(t(lang, "raw.weatherCode"), weatherText(lang, p.weather_code)),
    stat(t(lang, "raw.cloudCover"), u(p.cloud_cover, t(lang, "unit.percent"))),
    stat(t(lang, "raw.visibility"), visibility(p.visibility)),
    stat(t(lang, "raw.windSpeed"), u(p.wind_speed_10m, t(lang, "unit.kmh"), { maximumFractionDigits: 1 })),
    stat(t(lang, "raw.windGust"), u(p.wind_gusts_10m, t(lang, "unit.kmh"), { maximumFractionDigits: 1 })),
    stat(t(lang, "raw.uvIndex"), n(p.uv_index, { maximumFractionDigits: 1 })),
    stat(t(lang, "raw.isDay"), p.is_day === null ? t(lang, "common.none") : p.is_day === 1 ? t(lang, "raw.day") : t(lang, "raw.night")),
    stat(t(lang, "raw.sunElevation"), u(ev.sun.elevation, t(lang, "unit.deg"), { maximumFractionDigits: 1 })),
    stat(t(lang, "raw.sunAzimuth"), u(ev.sun.azimuth, t(lang, "unit.deg"), { maximumFractionDigits: 0 })),
    stat(t(lang, "raw.sunrise"), ev.sunrise ? formatClock(lang, ev.sunrise) : t(lang, "common.none")),
    stat(t(lang, "raw.sunset"), ev.sunset ? formatClock(lang, ev.sunset) : t(lang, "common.none")),
    stat(t(lang, "raw.pm25"), u(ev.pm25, t(lang, "unit.ugm3"), { maximumFractionDigits: 1 })),
    stat(t(lang, "raw.pm10"), u(ev.pm10, t(lang, "unit.ugm3"), { maximumFractionDigits: 1 })),
    stat(t(lang, "raw.europeanAqi"), n(ev.aqi)),
  ];

  return h(
    "section",
    { class: "section raw" },
    h(
      "button",
      {
        class: "raw-toggle",
        type: "button",
        "aria-expanded": state.rawOpen ? "true" : "false",
        onclick: actions.toggleRaw,
      },
      h("span", { text: t(lang, state.rawOpen ? "panel.hideRaw" : "panel.showRaw") }),
      makeIcon(ICONS.chevronDown, 18, state.rawOpen ? "rotate" : ""),
    ),
    state.rawOpen ? h("dl", { class: "stat-grid" }, ...buildStats()) : null,
  );
}

function renderStatus(state: AppState, actions: Actions): HTMLElement | null {
  const lang = state.lang;
  if (state.status === "loading" && !state.evaluation) {
    return h(
      "section",
      { class: "section status loading" },
      h(
        "div",
        { class: "skeleton-hero" },
        h("div", { class: "skeleton skeleton-ring" }),
        h("div", { class: "skeleton skeleton-hero-meta" }),
      ),
      h("div", { class: "skeleton skeleton-line" }),
      h("div", { class: "skeleton skeleton-line short" }),
      h("p", {
        class: "status-text",
        text: t(lang, "status.loadingHost", { host: hostOf(state.baseUrls.forecastBase) }),
      }),
    );
  }
  if (state.status === "error" && !state.evaluation) {
    return h(
      "div",
      { class: "error-panel", role: "alert" },
      makeIcon(ICONS.warning, 24),
      h("h2", { text: t(lang, "status.errorTitle") }),
      h("p", { text: state.error ?? t(lang, "status.errorBody") }),
      h("button", { class: "btn primary", type: "button", onclick: actions.refresh }, t(lang, "status.retry")),
    );
  }
  return null;
}

function renderUpdateBanner(state: AppState, actions: Actions): HTMLElement | null {
  if (!state.update.available || state.update.dismissed) return null;
  const lang = state.lang;
  return h(
    "div",
    { class: "banner update", role: "status" },
    makeIcon(ICONS.refresh, 16),
    h("span", { text: t(lang, "build.updateAvailable") }),
    h(
      "button",
      { class: "btn primary compact", type: "button", onclick: actions.applyUpdate },
      t(lang, "build.updateReload"),
    ),
    h(
      "button",
      {
        class: "banner-dismiss",
        type: "button",
        "aria-label": t(lang, "build.updateDismiss"),
        onclick: actions.dismissUpdate,
      },
      makeIcon(ICONS.close, 16),
    ),
  );
}

function renderBanner(state: AppState): HTMLElement | null {
  const lang = state.lang;
  const ev = state.evaluation;
  if (!ev) return null;
  const parts: HTMLElement[] = [];
  if (state.offline) {
    parts.push(
      h(
        "div",
        { class: "banner offline" },
        makeIcon(ICONS.info, 16),
        h("span", { text: t(lang, "status.offline") }),
      ),
    );
  }
  if (state.stale) {
    parts.push(
      h(
        "div",
        { class: "banner stale" },
        makeIcon(ICONS.refresh, 16),
        h("span", { text: `${t(lang, "status.stale")} · ${t(lang, "status.staleHint", { time: fetchedLabel(lang, ev.dataSource.fetchedAt) })}` }),
      ),
    );
  }
  if (state.status === "error" && state.error) {
    parts.push(
      h(
        "div",
        { class: "banner error" },
        makeIcon(ICONS.warning, 16),
        h("span", { text: state.error }),
      ),
    );
  }
  if (ev.missing.length > 0) {
    const missingLabels = ev.missing
      .map((id) => (id === "rain_24h_partial" ? t(lang, "factor.rain_24h") : t(lang, MSG(`factor.${id}`))))
      .join(", ");
    parts.push(
      h(
        "div",
        { class: "banner missing" },
        makeIcon(ICONS.info, 16),
        h("span", { text: t(lang, "status.missingBody", { list: missingLabels }) }),
      ),
    );
  }
  if (parts.length === 0) return null;
  return h("div", { class: "banners" }, ...parts);
}

function renderFooter(state: AppState): HTMLElement {
  const lang = state.lang;
  const ev = state.evaluation;
  return h(
    "footer",
    { class: "footer" },
    h(
      "div",
      { class: "footer-sources" },
      h("span", { class: "footer-label", text: t(lang, "footer.source") }),
      h("span", { text: `${t(lang, "footer.forecast")}: ${hostOf(state.baseUrls.forecastBase)}` }),
      h("span", { text: `${t(lang, "footer.air")}: ${hostOf(state.baseUrls.airQualityBase)}` }),
    ),
    h(
      "div",
      { class: "footer-meta" },
      h("span", {
        text: `${t(lang, "footer.fetched")}: ${ev ? fetchedLabel(lang, ev.dataSource.fetchedAt) : t(lang, "common.none")}`,
      }),
      h("span", { text: `${t(lang, "footer.timezone")}: ${APP_TIMEZONE}` }),
    ),
  );
}

/**
 * Khối thông tin: tên sân, toạ độ ĐANG DÙNG + độ lệch UTC, mốc giờ đang tính.
 *
 * Trước đây là `<header class="appbar">` GHIM ở đỉnh màn hình. Chủ dự án đã yêu cầu bỏ hẳn thanh
 * đó (trên iPhone nó bị vệt mờ ở đỉnh) và dời nội dung xuống đúng chỗ tiêu đề "Vì sao điểm này?"
 * + phụ đề của nó — tức là ngay trên danh sách yếu tố. Khối này nằm TRONG LUỒNG trang (không
 * sticky/fixed) nên không còn gì neo ở đỉnh; nền ĐỤC màu surface nên không lớp nào vẽ lên chữ.
 * Dòng tóm tắt verdict ("Nên đi · 86/100") đã bị bỏ khỏi khối: verdict đã có khu hero riêng.
 */
function renderInfo(state: AppState, actions: Actions): HTMLElement {
  const lang = state.lang;
  // Toạ độ ĐANG DÙNG (lấy từ state đã áp dụng, không phải tên địa điểm): khối này phải cho biết
  // app đang thực sự tính cho chỗ nào, kể cả khi tên còn là của lần chọn trước.
  const coords = `${state.location.lat.toFixed(4)}, ${state.location.lon.toFixed(4)}`;
  // Nhãn offset suy từ chính mốc giờ đang tính (targetHour) nên đúng cả khi DST đổi.
  // targetHour có thể đến thẳng từ tham số URL `at` và không hợp lệ (`?at=14` -> "14:00"); khi đó
  // bỏ nhãn offset thay vì để lỗi làm chết cả render() (màn hình trắng).
  let offset: string | null = null;
  try {
    offset = formatUtcOffset(getOffsetMinutes(zonedToUtc(state.targetHour)));
  } catch {
    offset = null;
  }
  // Dòng ngày/giờ KHÔNG còn nằm bên phải khối: nó xuống dòng riêng NGAY DƯỚI địa điểm
  // (DOM order: .infobar-loc rồi .infobar-time) nên mốc giờ không cạnh tranh chỗ với tên sân
  // dài, và toạ độ vẫn nằm gọn trong khối địa điểm.
  return h(
    "section",
    { class: "infobar" },
    h(
      "div",
      { class: "infobar-row" },
      h(
        "button",
        {
          class: "infobar-loc",
          type: "button",
          "aria-label": t(lang, "header.changeLocation"),
          onclick: () => actions.openSheet("location"),
        },
        h(
          "span",
          { class: "infobar-loc-text" },
          h("span", { class: "infobar-loc-name", text: state.location.name }),
          h("span", { class: "infobar-coords", title: t(lang, "header.usingLocation"), text: coords }),
        ),
        makeIcon(ICONS.chevronDown, 14),
      ),
    ),
    h(
      "span",
      { class: "infobar-time" },
      h("span", { class: "infobar-time-value", text: formatDateTime(lang, state.targetHour) }),
      offset === null
        ? null
        : h("span", { class: "infobar-offset", title: t(lang, "time.offset"), text: `(${offset})` }),
    ),
  );
}

function renderActionBar(state: AppState, actions: Actions): HTMLElement {
  const lang = state.lang;
  return h(
    "nav",
    { class: "actionbar" },
    h(
      "button",
      {
        class: "btn primary actionbar-adjust",
        type: "button",
        "aria-label": t(lang, "sheet.open"),
        onclick: () => actions.openSheet("inputs"),
      },
      makeIcon(ICONS.sliders, 18),
      h("span", { text: t(lang, "appbar.adjust") }),
    ),
    h(
      "button",
      { class: "btn ghost actionbar-refresh", type: "button", onclick: actions.refresh },
      makeIcon(state.fetching ? ICONS.loader : ICONS.refresh, 16, state.fetching ? "spin" : ""),
      h("span", { text: t(lang, "footer.refresh") }),
    ),
  );
}

function renderHero(state: AppState, animate: boolean): HTMLElement {
  const ev = state.evaluation!;
  const lang = state.lang;
  return h(
    "section",
    {
      class: `hero${animate ? " reveal" : ""}`,
      style: animate ? revealStyle(0) : undefined,
      dataset: { verdict: verdictClass(ev.verdict) },
    },
    renderScoreRing(lang, ev.score, ev.verdict),
    h(
      "div",
      { class: "hero-meta" },
      h("span", { class: `verdict-badge band-${verdictClass(ev.verdict)}`, text: verdictLabel(lang, ev.verdict) }),
      h("span", {
        class: "confidence",
        text: `${t(lang, "status.confidence")}: ${confidenceLabel(lang, ev.confidence)}`,
      }),
    ),
  );
}

function field(label: string, input: HTMLElement): HTMLElement {
  return h("label", { class: "field" }, h("span", { class: "field-label", text: label }), input);
}

function geoResults(state: AppState, actions: Actions): HTMLElement | null {
  const lang = state.lang;
  if (state.geoStatus === "loading") {
    const text =
      state.geoError === "locate" ? t(lang, "location.locating") : t(lang, "location.searching");
    return h("p", { class: "sheet-note", text });
  }
  if (state.geoResults.length > 0) {
    return h(
      "div",
      { class: "geo-results" },
      h("span", { class: "field-label", text: t(lang, "location.resultsTitle") }),
      ...state.geoResults.map((r) =>
        h(
          "button",
          { class: "geo-result", type: "button", onclick: () => actions.chooseGeoResult(r) },
          makeIcon(ICONS.mapPin, 16),
          h(
            "span",
            {},
            h("span", { class: "geo-name", text: r.name }),
            h("span", { class: "geo-sub", text: [r.admin1, r.country].filter(Boolean).join(", ") }),
          ),
        ),
      ),
    );
  }
  if (state.geoStatus === "done") {
    return h("p", { class: "sheet-note", text: t(lang, "location.noResults") });
  }
  if (state.geoStatus === "error") {
    const text =
      state.geoError === "search" ? t(lang, "location.searchFailed") : t(lang, "location.geoDenied");
    return h("p", { class: "sheet-note error-text", text });
  }
  return null;
}

function renderLocationSheet(state: AppState, actions: Actions): Child[] {
  const lang = state.lang;
  return [
    h(
      "div",
      { class: "search-row" },
      h("input", {
        type: "search",
        class: "input",
        placeholder: t(lang, "location.searchPlaceholder"),
        value: state.searchQuery,
        oninput: (e: Event) => actions.setSearchQuery((e.target as HTMLInputElement).value),
        onfocus: focusScroll,
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === "Enter") actions.runSearch();
        },
      }),
      h(
        "button",
        { class: "btn primary", type: "button", onclick: actions.runSearch },
        makeIcon(ICONS.search, 16),
        h("span", { text: t(lang, "location.search") }),
      ),
    ),
    geoResults(state, actions),
    h("div", { class: "divider" }),
    field(
      t(lang, "location.nameLabel"),
      h("input", {
        type: "text",
        class: "input",
        value: state.draft.name,
        oninput: (e: Event) => actions.patchDraft({ name: (e.target as HTMLInputElement).value }),
        onfocus: focusScroll,
      }),
    ),
    h(
      "div",
      { class: "field-row" },
      field(
        t(lang, "location.latLabel"),
        h("input", {
          type: "number",
          inputmode: "decimal",
          step: "any",
          class: "input",
          value: Number.isFinite(state.draft.lat) ? String(state.draft.lat) : "",
          oninput: (e: Event) => actions.patchDraft({ lat: parseCoordInput((e.target as HTMLInputElement).value) }),
          onfocus: focusScroll,
        }),
      ),
      field(
        t(lang, "location.lonLabel"),
        h("input", {
          type: "number",
          inputmode: "decimal",
          step: "any",
          class: "input",
          value: Number.isFinite(state.draft.lon) ? String(state.draft.lon) : "",
          oninput: (e: Event) => actions.patchDraft({ lon: parseCoordInput((e.target as HTMLInputElement).value) }),
          onfocus: focusScroll,
        }),
      ),
    ),
    h(
      "button",
      { class: "btn ghost full", type: "button", onclick: actions.locateMe },
      makeIcon(ICONS.locate, 16),
      h("span", { text: t(lang, "location.useMyLocation") }),
    ),
    state.applyErrorKey === "location.invalidCoords"
      ? h("p", {
          class: "sheet-note error-text apply-error",
          text: t(lang, "location.invalidCoords"),
        })
      : null,
    h(
      "button",
      { class: "btn primary full", type: "button", onclick: actions.applyLocation },
      t(lang, "location.apply"),
    ),
  ];
}

function segmented<T extends string>(
  options: { value: T; label: string; icon?: SVGElement }[],
  current: T,
  onSelect: (value: T) => void,
): HTMLElement {
  return h(
    "div",
    { class: "segmented", role: "radiogroup" },
    ...options.map((option) =>
      h(
        "button",
        {
          class: `segment${option.value === current ? " active" : ""}`,
          type: "button",
          role: "radio",
          "aria-checked": option.value === current ? "true" : "false",
          onclick: () => onSelect(option.value),
        },
        option.icon ?? null,
        h("span", { text: option.label }),
      ),
    ),
  );
}

function renderBuildBlock(state: AppState, actions: Actions): HTMLElement {
  const lang = state.lang;
  const status = state.updateCheck?.status ?? "idle";
  // Mỗi kết quả kiểm tra đều có ĐÚNG một câu trả lời cho người dùng; "idle" để trống.
  const resultText =
    status === "checking"
      ? t(lang, "build.checking")
      : status === "current"
        ? t(lang, "build.upToDate")
        : status === "unsupported"
          ? t(lang, "build.checkUnsupported")
          : status === "error"
            ? t(lang, "build.checkFailed")
            : status === "available"
              ? t(lang, "build.updateAvailable")
              : "";
  return h(
    "div",
    { class: "setting-block" },
    h("span", { class: "field-label", text: t(lang, "build.title") }),
    // Marker KHÔNG có class sheet-note: ăn cỡ chữ 16px và màu --text kế thừa từ body.
    h(
      "p",
      { class: "build-marker", dataset: { buildMarker: "1" } },
      `${BUILD_ID} · ${t(lang, "build.builtAt", {
        time: BUILD_TIME ? formatDateTime(lang, BUILD_TIME.slice(0, 16)) : t(lang, "common.none"),
      })}`,
    ),
    h(
      "button",
      {
        class: "btn ghost full",
        type: "button",
        dataset: { buildCheck: "1" },
        onclick: actions.checkUpdate,
      },
      makeIcon(ICONS.refresh, 16),
      h("span", { text: t(lang, "build.checkUpdate") }),
    ),
    h("p", {
      class: "build-check-result",
      role: "status",
      "aria-live": "polite",
      text: resultText,
    }),
    status === "available"
      ? h(
          "button",
          {
            class: "btn primary full",
            type: "button",
            dataset: { buildReload: "1" },
            onclick: actions.applyUpdate,
          },
          t(lang, "build.updateReload"),
        )
      : null,
  );
}

function renderInputsSheet(state: AppState, actions: Actions): HTMLElement[] {
  const lang = state.lang;
  const bearingValue = h("span", {
    class: "bearing-value",
    text: `${formatNumber(lang, state.courtBearing)}${t(lang, "unit.deg")}`,
  });
  const ev = state.evaluation;
  const courtSvg = courtDiagram({
    bearing: state.courtBearing,
    sun: ev ? { azimuth: ev.sun.azimuth, elevation: ev.sun.elevation } : null,
    isDay: ev ? ev.point.is_day !== 0 : undefined,
    variant: "full",
    ariaLabel: courtDiagramLabel(lang, ev, state.courtBearing),
    northLabel: t(lang, "compass.n"),
    noSunLabel: t(lang, "court.diagramNoSun"),
  });
  return [
    // Khối phiên bản đứng ĐẦU sheet (ngay sau h2.sheet-title) để luôn thấy mà không phải cuộn.
    renderBuildBlock(state, actions),
    h(
      "div",
      { class: "setting-block" },
      h("span", { class: "field-label", text: t(lang, "time.title") }),
      field(
        t(lang, "time.label"),
        h("input", {
          type: "datetime-local",
          class: "input",
          step: "3600",
          value: state.atInput,
          oninput: (e: Event) => actions.setAtInput((e.target as HTMLInputElement).value),
          onfocus: focusScroll,
        }),
      ),
      h(
        "button",
        { class: "btn ghost full", type: "button", onclick: actions.useNextHour },
        makeIcon(ICONS.calendar, 16),
        h("span", { text: t(lang, "time.nextHour") }),
      ),
      h("p", { class: "sheet-note", text: `${t(lang, "time.local")}: ${APP_TIMEZONE}` }),
      state.applyErrorKey === "time.invalidTime"
        ? h("p", { class: "sheet-note error-text apply-error", text: t(lang, "time.invalidTime") })
        : null,
      h("button", { class: "btn primary full", type: "button", onclick: actions.applyTime }, t(lang, "time.apply")),
    ),
    h(
      "div",
      { class: "setting-block" },
      h("span", { class: "field-label", text: t(lang, "court.title") }),
      h(
        "div",
        { class: "bearing-row" },
        h("input", {
          type: "range",
          min: "0",
          max: "359",
          step: "1",
          value: String(state.courtBearing),
          class: "range",
          "aria-label": t(lang, "court.bearing"),
          // Cập nhật nhãn VÀ xoay hình ngay khi kéo (KHÔNG render lại DOM giữa cử chỉ),
          // chỉ chốt state lúc nhả tay để thanh trượt không bị huỷ.
          oninput: (e: Event) => {
            const value = Number((e.target as HTMLInputElement).value);
            bearingValue.textContent = `${formatNumber(lang, value)}${t(lang, "unit.deg")}`;
            rotateCourtDiagram(courtSvg, value, courtDiagramLabel(lang, ev, value));
          },
          onchange: (e: Event) => actions.setBearing(Number((e.target as HTMLInputElement).value)),
          onfocus: focusScroll,
        }),
        bearingValue,
      ),
      courtSvg,
    ),
    h(
      "div",
      { class: "setting-block" },
      h(
        "button",
        {
          class: "toggle-row",
          type: "button",
          role: "switch",
          "aria-checked": state.lights ? "true" : "false",
          onclick: () => actions.setLights(!state.lights),
        },
        h(
          "span",
          { class: "toggle-text" },
          h("span", { class: "toggle-title", text: t(lang, "court.lights") }),
          h("span", { class: "toggle-sub", text: t(lang, "court.lightsHint") }),
        ),
        h("span", { class: `switch${state.lights ? " on" : ""}` }, h("span", { class: "knob" })),
      ),
    ),
    h(
      "div",
      { class: "setting-block" },
      h("span", { class: "field-label", text: t(lang, "lang.title") }),
      segmented<Lang>(
        [
          { value: "vi", label: t(lang, "lang.vi") },
          { value: "de", label: t(lang, "lang.de") },
          { value: "en", label: t(lang, "lang.en") },
        ],
        state.lang,
        actions.setLang,
      ),
    ),
    h(
      "div",
      { class: "setting-block" },
      h("span", { class: "field-label", text: t(lang, "theme.title") }),
      segmented<AppState["theme"]>(
        [
          { value: "system", label: t(lang, "theme.system"), icon: makeIcon(ICONS.gauge, 15) },
          { value: "light", label: t(lang, "theme.light"), icon: makeIcon(ICONS.sun, 15) },
          { value: "dark", label: t(lang, "theme.dark"), icon: makeIcon(ICONS.moon, 15) },
        ],
        state.theme,
        actions.setTheme,
      ),
    ),
    h(
      "button",
      {
        class: "btn ghost full",
        type: "button",
        dataset: { sheetOpener: "location" },
        onclick: () => actions.openSheet("location"),
      },
      makeIcon(ICONS.mapPin, 16),
      h("span", { text: t(lang, "header.changeLocation") }),
    ),
  ];
}

/** Panel đã render lần trước — để keyframes chỉ chạy khi sheet THẬT SỰ mở. */
let lastSheetPanel: SheetPanel = "none";

function renderSheet(state: AppState, actions: Actions): HTMLElement | null {
  const lang = state.lang;
  const panel = state.sheet.panel;
  const entering = panel !== "none" && panel !== lastSheetPanel;
  lastSheetPanel = panel;
  if (panel === "none") return null;
  // Độ lệch kéo tay được ĐỌC TỪ STATE: re-render giữa chừng (mở details, đổi giờ…) không nuốt mất nó.
  const drag = dragVisual(state.sheet.dragOffsetPx);
  const isLocation = panel === "location";
  const body = isLocation ? renderLocationSheet(state, actions) : renderInputsSheet(state, actions);
  return h(
    "div",
    {
      class: "sheet-backdrop",
      // Khi offset = 0 thì KHÔNG gắn style, để animation `sheet-enter` chạy nguyên như cũ.
      style: drag.offsetPx > 0 ? `opacity: ${drag.backdropOpacity}` : undefined,
      onclick: (e: MouseEvent) => {
        if (e.target === e.currentTarget) actions.closeSheet();
      },
    },
    h(
      "div",
      {
        class: `sheet-wrap${entering ? " sheet-enter" : ""}`,
        style: drag.offsetPx > 0 ? `transform: translateY(${drag.offsetPx}px)` : undefined,
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "sheet-title",
      },
      h(
        "div",
        { class: "sheet-grab", role: "separator", "aria-label": t(lang, "sheet.grabber") },
        h("div", { class: "sheet-handle", "aria-hidden": "true" }),
        h("span", { class: "sheet-drag-hint", text: t(lang, "sheet.dragHint") }),
      ),
      h(
        "button",
        { class: "sheet-close", type: "button", "aria-label": t(lang, "common.close"), onclick: actions.closeSheet },
        makeIcon(ICONS.close, 18),
      ),
      h(
        "div",
        { class: "sheet" },
        h("h2", { class: "sheet-title", id: "sheet-title", text: isLocation ? t(lang, "location.title") : t(lang, "sheet.title") }),
        ...body,
      ),
    ),
  );
}

export function renderApp(root: HTMLElement, state: AppState, actions: Actions): void {
  root.textContent = "";
  const ev = state.evaluation;
  const animate = ev !== null && !revealed;

  const main = h(
    "main",
    { class: "main" },
    renderUpdateBanner(state, actions),
    renderBanner(state),
    ev ? renderHero(state, animate) : renderStatus(state, actions),
    ev ? renderFactors(state, actions, animate) : renderInfo(state, actions),
    ev ? renderRaw(state, actions) : null,
  );

  const app = h(
    "div",
    { class: "app", dataset: { lang: state.lang } },
    main,
    renderFooter(state),
    renderActionBar(state, actions),
  );

  root.appendChild(app);
  const sheet = renderSheet(state, actions);
  if (sheet) root.appendChild(sheet);

  // Chỉ đánh dấu đã reveal SAU khi gắn DOM của kết quả đầu tiên.
  if (animate) revealed = true;
}
