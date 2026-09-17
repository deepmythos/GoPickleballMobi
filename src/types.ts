export type Lang = "vi" | "de" | "en";

export interface GeoLocation {
  lat: number;
  lon: number;
  name: string;
}

export interface BaseUrls {
  forecastBase: string;
  airQualityBase: string;
  geocodingBase: string;
}

export interface FactorResult {
  id: string;
  value: number;
  unit: string;
  impact: number;
}

export interface HourlyPoint {
  time: string;
  temperature_2m: number | null;
  apparent_temperature: number | null;
  relative_humidity_2m: number | null;
  dew_point_2m: number | null;
  precipitation: number | null;
  precipitation_probability: number | null;
  rain: number | null;
  weather_code: number | null;
  cloud_cover: number | null;
  visibility: number | null;
  wind_speed_10m: number | null;
  wind_gusts_10m: number | null;
  uv_index: number | null;
  is_day: number | null;
}

export interface SunPosition {
  elevation: number;
  azimuth: number;
}

export interface ScoreInput {
  rainCurrent: number | null;
  rainProbability: number | null;
  rain24h: number | null;
  windSpeed: number | null;
  windGust: number | null;
  apparentTemperature: number | null;
  uvIndex: number | null;
  cloudCover: number | null;
  visibility: number | null;
  aqi: number | null;
  sunElevation: number | null;
  sunAzimuth: number | null;
  courtBearing: number;
  isDay: number | null;
  lights: boolean;
}

export interface ScoreResult {
  score: number;
  verdict: VerdictLabel;
  factors: FactorResult[];
  gates: string[];
  missing: string[];
}

export type VerdictLabel = "Nên đi" | "Cân nhắc" | "Không nên";

export type Confidence = "high" | "medium" | "low";
