import type { AirQualityData, ForecastData } from "./api";
import { scoreConditions } from "./scoring";
import { solarPosition } from "./sun";
import { APP_TIMEZONE, getOffsetMinutes, zonedToUtc } from "./time";
import type {
  BaseUrls,
  Confidence,
  FactorResult,
  GeoLocation,
  HourlyPoint,
  ScoreInput,
  SunPosition,
  VerdictLabel,
} from "./types";

export interface EvaluateParams {
  location: GeoLocation;
  forecast: ForecastData;
  air: AirQualityData | null;
  targetHour: string;
  courtBearing: number;
  lights: boolean;
  baseUrls: BaseUrls;
  fetchedAt: string;
  stale?: boolean;
}

export interface Evaluation {
  targetHour: string;
  utcOffsetMinutes: number;
  localTime: string;
  point: HourlyPoint;
  sun: SunPosition;
  score: number;
  verdict: VerdictLabel;
  factors: FactorResult[];
  gates: string[];
  missing: string[];
  confidence: Confidence;
  rain3h: number | null;
  rain3hComplete: boolean;
  aqi: number | null;
  pm25: number | null;
  pm10: number | null;
  sunrise: string | null;
  sunset: string | null;
  dataSource: { forecastBase: string; fetchedAt: string };
}

export class NoTargetHourError extends Error {
  constructor(readonly targetHour: string) {
    super(`No hourly data for ${targetHour}`);
    this.name = "NoTargetHourError";
  }
}

function findHourIndex(times: string[], targetHour: string): number {
  const key = targetHour.slice(0, 16);
  for (let i = 0; i < times.length; i++) {
    if (times[i].slice(0, 16) === key) return i;
  }
  return -1;
}

/**
 * Cửa sổ mưa là ba bucket giờ NGAY TRƯỚC giờ được đánh giá: t-3, t-2, t-1.
 * Không bao gồm giờ t. Đây là nơi DUY NHẤT định nghĩa kích thước cửa sổ mưa.
 */
export const RAIN_WINDOW_HOURS = 3;

/**
 * Tổng lượng mưa của RAIN_WINDOW_HOURS bucket ngay trước `index` (t-3, t-2, t-1).
 * Chỉ nơi này biết kích thước cửa sổ; mọi consumer (điểm + cổng ướt) dùng chung.
 */
export function rainWindowSum(hourly: HourlyPoint[], index: number): { sum: number; complete: boolean } {
  const start = Math.max(0, index - RAIN_WINDOW_HOURS);
  let sum = 0;
  let count = 0;
  for (let i = start; i < index; i++) {
    const v = hourly[i]?.precipitation ?? hourly[i]?.rain;
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      sum += v;
      count++;
    }
  }
  return {
    sum: Math.round(sum * 100) / 100,
    complete: index >= RAIN_WINDOW_HOURS && count === RAIN_WINDOW_HOURS,
  };
}

function deriveConfidence(missing: string[], stale: boolean): Confidence {
  if (stale) return "low";
  const core = [
    "rain_current",
    "rain_3h",
    "wind_gust",
    "apparent_temperature",
    "visibility",
    "is_day",
    "sun_bearing",
  ];
  if (missing.some((id) => core.includes(id))) return "low";
  if (missing.length > 0) return "medium";
  return "high";
}

export function evaluate(params: EvaluateParams): Evaluation {
  const { forecast, air, targetHour } = params;
  const index = findHourIndex(
    forecast.hourly.map((p) => p.time),
    targetHour,
  );  if (index < 0) throw new NoTargetHourError(targetHour);

  const point = forecast.hourly[index];

  const targetDate = zonedToUtc(targetHour, APP_TIMEZONE);
  const sun = solarPosition(targetDate, params.location.lat, params.location.lon);
  const utcOffsetMinutes = getOffsetMinutes(targetDate, APP_TIMEZONE);

  const rain3h = rainWindowSum(forecast.hourly, index);

  let aqi: number | null = null;
  let pm25: number | null = null;
  let pm10: number | null = null;
  if (air) {
    const ai = findHourIndex(air.hourly.time, targetHour);
    if (ai >= 0) {
      aqi = air.hourly.european_aqi[ai] ?? null;
      pm25 = air.hourly.pm2_5[ai] ?? null;
      pm10 = air.hourly.pm10[ai] ?? null;
    }
  }

  const dailyIndex = forecast.daily.time.indexOf(targetHour.slice(0, 10));
  const sunrise = dailyIndex >= 0 ? (forecast.daily.sunrise[dailyIndex] ?? null) : null;
  const sunset = dailyIndex >= 0 ? (forecast.daily.sunset[dailyIndex] ?? null) : null;

  const input: ScoreInput = {
    rainCurrent: point.precipitation ?? point.rain,
    rainProbability: point.precipitation_probability,
    rain3h: rain3h.sum,
    windSpeed: point.wind_speed_10m,
    windGust: point.wind_gusts_10m,
    apparentTemperature: point.apparent_temperature,
    uvIndex: point.uv_index,
    cloudCover: point.cloud_cover,
    visibility: point.visibility,
    aqi,
    sunElevation: sun.elevation,
    sunAzimuth: sun.azimuth,
    courtBearing: ((params.courtBearing % 360) + 360) % 360,
    isDay: point.is_day,
    lights: params.lights,
  };

  const result = scoreConditions(input);

  const missing = [...result.missing];
  if (!rain3h.complete) missing.push("rain_3h_partial");
  if (air === null) missing.push("european_aqi");
  const uniqueMissing = [...new Set(missing)];

  return {
    targetHour,
    localTime: targetHour,
    utcOffsetMinutes,
    point,
    sun,
    score: result.score,
    verdict: result.verdict,
    factors: result.factors,
    gates: result.gates,
    missing: uniqueMissing,
    confidence: deriveConfidence(uniqueMissing, Boolean(params.stale)),
    rain3h: rain3h.sum,
    rain3hComplete: rain3h.complete,
    aqi,
    pm25,
    pm10,
    sunrise,
    sunset,
    dataSource: { forecastBase: params.baseUrls.forecastBase, fetchedAt: params.fetchedAt },
  };
}
