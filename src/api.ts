import { APP_TIMEZONE } from "./time";
import type { BaseUrls, GeoLocation, HourlyPoint } from "./types";

export const FORECAST_HOURLY_VARS = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "dew_point_2m",
  "precipitation",
  "precipitation_probability",
  "rain",
  "weather_code",
  "cloud_cover",
  "visibility",
  "wind_speed_10m",
  "wind_gusts_10m",
  "uv_index",
  "is_day",
] as const;

export const FORECAST_DAILY_VARS = ["sunrise", "sunset"] as const;

export interface DailyAstronomy {
  time: string[];
  sunrise: (string | null)[];
  sunset: (string | null)[];
}

export interface ForecastData {
  hourly: HourlyPoint[];
  daily: DailyAstronomy;
}

export interface AirQualityData {
  hourly: {
    time: string[];
    pm2_5: (number | null)[];
    pm10: (number | null)[];
    european_aqi: (number | null)[];
  };
}

export interface GeocodingResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "http" | "parse",
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function toNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toNumberArray(v: unknown): (number | null)[] {
  return Array.isArray(v) ? v.map(toNumber) : [];
}

async function getJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : String(err), "network");
  }
  if (!response.ok) {
    throw new ApiError(`HTTP ${response.status} for ${url}`, "http", response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new ApiError(`Invalid JSON from ${url}`, "parse");
  }
}

function buildUrl(base: string, path: string, params: Record<string, string>): string {
  const clean = base.replace(/\/+$/, "");
  const qs = new URLSearchParams(params).toString();
  return `${clean}${path}?${qs}`;
}

export function forecastUrl(base: string, loc: GeoLocation, forecastDays = 16): string {
  return buildUrl(base, "/v1/forecast", {
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    hourly: FORECAST_HOURLY_VARS.join(","),
    daily: FORECAST_DAILY_VARS.join(","),
    timezone: APP_TIMEZONE,
    forecast_days: String(forecastDays),
    past_days: "2",
  });
}

export function airQualityUrl(base: string, loc: GeoLocation): string {
  return buildUrl(base, "/v1/air-quality", {
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    hourly: "pm2_5,pm10,european_aqi",
    timezone: APP_TIMEZONE,
  });
}

export function geocodingUrl(base: string, name: string, language: string): string {
  return buildUrl(base, "/v1/search", {
    name,
    count: "5",
    language,
  });
}

export async function fetchForecast(base: string, loc: GeoLocation): Promise<ForecastData> {
  const json = (await getJson(forecastUrl(base, loc))) as {
    hourly?: Record<string, unknown>;
    daily?: Record<string, unknown>;
  };
  const hourlyRaw = json.hourly ?? {};
  const time = Array.isArray(hourlyRaw.time) ? (hourlyRaw.time as string[]) : [];
  const cols: Record<string, (number | null)[]> = {};
  for (const key of FORECAST_HOURLY_VARS) cols[key] = toNumberArray(hourlyRaw[key]);
  const hourly: HourlyPoint[] = time.map((t, i) => ({
    time: t,
    temperature_2m: cols.temperature_2m[i] ?? null,
    apparent_temperature: cols.apparent_temperature[i] ?? null,
    relative_humidity_2m: cols.relative_humidity_2m[i] ?? null,
    dew_point_2m: cols.dew_point_2m[i] ?? null,
    precipitation: cols.precipitation[i] ?? null,
    precipitation_probability: cols.precipitation_probability[i] ?? null,
    rain: cols.rain[i] ?? null,
    weather_code: cols.weather_code[i] ?? null,
    cloud_cover: cols.cloud_cover[i] ?? null,
    visibility: cols.visibility[i] ?? null,
    wind_speed_10m: cols.wind_speed_10m[i] ?? null,
    wind_gusts_10m: cols.wind_gusts_10m[i] ?? null,
    uv_index: cols.uv_index[i] ?? null,
    is_day: cols.is_day[i] ?? null,
  }));

  const dailyRaw = json.daily ?? {};
  const dailyTime = Array.isArray(dailyRaw.time) ? (dailyRaw.time as string[]) : [];
  const daily: DailyAstronomy = {
    time: dailyTime,
    sunrise: Array.isArray(dailyRaw.sunrise) ? (dailyRaw.sunrise as (string | null)[]) : [],
    sunset: Array.isArray(dailyRaw.sunset) ? (dailyRaw.sunset as (string | null)[]) : [],
  };

  if (hourly.length === 0) {
    throw new ApiError("Forecast response contained no hourly data", "parse");
  }
  return { hourly, daily };
}

export async function fetchAirQuality(
  base: string,
  loc: GeoLocation,
): Promise<AirQualityData> {
  const json = (await getJson(airQualityUrl(base, loc))) as {
    hourly?: Record<string, unknown>;
  };
  const hourlyRaw = json.hourly ?? {};
  const time = Array.isArray(hourlyRaw.time) ? (hourlyRaw.time as string[]) : [];
  return {
    hourly: {
      time,
      pm2_5: toNumberArray(hourlyRaw.pm2_5),
      pm10: toNumberArray(hourlyRaw.pm10),
      european_aqi: toNumberArray(hourlyRaw.european_aqi),
    },
  };
}

export async function searchPlaces(
  base: string,
  name: string,
  language: string,
): Promise<GeocodingResult[]> {
  const json = (await getJson(geocodingUrl(base, name, language))) as {
    results?: GeocodingResult[];
  };
  return Array.isArray(json.results) ? json.results : [];
}

export function defaultBaseUrls(): BaseUrls {
  return {
    forecastBase: "https://api.open-meteo.com",
    airQualityBase: "https://air-quality-api.open-meteo.com",
    geocodingBase: "https://geocoding-api.open-meteo.com",
  };
}
