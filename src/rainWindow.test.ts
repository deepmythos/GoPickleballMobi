import { describe, expect, it } from "vitest";
import type { ForecastData } from "./api";
import { evaluate, RAIN_WINDOW_HOURS, rainWindowSum } from "./evaluate";
import type { HourlyPoint } from "./types";

/**
 * Bằng chứng cho cửa sổ mưa 3 giờ: giá trị nuôi yếu tố mưa VÀ cổng "wet"
 * phải là tổng của đúng ba bucket ngay trước giờ đánh giá (t-3, t-2, t-1),
 * không phải cửa sổ 24 giờ như trước.
 */

const TARGET_INDEX = 18;

function hourTime(i: number): string {
  return `2026-09-17T${String(i).padStart(2, "0")}:00`;
}

function dryPoint(i: number): HourlyPoint {
  return {
    time: hourTime(i),
    precipitation: 0,
    rain: 0,
    temperature_2m: 22,
    apparent_temperature: 22,
    relative_humidity_2m: 50,
    dew_point_2m: 10,
    precipitation_probability: 0,
    weather_code: 0,
    cloud_cover: 30,
    visibility: 30000,
    wind_speed_10m: 5,
    wind_gusts_10m: 10,
    uv_index: 3,
    is_day: 1,
  };
}

function makeForecast(): ForecastData {
  const hourly = Array.from({ length: 24 }, (_, i) => dryPoint(i));
  return {
    hourly,
    daily: {
      time: ["2026-09-17"],
      sunrise: ["2026-09-17T06:42"],
      sunset: ["2026-09-17T19:12"],
    },
  };
}

function runEval(forecast: ForecastData) {
  return evaluate({
    location: { lat: 52.5, lon: 13.4, name: "Berlin" },
    forecast,
    air: null,
    targetHour: hourTime(TARGET_INDEX),
    courtBearing: 0,
    lights: true,
    baseUrls: {
      forecastBase: "https://example.test",
      airQualityBase: "https://example.test",
      geocodingBase: "https://example.test",
    },
    fetchedAt: "2026-09-17T12:00:00Z",
  });
}

describe("rain window — 3 giờ trước t", () => {
  it("A. pins the window: rain at t-5 is outside t-3..t-1", () => {
    const forecast = makeForecast();
    // t = index 18, nên t-5 = index 13.
    forecast.hourly[13].precipitation = 20;
    const hourly = forecast.hourly;

    const oldWindowStart = Math.max(0, TARGET_INDEX - 24);
    const oldSum = hourly
      .slice(oldWindowStart, TARGET_INDEX)
      .reduce((sum, p) => sum + (p.precipitation ?? p.rain ?? 0), 0);
    const newSum = rainWindowSum(hourly, TARGET_INDEX);
    const rain3h = runEval(forecast).rain3h;

    console.log(
      `[rainWindow] old 24h sum=${oldSum} mm, 3h sum=${newSum.sum} mm, evaluate().rain3h=${rain3h} mm`,
    );

    expect(RAIN_WINDOW_HOURS, "RAIN_WINDOW_HOURS must be 3 hours").toBe(3);
    expect(
      oldSum,
      `old 24h window sum is ${oldSum} mm (20 mm at t-5) while the 3h window sum is ${newSum.sum} mm`,
    ).not.toBe(newSum.sum);
    expect(
      newSum.sum,
      `rainWindowSum(t) must be ${newSum.sum} mm because t-5 is outside t-3..t-1`,
    ).toBe(0);
    expect(
      rain3h,
      `evaluate().rain3h must be the 3h sum (${newSum.sum} mm), not the old 24h sum (${oldSum} mm)`,
    ).toBe(0);
  });

  it("B. heavy rain 5 h before t + dry last 3 h: no wet gate, dry factor", () => {
    const forecast = makeForecast();
    forecast.hourly[13].precipitation = 20;
    const ev = runEval(forecast);
    const factor = ev.factors.find((f) => f.id === "rain_3h");

    expect(ev.gates, "wet gate must not fire: rain fell at t-5, not in t-3..t-1").not.toContain(
      "wet",
    );
    expect(factor, "rain_3h factor must exist").toBeDefined();
    expect(factor!.value, `rain_3h value must be the 3h sum (0 mm)`).toBe(0);
    expect(factor!.impact, "a dry 3h window gives a positive (dry) impact").toBeGreaterThan(0);
    expect(
      ev.missing,
      "a complete 3h window must not be reported as rain_3h_partial",
    ).not.toContain("rain_3h_partial");
    expect(ev.score, `score ${ev.score} must stay above the wet cap (35)`).toBeGreaterThan(35);
  });

  it("C. rain 1 h before t triggers the wet gate and caps the score", () => {
    const forecast = makeForecast();
    // t-1 = index 17.
    forecast.hourly[17].precipitation = 15;
    const ev = runEval(forecast);
    const factor = ev.factors.find((f) => f.id === "rain_3h");

    expect(ev.gates, "wet gate must fire: 15 mm fell within t-3..t-1").toContain("wet");
    expect(factor, "rain_3h factor must exist").toBeDefined();
    expect(factor!.value, "rain_3h value must be 15 mm").toBe(15);
    expect(factor!.impact, "15 mm in the 3h window gives a negative impact").toBeLessThan(0);
    expect(ev.score, `score ${ev.score} must be capped at/below the wet cap (35)`).toBeLessThanOrEqual(
      35,
    );
  });
});
