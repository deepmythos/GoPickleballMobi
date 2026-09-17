import type { ForecastData, AirQualityData } from "./api";
import type { GeoLocation, Lang } from "./types";

const PREFS_KEY = "pickleball-go-nogo.prefs.v1";
const CACHE_KEY = "pickleball-go-nogo.cache.v1";

export interface Preferences {
  lang: Lang;
  location: GeoLocation;
  courtBearing: number;
  lights: boolean;
}

export interface CachedReading {
  key: string;
  location: GeoLocation;
  fetchedAt: string;
  forecast: ForecastData;
  air: AirQualityData | null;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage disabled or full: preferences are a convenience, not critical */
  }
}

export function locationKey(loc: GeoLocation): string {
  return `${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`;
}

export function loadPreferences(): Preferences | null {
  const prefs = readJson<Preferences>(PREFS_KEY);
  if (!prefs || typeof prefs !== "object") return null;
  if (typeof prefs.location?.lat !== "number" || typeof prefs.location?.lon !== "number") {
    return null;
  }
  return prefs;
}

export function savePreferences(prefs: Preferences): void {
  writeJson(PREFS_KEY, prefs);
}

export function loadReading(loc: GeoLocation): CachedReading | null {
  const cache = readJson<CachedReading>(CACHE_KEY);
  if (!cache || cache.key !== locationKey(loc)) return null;
  if (!cache.forecast?.hourly?.length) return null;
  return cache;
}

export function saveReading(reading: CachedReading): void {
  writeJson(CACHE_KEY, reading);
}
