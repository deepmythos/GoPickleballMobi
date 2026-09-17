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
import { formatUtcOffset, APP_TIMEZONE, formatLocalISO } from "../time";
import { BUILD_ID, BUILD_TIME } from "../build";
import type { Lang } from "../types";
import { factorIcon, gateIcon, makeIcon, ICONS } from "./icons";
import type { Actions, AppState } from "./state";

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
  return key ? t(lang, key) : "—";
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

function renderFactors(state: AppState): HTMLElement {
  const ev = state.evaluation!;
  const lang = state.lang;
  const sorted = [...ev.factors].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const items = sorted.map((factor) => {
    const band = bandFor(factor.impact);
    const meta = FACTOR_META[factor.id];
    const valueText =
      factor.id === "is_day"
        ? factor.value === 1
          ? t(lang, "raw.day")
          : t(lang, "raw.night")
        : factor.unit === "bool"
          ? "—"
          : `${formatNumber(lang, factor.value, { maximumFractionDigits: 1 })} ${factor.unit}`;
    const summary = h(
      "summary",
      { class: "factor-summary" },
      h("span", { class: `factor-icon band-${band}` }, factorIcon(factor.id, 20)),
      h(
        "span",
        { class: "factor-main" },
        h("span", { class: "factor-label", text: t(lang, MSG(`factor.${factor.id}`)) }),
        h("span", { class: "factor-value", text: valueText }),
      ),
      h(
        "span",
        { class: `impact-chip band-${band}`, dataset: { impact: String(factor.impact) } },
        makeIcon(factor.impact > 0 ? ICONS.arrowUp : factor.impact < 0 ? ICONS.arrowDown : ICONS.minus, 14),
        h("span", { text: signed(lang, factor.impact) }),
      ),
    );
    const detail = h(
      "div",
      { class: "factor-detail" },
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
              : "—",
          }),
        ),
        h("div", {}, h("dt", { text: t(lang, "detail.impact") }), h("dd", { text: `${signed(lang, factor.impact)} ${t(lang, "detail.points")}` })),
      ),
    );
    return h("li", { class: "factor" }, h("details", {}, summary, detail));
  });

  return h(
    "section",
    { class: "section reasons" },
    h("div", { class: "section-head" }, h("h2", { text: t(lang, "reason.title") })),
    h("p", { class: "section-sub", text: t(lang, "reason.subtitle") }),
    ev.gates.length > 0 ? renderGates(lang, ev.gates) : null,
    h("ul", { class: "factor-list" }, ...items),
    h("p", { class: "hint", text: t(lang, "reason.tapHint") }),
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

function renderRaw(state: AppState): HTMLElement {
  const ev = state.evaluation!;
  const lang = state.lang;
  const p = ev.point;
  const n = (v: number | null, opts: Intl.NumberFormatOptions = {}) =>
    v === null ? "—" : formatNumber(lang, v, opts);
  const u = (v: number | null, unit: string, opts: Intl.NumberFormatOptions = {}) =>
    v === null ? "—" : `${formatNumber(lang, v, opts)} ${unit}`;
  const visibility = (v: number | null) =>
    v === null
      ? "—"
      : v >= 1000
        ? `${formatNumber(lang, v / 1000, { maximumFractionDigits: 1 })} km`
        : `${formatNumber(lang, v)} m`;

  return h(
    "section",
    { class: "section raw" },
    h("div", { class: "section-head" }, h("h2", { text: t(lang, "raw.title") })),
    h("p", { class: "section-sub", text: t(lang, "raw.subtitle") }),
    h(
      "dl",
      { class: "stat-grid" },
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
      stat(t(lang, "raw.isDay"), p.is_day === null ? "—" : p.is_day === 1 ? t(lang, "raw.day") : t(lang, "raw.night")),
      stat(t(lang, "raw.sunElevation"), u(ev.sun.elevation, t(lang, "unit.deg"), { maximumFractionDigits: 1 })),
      stat(t(lang, "raw.sunAzimuth"), u(ev.sun.azimuth, t(lang, "unit.deg"), { maximumFractionDigits: 0 })),
      stat(t(lang, "raw.sunrise"), ev.sunrise ? formatClock(lang, ev.sunrise) : "—"),
      stat(t(lang, "raw.sunset"), ev.sunset ? formatClock(lang, ev.sunset) : "—"),
      stat(t(lang, "raw.pm25"), u(ev.pm25, "µg/m³", { maximumFractionDigits: 1 })),
      stat(t(lang, "raw.pm10"), u(ev.pm10, "µg/m³", { maximumFractionDigits: 1 })),
      stat(t(lang, "raw.europeanAqi"), n(ev.aqi)),
    ),
  );
}

function renderAssumptions(state: AppState): HTMLElement {
  const lang = state.lang;
  const items: string[] = [
    state.lights ? t(lang, "assumption.lights") : t(lang, "assumption.noLights"),
    t(lang, "assumption.rain24h"),
    t(lang, "assumption.hourly"),
    t(lang, "assumption.utc"),
    t(lang, "assumption.courtBearing"),
  ];
  return h(
    "section",
    { class: "section assumptions" },
    h("div", { class: "section-head" }, makeIcon(ICONS.info, 18), h("h2", { text: t(lang, "assumption.title") })),
    h("ul", { class: "assumption-list" }, ...items.map((text) => h("li", { text }))),
  );
}

function renderStatus(state: AppState, actions: Actions): HTMLElement | null {
  const lang = state.lang;
  if (state.status === "loading" && !state.evaluation) {
    return h(
      "section",
      { class: "section status loading" },
      h("div", { class: "skeleton skeleton-hero" }),
      h("div", { class: "skeleton skeleton-line" }),
      h("div", { class: "skeleton skeleton-line short" }),
      h("p", { class: "status-text", text: t(lang, "status.loading") }),
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

function renderFooter(state: AppState, actions: Actions): HTMLElement {
  const lang = state.lang;
  const ev = state.evaluation;
  const host = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  };
  return h(
    "footer",
    { class: "footer" },
    h(
      "div",
      { class: "footer-row" },
      h(
        "div",
        { class: "footer-sources" },
        h("span", { class: "footer-label", text: t(lang, "footer.source") }),
        h("span", { text: `${t(lang, "footer.forecast")}: ${host(state.baseUrls.forecastBase)}` }),
        h("span", { text: `${t(lang, "footer.air")}: ${host(state.baseUrls.airQualityBase)}` }),
      ),
      h(
        "button",
        {
          class: "btn ghost",
          type: "button",
          onclick: actions.refresh,
          "aria-label": t(lang, "footer.refresh"),
        },
        makeIcon(state.fetching ? ICONS.loader : ICONS.refresh, 16, state.fetching ? "spin" : ""),
        h("span", { text: t(lang, state.fetching ? "status.refreshing" : "footer.refresh") }),
      ),
    ),
    h(
      "div",
      { class: "footer-meta" },
      h("span", {
        text: `${t(lang, "footer.fetched")}: ${ev ? fetchedLabel(lang, ev.dataSource.fetchedAt) : "—"}`,
      }),
      h("span", { text: `${t(lang, "footer.timezone")}: Europe/Berlin` }),
    ),
  );
}

function renderHeader(state: AppState, actions: Actions): HTMLElement {
  const lang = state.lang;
  const nextLang: Record<Lang, Lang> = { vi: "de", de: "en", en: "vi" };
  return h(
    "header",
    { class: "topbar" },
    h(
      "button",
      {
        class: "loc-button",
        type: "button",
        onclick: () => actions.openPanel("location"),
        "aria-label": t(lang, "header.changeLocation"),
      },
      makeIcon(ICONS.mapPin, 18),
      h(
        "span",
        { class: "loc-text" },
        h("span", { class: "loc-name", text: state.location.name }),
        h("span", {
          class: "loc-coords",
          text: `${formatNumber(lang, state.location.lat, { maximumFractionDigits: 4 })}, ${formatNumber(lang, state.location.lon, { maximumFractionDigits: 4 })}`,
        }),
      ),
      h("span", { class: "loc-chevron" }, makeIcon(ICONS.chevronDown, 16)),
    ),
    h(
      "div",
      { class: "topbar-actions" },
      h(
        "button",
        {
          class: "chip-button",
          type: "button",
          onclick: () => actions.setLang(nextLang[state.lang]),
          "aria-label": t(lang, "lang.title"),
        },
        makeIcon(ICONS.globe, 16),
        h("span", { text: state.lang.toUpperCase() }),
      ),
      h(
        "button",
        {
          class: "icon-button",
          type: "button",
          onclick: () => actions.openPanel("settings"),
          "aria-label": t(lang, "header.settings"),
        },
        makeIcon(ICONS.settings, 18),
      ),
    ),
  );
}

function renderTimebar(state: AppState, actions: Actions): HTMLElement {
  const lang = state.lang;
  const ev = state.evaluation;
  const offset = ev ? formatUtcOffset(ev.utcOffsetMinutes) : "";
  return h(
    "section",
    { class: "timebar" },
    h(
      "button",
      {
        class: "time-button",
        type: "button",
        onclick: () => actions.openPanel("time"),
        "aria-label": t(lang, "header.changeTime"),
      },
      makeIcon(ICONS.calendar, 18),
      h(
        "span",
        { class: "time-text" },
        h("span", { class: "time-main", text: formatDateTime(lang, state.targetHour) }),
        offset ? h("span", { class: "time-offset", text: offset }) : null,
      ),
      makeIcon(ICONS.chevronDown, 16),
    ),
  );
}

function renderHero(state: AppState): HTMLElement {
  const ev = state.evaluation!;
  const lang = state.lang;
  return h(
    "section",
    { class: "hero", dataset: { verdict: verdictClass(ev.verdict) } },
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

function renderLocationSheet(state: AppState, actions: Actions): HTMLElement {
  const lang = state.lang;
  const results =
    state.geoStatus === "loading"
      ? h("p", { class: "sheet-note", text: t(lang, "location.searching") })
      : state.geoResults.length > 0
        ? h(
            "div",
            { class: "geo-results" },
            h("span", { class: "field-label", text: t(lang, "location.resultsTitle") }),
            ...state.geoResults.map((r) =>
              h(
                "button",
                {
                  class: "geo-result",
                  type: "button",
                  onclick: () => actions.chooseGeoResult(r),
                },
                makeIcon(ICONS.mapPin, 16),
                h(
                  "span",
                  {},
                  h("span", { class: "geo-name", text: r.name }),
                  h("span", {
                    class: "geo-sub",
                    text: [r.admin1, r.country].filter(Boolean).join(", "),
                  }),
                ),
              ),
            ),
          )
        : state.geoStatus === "done"
          ? h("p", { class: "sheet-note", text: t(lang, "location.noResults") })
          : state.geoStatus === "error"
            ? h("p", { class: "sheet-note error-text", text: t(lang, "location.geoDenied") })
            : null;

  return h(
    "div",
    { class: "sheet" },
    h("div", { class: "sheet-handle" }),
    h("h2", { class: "sheet-title", text: t(lang, "location.title") }),
    h(
      "div",
      { class: "search-row" },
      h("input", {
        type: "search",
        class: "input",
        placeholder: t(lang, "location.searchPlaceholder"),
        value: state.searchQuery,
        oninput: (e: Event) => actions.setSearchQuery((e.target as HTMLInputElement).value),
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
    results,
    h("div", { class: "divider" }),
    field(
      t(lang, "location.nameLabel"),
      h("input", {
        type: "text",
        class: "input",
        value: state.draft.name,
        oninput: (e: Event) => actions.patchDraft({ name: (e.target as HTMLInputElement).value }),
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
          value: String(state.draft.lat),
          oninput: (e: Event) => actions.patchDraft({ lat: Number((e.target as HTMLInputElement).value) }),
        }),
      ),
      field(
        t(lang, "location.lonLabel"),
        h("input", {
          type: "number",
          inputmode: "decimal",
          step: "any",
          class: "input",
          value: String(state.draft.lon),
          oninput: (e: Event) => actions.patchDraft({ lon: Number((e.target as HTMLInputElement).value) }),
        }),
      ),
    ),
    h(
      "button",
      { class: "btn ghost full", type: "button", onclick: actions.locateMe },
      makeIcon(ICONS.locate, 16),
      h("span", { text: t(lang, "location.useMyLocation") }),
    ),
    h(
      "button",
      { class: "btn primary full", type: "button", onclick: actions.applyLocation },
      t(lang, "location.apply"),
    ),
  );
}

function renderTimeSheet(state: AppState, actions: Actions): HTMLElement {
  const lang = state.lang;
  return h(
    "div",
    { class: "sheet" },
    h("div", { class: "sheet-handle" }),
    h("h2", { class: "sheet-title", text: t(lang, "time.title") }),
    field(
      t(lang, "time.label"),
      h("input", {
        type: "datetime-local",
        class: "input",
        step: "3600",
        value: state.atInput,
        oninput: (e: Event) => actions.setAtInput((e.target as HTMLInputElement).value),
      }),
    ),
    h(
      "button",
      { class: "btn ghost full", type: "button", onclick: actions.useNextHour },
      makeIcon(ICONS.calendar, 16),
      h("span", { text: t(lang, "time.nextHour") }),
    ),
    h("p", { class: "sheet-note", text: `${t(lang, "time.local")}: Europe/Berlin` }),
    h("button", { class: "btn primary full", type: "button", onclick: actions.applyTime }, t(lang, "time.apply")),
  );
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

function renderSettingsSheet(state: AppState, actions: Actions): HTMLElement {
  const lang = state.lang;
  return h(
    "div",
    { class: "sheet" },
    h("div", { class: "sheet-handle" }),
    h("h2", { class: "sheet-title", text: t(lang, "header.settings") }),
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
          oninput: (e: Event) => actions.setBearing(Number((e.target as HTMLInputElement).value)),
        }),
        h("span", { class: "bearing-value", text: `${formatNumber(lang, state.courtBearing)}°` }),
      ),
      h("p", { class: "sheet-note", text: t(lang, "court.bearingHint") }),
      h(
        "button",
        { class: "btn ghost full", type: "button", onclick: () => actions.setBearing(0) },
        makeIcon(ICONS.navigation, 16),
        h("span", { text: t(lang, "court.northSouth") }),
      ),
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
    h("button", { class: "btn primary full", type: "button", onclick: actions.closePanel }, t(lang, "header.settings")),
    h(
      "div",
      { class: "setting-block" },
      h("span", { class: "field-label", text: t(lang, "build.title") }),
      h(
        "p",
        { class: "sheet-note build-marker" },
        `${BUILD_ID} · ${t(lang, "build.builtAt", {
          time: BUILD_TIME ? formatDateTime(lang, BUILD_TIME.slice(0, 16)) : "—",
        })}`,
      ),
    ),
    h("button", { class: "btn primary full", type: "button", onclick: actions.closePanel }, t(lang, "header.settings")),
  );
}

function renderSheet(state: AppState, actions: Actions): HTMLElement {
  let content: HTMLElement | null = null;
  if (state.panel === "location") content = renderLocationSheet(state, actions);
  else if (state.panel === "time") content = renderTimeSheet(state, actions);
  else if (state.panel === "settings") content = renderSettingsSheet(state, actions);
  return h(
    "div",
    {
      class: "sheet-backdrop",
      onclick: (e: MouseEvent) => {
        if (e.target === e.currentTarget) actions.closePanel();
      },
    },
    h(
      "div",
      { class: "sheet-wrap", role: "dialog", "aria-modal": "true" },
      h(
        "button",
        { class: "sheet-close", type: "button", "aria-label": t(state.lang, "common.close"), onclick: actions.closePanel },
        makeIcon(ICONS.close, 18),
      ),
      content,
    ),
  );
}

export function renderApp(root: HTMLElement, state: AppState, actions: Actions): void {
  root.textContent = "";
  const ev = state.evaluation;

  const main = h(
    "main",
    { class: "main" },
    renderTimebar(state, actions),
    renderUpdateBanner(state, actions),
    renderBanner(state),
    ev ? renderHero(state) : renderStatus(state, actions),
    ev ? renderFactors(state) : null,
    ev ? renderRaw(state) : null,
    ev ? renderAssumptions(state) : null,
  );

  const app = h(
    "div",
    { class: "app", dataset: { lang: state.lang } },
    renderHeader(state, actions),
    main,
    renderFooter(state, actions),
  );

  root.appendChild(app);
  if (state.panel !== "none") root.appendChild(renderSheet(state, actions));
}
