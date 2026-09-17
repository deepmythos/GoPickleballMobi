import { axisAngle } from "./sun";
import type { FactorResult, ScoreInput, ScoreResult, VerdictLabel } from "./types";

export interface FactorMeta {
  /** Maximum points this factor can add (+) or remove (-) from the 50-point base. */
  maxWeight: number;
  /** Comfortable range, shown to the user. null means "no lower/upper bound". */
  idealMin: number | null;
  idealMax: number | null;
}

export const FACTOR_META: Record<string, FactorMeta> = {
  rain_current: { maxWeight: 12, idealMin: 0, idealMax: 0 },
  rain_probability: { maxWeight: 7, idealMin: 0, idealMax: 10 },
  rain_24h: { maxWeight: 14, idealMin: 0, idealMax: 0 },
  wind_speed: { maxWeight: 6, idealMin: 0, idealMax: 10 },
  wind_gust: { maxWeight: 14, idealMin: 0, idealMax: 15 },
  apparent_temperature: { maxWeight: 16, idealMin: 16, idealMax: 26 },
  uv_index: { maxWeight: 9, idealMin: 0, idealMax: 5 },
  cloud_cover: { maxWeight: 2, idealMin: 30, idealMax: 70 },
  visibility: { maxWeight: 5, idealMin: 20000, idealMax: null },
  european_aqi: { maxWeight: 8, idealMin: 0, idealMax: 20 },
  sun_bearing: { maxWeight: 4, idealMin: null, idealMax: null },
  is_day: { maxWeight: 10, idealMin: 1, idealMax: 1 },
  playability: { maxWeight: 0, idealMin: null, idealMax: null },
};

type Point = readonly [number, number];

function lerp(x: number, x0: number, y0: number, x1: number, y1: number): number {
  if (x1 === x0) return y1;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/** Piecewise-linear mapping with flat extrapolation. Points sorted by x. */
export function piece(x: number, points: readonly Point[]): number {
  if (points.length === 0) return 0;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (x <= x1) return lerp(x, x0, y0, x1, y1);
  }
  return points[points.length - 1][1];
}

export function classify(score: number): VerdictLabel {
  if (score >= 70) return "Nên đi";
  if (score >= 40) return "Cân nhắc";
  return "Không nên";
}

export type GateId = "night" | "rain" | "gust" | "heat" | "cold" | "wet";

/** Hard safety/playability limits. Each one caps the score. */
export function playabilityGates(input: ScoreInput): GateId[] {
  const gates: GateId[] = [];
  const night =
    input.isDay === 0 ||
    (input.isDay === null && input.sunElevation !== null && input.sunElevation < -6);
  if (night && !input.lights) gates.push("night");
  if (input.rainCurrent !== null && input.rainCurrent >= 2.5) gates.push("rain");
  if (input.windGust !== null && input.windGust >= 60) gates.push("gust");
  if (input.apparentTemperature !== null && input.apparentTemperature >= 35) gates.push("heat");
  if (input.apparentTemperature !== null && input.apparentTemperature <= -5) gates.push("cold");
  if (input.rain24h !== null && input.rain24h >= 12) gates.push("wet");
  return gates;
}

export function gateCap(gates: GateId[]): number {
  let cap = 100;
  if (gates.includes("night")) cap = Math.min(cap, 25);
  if (gates.includes("rain")) cap = Math.min(cap, 25);
  if (gates.includes("gust")) cap = Math.min(cap, 35);
  if (gates.includes("heat")) cap = Math.min(cap, 30);
  if (gates.includes("cold")) cap = Math.min(cap, 30);
  if (gates.includes("wet")) cap = Math.min(cap, 35);
  return cap;
}

/**
 * Deterministic score in [0, 100].
 *
 * Model: the neutral base is 50 points. Every factor adds a signed impact
 * (positive = conditions help, negative = conditions hurt), so the sum of
 * the impacts is exactly `score - 50`. The reasoning chain therefore always
 * reconciles with the number the user sees.
 *
 * Physical playability gates (darkness without lights, torrential rain,
 * storm gusts, extreme heat/cold, a soaked court) additionally cap the
 * result. When a cap bites, a `playability` factor records the exact points
 * that were removed, keeping the reconciliation intact.
 */
export function scoreConditions(input: ScoreInput): ScoreResult {
  const factors: FactorResult[] = [];
  const missing: string[] = [];

  const add = (
    id: string,
    value: number | null,
    unit: string,
    evaluate: (v: number) => number,
  ): void => {
    if (value === null || !Number.isFinite(value)) {
      missing.push(id);
      return;
    }
    factors.push({ id, value, unit, impact: Math.round(evaluate(value)) });
  };

  add("rain_current", input.rainCurrent, "mm/h", (v) =>
    piece(v, [
      [0, 8],
      [0.1, 6],
      [0.3, 2],
      [0.6, -3],
      [1.2, -9],
      [2.5, -12],
    ]),
  );

  add("rain_probability", input.rainProbability, "%", (v) =>
    piece(v, [
      [0, 4],
      [10, 4],
      [30, 1],
      [50, -2],
      [70, -5],
      [90, -7],
    ]),
  );

  add("rain_24h", input.rain24h, "mm", (v) =>
    piece(v, [
      [0, 6],
      [0.5, 4],
      [1.5, 1],
      [3, -4],
      [6, -9],
      [10, -12],
      [20, -14],
    ]),
  );

  add("wind_speed", input.windSpeed, "km/h", (v) =>
    piece(v, [
      [0, 3],
      [8, 3],
      [15, 1],
      [22, -2],
      [30, -5],
      [45, -6],
    ]),
  );

  add("wind_gust", input.windGust, "km/h", (v) =>
    piece(v, [
      [0, 6],
      [12, 6],
      [18, 3],
      [25, -1],
      [35, -6],
      [45, -10],
      [60, -14],
    ]),
  );

  add("apparent_temperature", input.apparentTemperature, "°C", (v) =>
    piece(v, [
      [-20, -12],
      [-2, -10],
      [4, -5],
      [10, 1],
      [16, 5],
      [26, 5],
      [30, -1],
      [33, -6],
      [36, -12],
      [40, -16],
      [50, -16],
    ]),
  );

  const dayish = input.isDay !== 0;

  if (dayish) {
    add("uv_index", input.uvIndex, "UV", (v) =>
      piece(v, [
        [0, 1],
        [2, 2],
        [4, 3],
        [6, 1],
        [8, -3],
        [10, -6],
        [12, -9],
      ]),
    );
    add("cloud_cover", input.cloudCover, "%", (v) =>
      piece(v, [
        [0, -1],
        [20, 0],
        [40, 2],
        [65, 2],
        [85, 0],
        [100, -2],
      ]),
    );
  } else {
    // At night UV is genuinely ~0 and cloud cover does not change playability,
    // so these factors stay neutral instead of being counted as missing.
    if (input.uvIndex === null) {
      missing.push("uv_index");
    } else {
      factors.push({ id: "uv_index", value: input.uvIndex, unit: "UV", impact: 0 });
    }
    if (input.cloudCover === null) {
      missing.push("cloud_cover");
    } else {
      factors.push({ id: "cloud_cover", value: input.cloudCover, unit: "%", impact: 0 });
    }
  }

  add("visibility", input.visibility, "m", (v) =>
    piece(v, [
      [0, -5],
      [2000, -5],
      [5000, -2],
      [10000, 1],
      [20000, 3],
      [50000, 3],
    ]),
  );

  add("european_aqi", input.aqi, "EAQI", (v) =>
    piece(v, [
      [0, 4],
      [20, 4],
      [35, 2],
      [50, -1],
      [65, -3],
      [80, -6],
      [100, -8],
      [200, -8],
    ]),
  );

  // Glare: a low sun lined up with the court's long axis is the worst case.
  if (input.sunElevation === null || input.sunAzimuth === null) {
    missing.push("sun_bearing");
  } else if (input.sunElevation > 0) {
    const alignment = axisAngle(input.sunAzimuth, input.courtBearing);
    const align = 1 - alignment / 90;
    const lowSun = Math.max(0, Math.min(1, (35 - input.sunElevation) / 35));
    const cloudRelief = 1 - (0.8 * Math.min(100, Math.max(0, input.cloudCover ?? 0))) / 100;
    const severity = align * lowSun * cloudRelief;
    factors.push({
      id: "sun_bearing",
      value: Math.round(alignment),
      unit: "°",
      impact: Math.round(2 - 6 * severity),
    });
  } else {
    factors.push({ id: "sun_bearing", value: 0, unit: "°", impact: 0 });
  }

  if (input.isDay === null) {
    missing.push("is_day");
  } else {
    const impact = input.isDay === 1 ? 4 : input.lights ? 0 : -10;
    factors.push({ id: "is_day", value: input.isDay, unit: "bool", impact });
  }

  const base = Math.max(0, Math.min(100, 50 + factors.reduce((sum, f) => sum + f.impact, 0)));

  const gates = playabilityGates(input);
  const cap = gateCap(gates);
  const score = Math.min(base, cap);

  if (score !== base) {
    factors.push({
      id: "playability",
      value: 0,
      unit: "bool",
      impact: score - base,
    });
  }

  return { score, verdict: classify(score), factors, gates, missing };
}
