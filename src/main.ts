import "./styles.css";
import {
  ApiError,
  defaultBaseUrls,
  fetchAirQuality,
  fetchForecast,
  searchPlaces,
  type AirQualityData,
  type ForecastData,
  type GeocodingResult,
} from "./api";
import {
  loadPreferences,
  loadReading,
  locationKey,
  savePreferences,
  saveReading,
} from "./cache";
import { evaluate, NoTargetHourError, type Evaluation } from "./evaluate";
import { BUILD_ID, BUILD_TIME } from "./build";
import { applyUpdate, initPwa } from "./pwa";
import { isLang, t } from "./i18n";
import { APP_TIMEZONE, ceilToHour, formatLocalISO } from "./time";
import type { BaseUrls, GeoLocation, Lang } from "./types";
import { hostOf, renderApp } from "./ui/render";
import { createSwipeLatch, type SwipeSample } from "./ui/gesture";
import { initialSheetState, isSheetOpen, sheetReducer, type SheetAction } from "./ui/sheet";
import type { Actions, AppState, ThemeChoice } from "./ui/state";

const DEFAULT_LOCATION: GeoLocation = {
  lat: 49.9960846,
  lon: 8.7605459,
  name: "Pickleball-Plätze, Offenthaler Straße, Dietzenbach",
};

const THEME_KEY = "pickleball-go-nogo.theme.v1";

interface WindowVerdict {
  score: number | null;
  verdict: string | null;
  localTime: string;
  utcOffsetMinutes: number;
  location: { lat: number; lon: number; name: string };
  factors: { id: string; value: number; unit: string; impact: number }[];
  dataSource: { forecastBase: string; fetchedAt: string };
  error?: string;
  confidence?: string;
  missing?: string[];
  gates?: string[];
  stale?: boolean;
}

declare global {
  interface Window {
    __verdict?: WindowVerdict;
    __build?: { id: string; time: string };
  }
}

function parseNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampBearing(value: number): number {
  const rounded = Math.round(value);
  return ((rounded % 360) + 360) % 360;
}

function readBaseUrls(params: URLSearchParams): BaseUrls {
  const defaults = defaultBaseUrls();
  return {
    forecastBase: params.get("forecastBase") ?? defaults.forecastBase,
    airQualityBase: params.get("airQualityBase") ?? defaults.airQualityBase,
    geocodingBase: params.get("geocodingBase") ?? defaults.geocodingBase,
  };
}

function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    /* ignore */
  }
  return "system";
}

function applyTheme(theme: ThemeChoice): void {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
}

function initialiseState(params: URLSearchParams): AppState {
  const prefs = loadPreferences();
  const baseUrls = readBaseUrls(params);

  const paramLang = params.get("lang");
  const lang: Lang = isLang(paramLang) ? paramLang : (prefs?.lang ?? "vi");

  const lat = parseNumber(params.get("lat"));
  const lon = parseNumber(params.get("lon"));
  const location: GeoLocation =
    lat !== null && lon !== null
      ? { lat, lon, name: params.get("name") ?? prefs?.location.name ?? DEFAULT_LOCATION.name }
      : (prefs?.location ?? DEFAULT_LOCATION);

  const bearingParam = parseNumber(params.get("courtBearing"));
  const courtBearing = clampBearing(bearingParam ?? prefs?.courtBearing ?? 0);
  const lightsParam = params.get("lights");
  const lights = lightsParam !== null ? lightsParam === "1" || lightsParam === "true" : (prefs?.lights ?? false);

  const nowParam = params.get("now");
  const nowLocal = nowParam ? nowParam.slice(0, 16) : formatLocalISO(new Date(), APP_TIMEZONE);

  const atParam = params.get("at");
  const targetHour = atParam ? `${atParam.slice(0, 13)}:00` : ceilToHour(nowLocal);

  const theme = readTheme();
  applyTheme(theme);

  return {
    lang,
    location,
    targetHour,
    nowLocal,
    courtBearing,
    lights,
    baseUrls,
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
    draft: { ...location },
    atInput: targetHour,
    theme,
    offline: typeof navigator !== "undefined" && navigator.onLine === false,
    update: { available: false, dismissed: false },
  };
}

function start(): void {
  const params = new URLSearchParams(window.location.search);
  const state = initialiseState(params);
  const rootEl = document.getElementById("app");
  if (!rootEl) throw new Error("Missing #app root");
  const root: HTMLElement = rootEl;

  document.documentElement.lang = state.lang;
  window.__build = { id: BUILD_ID, time: BUILD_TIME };

  let sheetEntryPushed = false;
  let pendingFocus: "sheet" | "opener" | null = null;
  /** Selector của nút đã MỞ sheet, để trả focus về đúng chỗ khi đóng. */
  let openerSelector = ".actionbar-adjust";

  function persist(): void {
    savePreferences({
      lang: state.lang,
      location: state.location,
      courtBearing: state.courtBearing,
      lights: state.lights,
    });
  }

  function updateUrl(): void {
    const next = new URLSearchParams();
    next.set("lat", String(state.location.lat));
    next.set("lon", String(state.location.lon));
    next.set("name", state.location.name);
    next.set("at", state.targetHour);
    next.set("lang", state.lang);
    next.set("courtBearing", String(state.courtBearing));
    if (next.get("now") === null && params.get("now")) next.set("now", params.get("now") as string);
    next.set("forecastBase", state.baseUrls.forecastBase);
    next.set("airQualityBase", state.baseUrls.airQualityBase);
    next.set("geocodingBase", state.baseUrls.geocodingBase);
    // Giữ nguyên state hiện tại (vd { gpmSheet }) để không phá cơ chế lịch sử của sheet.
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${next.toString()}`);
  }

  function errorMessage(err: unknown, host: string): string {
    if (err instanceof NoTargetHourError) {
      return t(state.lang, "status.noTargetHourHost", { host, time: state.targetHour });
    }
    if (err instanceof ApiError) {
      if (err.kind === "network") return t(state.lang, "status.errorNetworkHost", { host });
      if (err.kind === "http") {
        if (typeof err.status === "number") {
          return t(state.lang, "status.errorHttpHost", { host, status: err.status });
        }
        return t(state.lang, "status.errorUnknownHost", { host });
      }
      return t(state.lang, "status.errorParseHost", { host });
    }
    return t(state.lang, "status.errorUnknownHost", { host });
  }

  function forecastHost(): string {
    return hostOf(state.baseUrls.forecastBase);
  }

  function publishVerdict(): void {
    const ev = state.evaluation;
    if (!ev) return;
    window.__verdict = {
      score: ev.score,
      verdict: ev.verdict,
      localTime: ev.localTime,
      utcOffsetMinutes: ev.utcOffsetMinutes,
      location: {
        lat: state.location.lat,
        lon: state.location.lon,
        name: state.location.name,
      },
      factors: ev.factors.map(({ id, value, unit, impact }) => ({ id, value, unit, impact })),
      dataSource: {
        forecastBase: state.baseUrls.forecastBase,
        fetchedAt: ev.dataSource.fetchedAt,
      },
      confidence: ev.confidence,
      missing: ev.missing,
      gates: ev.gates,
      stale: state.stale,
    };
  }

  function publishError(message: string): void {
    window.__verdict = {
      score: null,
      verdict: null,
      localTime: state.targetHour,
      utcOffsetMinutes: 0,
      location: {
        lat: state.location.lat,
        lon: state.location.lon,
        name: state.location.name,
      },
      factors: [],
      dataSource: {
        forecastBase: state.baseUrls.forecastBase,
        fetchedAt: state.fetchedAt ?? new Date().toISOString(),
      },
      error: message,
    };
  }

  function recompute(): void {
    if (!state.forecast) {
      state.status = "error";
      state.evaluation = null;
      const message = t(state.lang, "status.noData");
      state.error = message;
      publishError(message);
      return;
    }
    try {
      const evaluation: Evaluation = evaluate({
        location: state.location,
        forecast: state.forecast,
        air: state.air,
        targetHour: state.targetHour,
        courtBearing: state.courtBearing,
        lights: state.lights,
        baseUrls: state.baseUrls,
        fetchedAt: state.fetchedAt ?? new Date().toISOString(),
        stale: state.stale,
      });
      state.evaluation = evaluation;
      state.error = null;
      state.status = "ready";
      publishVerdict();
    } catch (err) {
      state.evaluation = null;
      state.status = "error";
      const message = errorMessage(err, forecastHost());
      state.error = message;
      publishError(message);
    }
  }

  async function loadData(): Promise<void> {
    state.fetching = true;
    if (!state.evaluation) state.status = "loading";
    state.error = null;
    render();

    let forecast: ForecastData;
    try {
      forecast = await fetchForecast(state.baseUrls.forecastBase, state.location);
    } catch (err) {
      const cached = loadReading(state.location);
      if (cached) {
        state.forecast = cached.forecast;
        state.air = cached.air;
        state.fetchedAt = cached.fetchedAt;
        state.stale = true;
        state.error = errorMessage(err, forecastHost());
        recompute();
        state.status = state.evaluation ? "ready" : "error";
        state.fetching = false;
        render();
        return;
      }
      state.forecast = null;
      state.air = null;
      state.stale = false;
      state.status = "error";
      const message = errorMessage(err, forecastHost());
      state.error = message;
      publishError(message);
      state.fetching = false;
      render();
      return;
    }

    let air: AirQualityData | null = null;
    try {
      air = await fetchAirQuality(state.baseUrls.airQualityBase, state.location);
    } catch {
      air = null;
    }

    const fetchedAt = new Date().toISOString();
    state.forecast = forecast;
    state.air = air;
    state.fetchedAt = fetchedAt;
    state.stale = state.offline;
    saveReading({
      key: locationKey(state.location),
      location: state.location,
      fetchedAt,
      forecast,
      air,
    });
    recompute();
    if (state.status !== "error") state.status = "ready";
    state.fetching = false;
    render();
  }

  // ------------------------------------------------------------ sheet driver

  /**
   * Đường DUY NHẤT điều khiển sheet: nạp action qua sheetReducer, đồng bộ cờ
   * lịch sử (push khi mở, back đúng MỘT lần khi đóng), rồi render.
   */
  function runSheetActions(...sheetActions: SheetAction[]): void {
    const wasOpen = isSheetOpen(state.sheet);
    for (const action of sheetActions) {
      state.sheet = sheetReducer(state.sheet, action);
    }
    const nowOpen = isSheetOpen(state.sheet);
    if (!wasOpen && nowOpen) {
      sheetEntryPushed = true;
      window.history.pushState({ gpmSheet: state.sheet.panel }, "", window.location.href);
      pendingFocus = "sheet";
    } else if (wasOpen && !nowOpen) {
      pendingFocus = "opener";
      if (sheetEntryPushed) {
        sheetEntryPushed = false;
        // popstate sẽ đồng bộ lại query string trên entry vừa quay về.
        window.history.back();
      } else {
        updateUrl();
      }
    }
    render();
  }

  const actions: Actions = {
    openSheet(panel) {
      if (panel === "location") {
        // Nhớ nút đã mở: appbar khi mở từ ngoài, nút trong sheet khi mở từ sheet khác.
        openerSelector = isSheetOpen(state.sheet)
          ? '[data-sheet-opener="location"]'
          : ".appbar-loc";
        state.draft = { ...state.location };
        state.searchQuery = "";
        state.geoResults = [];
        state.geoStatus = "idle";
      } else {
        openerSelector = ".actionbar-adjust";
        state.atInput = state.targetHour;
      }
      runSheetActions({ type: "open", panel });
    },
    closeSheet() {
      if (!isSheetOpen(state.sheet)) return;
      runSheetActions({ type: "close" });
    },
    toggleRaw() {
      state.rawOpen = !state.rawOpen;
      render();
    },
    setLang(lang) {
      state.lang = lang;
      document.documentElement.lang = lang;
      persist();
      updateUrl();
      render();
    },
    setTheme(theme) {
      state.theme = theme;
      applyTheme(theme);
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        /* ignore */
      }
      render();
    },
    setBearing(bearing) {
      state.courtBearing = clampBearing(bearing);
      persist();
      updateUrl();
      recompute();
      render();
    },
    setLights(lights) {
      state.lights = lights;
      persist();
      recompute();
      render();
    },
    setSearchQuery(query) {
      state.searchQuery = query;
    },
    runSearch() {
      const query = state.searchQuery.trim();
      if (!query) return;
      state.geoStatus = "loading";
      state.geoResults = [];
      render();
      const language = state.lang === "de" ? "de" : "en";
      searchPlaces(state.baseUrls.geocodingBase, query, language)
        .then((results) => {
          state.geoResults = results;
          state.geoStatus = "done";
          render();
        })
        .catch(() => {
          state.geoResults = [];
          state.geoStatus = "error";
          render();
        });
    },
    chooseGeoResult(result: GeocodingResult) {
      state.draft = { lat: result.latitude, lon: result.longitude, name: result.name };
      render();
    },
    patchDraft(patch) {
      state.draft = { ...state.draft, ...patch };
    },
    applyLocation() {
      const { lat, lon, name } = state.draft;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
      state.location = {
        lat,
        lon,
        name: name.trim() || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      };
      persist();
      updateUrl();
      runSheetActions({ type: "close" });
      void loadData();
    },
    locateMe() {
      if (!navigator.geolocation) {
        state.geoStatus = "error";
        render();
        return;
      }
      state.geoStatus = "loading";
      render();
      navigator.geolocation.getCurrentPosition(
        (position) => {
          state.draft = {
            lat: Number(position.coords.latitude.toFixed(6)),
            lon: Number(position.coords.longitude.toFixed(6)),
            name: t(state.lang, "location.useMyLocation"),
          };
          state.geoStatus = "idle";
          render();
        },
        () => {
          state.geoStatus = "error";
          render();
        },
        { enableHighAccuracy: false, timeout: 10000 },
      );
    },
    setAtInput(value) {
      state.atInput = value;
    },
    applyTime() {
      const match = state.atInput.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      if (!match) return;
      state.targetHour = `${state.atInput.slice(0, 13)}:00`;
      state.atInput = state.targetHour;
      updateUrl();
      recompute();
      runSheetActions({ type: "close" });
    },
    useNextHour() {
      state.atInput = ceilToHour(state.nowLocal);
      render();
    },
    refresh() {
      void loadData();
    },
    applyUpdate: () => applyUpdate(),
    dismissUpdate: () => {
      state.update = { ...state.update, dismissed: true };
      render();
    },
  };

  // --------------------------------------------------------- gesture driver

  let gestureAttached = false;
  let touchState: {
    startX: number;
    startY: number;
    startTime: number;
    dy: number;
    dragging: boolean;
    excluded: boolean;
  } | null = null;
  const swipeLatch = createSwipeLatch();

  function isHorizontalScroller(el: Element): boolean {
    let node: Element | null = el;
    while (node && node !== document.body) {
      const overflowX = getComputedStyle(node).overflowX;
      if (
        (overflowX === "auto" || overflowX === "scroll") &&
        node.scrollWidth > node.clientWidth + 1
      ) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function isExcludedTarget(el: Element): boolean {
    if (el.matches("input, textarea, select, [role='slider'], .range, .segmented")) return true;
    return isHorizontalScroller(el);
  }

  function onTouchStart(e: TouchEvent): void {
    if (e.touches.length !== 1) {
      touchState = null;
      return;
    }
    const touch = e.touches[0];
    const target = e.target instanceof Element ? e.target : null;
    const excluded = target ? isExcludedTarget(target) : false;
    const inSheet = target ? target.closest(".sheet-wrap") !== null : false;
    touchState = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      dy: 0,
      dragging: inSheet && !excluded,
      excluded,
    };
    swipeLatch.reset();
  }

  function onTouchMove(e: TouchEvent): void {
    if (!touchState || !touchState.dragging || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchState.startX;
    const dy = touch.clientY - touchState.startY;
    if (Math.abs(dy) > Math.abs(dx) && dy > 0) {
      e.preventDefault();
      touchState.dy = dy;
      const wrap = root.querySelector<HTMLElement>(".sheet-wrap");
      const backdrop = root.querySelector<HTMLElement>(".sheet-backdrop");
      if (wrap) wrap.style.transform = `translateY(${dy}px)`;
      if (backdrop) backdrop.style.opacity = String(Math.max(0, 1 - dy / 320));
    }
  }

  /** Nạp kết quả kéo tay vào state machine rồi render đúng MỘT lần. */
  function finishDrag(dy: number): void {
    runSheetActions(
      { type: "dragStart" },
      { type: "dragMove", offsetPx: dy },
      { type: "dragEnd" },
    );
  }

  function onTouchEnd(e: TouchEvent): void {
    const ts = touchState;
    touchState = null;
    if (!ts) return;
    if (ts.dragging) {
      finishDrag(ts.dy);
      return;
    }
    const touch = e.changedTouches[0];
    if (!touch) return;
    const sample: SwipeSample = {
      startX: ts.startX,
      startY: ts.startY,
      endX: touch.clientX,
      endY: touch.clientY,
      durationMs: Date.now() - ts.startTime,
      startedInHorizontalScroller: ts.excluded,
    };
    const outcome = swipeLatch.decide(sample);
    if (outcome === "back" && isSheetOpen(state.sheet)) {
      actions.closeSheet();
    }
  }

  function onTouchCancel(): void {
    const ts = touchState;
    touchState = null;
    if (ts && ts.dragging) finishDrag(0);
  }

  function attachGestures(): void {
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchCancel);
  }

  function detachGestures(): void {
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", onTouchEnd);
    document.removeEventListener("touchcancel", onTouchCancel);
  }

  function syncGestureDriver(): void {
    const open = isSheetOpen(state.sheet);
    if (open && !gestureAttached) {
      attachGestures();
      gestureAttached = true;
    } else if (!open && gestureAttached) {
      detachGestures();
      gestureAttached = false;
    }
  }

  // ------------------------------------------------------------------ render

  function render(): void {
    const prevPanel = document.documentElement.dataset.sheet;
    const prevSheet = root.querySelector<HTMLElement>(".sheet");
    const prevScroll = prevSheet ? prevSheet.scrollTop : 0;
    renderApp(root, state, actions);
    document.documentElement.dataset.sheet = state.sheet.panel;
    // Giữ vị trí cuộn của sheet khi render lại cùng một panel.
    if (prevPanel === state.sheet.panel && prevScroll > 0) {
      const nextSheet = root.querySelector<HTMLElement>(".sheet");
      if (nextSheet) nextSheet.scrollTop = prevScroll;
    }
    syncGestureDriver();
    if (pendingFocus) {
      const which = pendingFocus;
      pendingFocus = null;
      requestAnimationFrame(() => {
        const selector = which === "sheet" ? ".sheet-close" : openerSelector;
        const target =
          root.querySelector<HTMLElement>(selector) ??
          root.querySelector<HTMLElement>(".actionbar-adjust");
        target?.focus();
      });
    }
  }

  initPwa({
    onUpdateAvailable: () => {
      state.update = { available: true, dismissed: false };
      render();
    },
  });

  window.addEventListener("offline", () => {
    state.offline = true;
    render();
  });
  window.addEventListener("online", () => {
    state.offline = false;
    render();
  });

  window.addEventListener("popstate", () => {
    if (isSheetOpen(state.sheet) && sheetEntryPushed) {
      // Lịch sử đã bị trình duyệt pop; đóng đúng một cấp, không gọi back lần nữa.
      // Đặt cờ NGAY trong handler để pop xếp hàng không đóng nhầm sheet mới.
      sheetEntryPushed = false;
      state.sheet = sheetReducer(state.sheet, { type: "close" });
      pendingFocus = "opener";
      render();
    }
    // Sau khi quay về entry trước, đồng bộ lại query string với state hiện tại.
    updateUrl();
  });

  render();
  void loadData();
}

start();
