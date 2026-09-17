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
import { isLang, t } from "./i18n";
import { APP_TIMEZONE, ceilToHour, formatLocalISO } from "./time";
import type { BaseUrls, GeoLocation, Lang } from "./types";
import { renderApp } from "./ui/render";
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
    panel: "none",
    geoStatus: "idle",
    geoResults: [],
    searchQuery: "",
    draft: { ...location },
    atInput: targetHour,
    theme,
  };
}

function start(): void {
  const params = new URLSearchParams(window.location.search);
  const state = initialiseState(params);
  const root = document.getElementById("app");
  if (!root) throw new Error("Missing #app root");

  document.documentElement.lang = state.lang;

  const render = (): void => renderApp(root, state, actions);

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
    window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}`);
  }

  function errorMessage(err: unknown): string {
    if (err instanceof NoTargetHourError) {
      return t(state.lang, "status.noTargetHour", { time: state.targetHour });
    }
    if (err instanceof ApiError) {
      if (err.kind === "network") return t(state.lang, "error.network");
      if (err.kind === "http") return t(state.lang, "error.http");
      return t(state.lang, "error.parse");
    }
    return t(state.lang, "error.unknown");
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
      const message = errorMessage(err);
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
        state.error = errorMessage(err);
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
      const message = errorMessage(err);
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
    state.stale = false;
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

  const actions: Actions = {
    openPanel(panel) {
      state.panel = panel;
      if (panel === "location") {
        state.draft = { ...state.location };
        state.searchQuery = "";
        state.geoResults = [];
        state.geoStatus = "idle";
      } else if (panel === "time") {
        state.atInput = state.targetHour;
      }
      render();
    },
    closePanel() {
      state.panel = "none";
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
      state.panel = "none";
      persist();
      updateUrl();
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
      state.panel = "none";
      updateUrl();
      recompute();
      render();
    },
    useNextHour() {
      state.atInput = ceilToHour(state.nowLocal);
      render();
    },
    refresh() {
      void loadData();
    },
  };

  render();
  void loadData();
}

start();
