import { describe, expect, it } from "vitest";
import { classify, piece, playabilityGates, scoreConditions } from "./scoring";
import type { ScoreInput } from "./types";

function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    rainCurrent: 0,
    rainProbability: 0,
    rain24h: 0,
    windSpeed: 5,
    windGust: 10,
    apparentTemperature: 22,
    uvIndex: 3,
    cloudCover: 50,
    visibility: 30000,
    aqi: 10,
    sunElevation: 45,
    sunAzimuth: 180,
    courtBearing: 0,
    isDay: 1,
    lights: false,
    ...overrides,
  };
}

describe("scoreConditions", () => {
  it("1. ideal weather scores high and says go", () => {
    const result = scoreConditions(input());
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.verdict).toBe("Nên đi");
    expect(result.missing).toEqual([]);
    expect(result.gates).toEqual([]);
  });

  it("2. heavy rain plus storm gusts is a clear no-go", () => {
    const result = scoreConditions(
      input({
        rainCurrent: 3,
        rainProbability: 95,
        rain24h: 12,
        windSpeed: 30,
        windGust: 65,
        apparentTemperature: 10,
        uvIndex: 1,
        cloudCover: 100,
        visibility: 3000,
        aqi: 60,
        sunElevation: 20,
      }),
    );
    expect(result.verdict).toBe("Không nên");
    expect(result.score).toBeLessThan(40);
    expect(result.gates).toContain("rain");
    expect(result.gates).toContain("gust");
  });

  it("3. harsh sun and high UV is blocked by the heat gate", () => {
    const result = scoreConditions(
      input({
        apparentTemperature: 38,
        uvIndex: 11,
        cloudCover: 0,
        sunElevation: 60,
      }),
    );
    expect(result.gates).toContain("heat");
    expect(result.verdict).toBe("Không nên");
  });

  it("4. darkness without lights is not playable", () => {
    const result = scoreConditions(
      input({
        isDay: 0,
        uvIndex: 0,
        sunElevation: -10,
        sunAzimuth: 0,
      }),
    );
    expect(result.gates).toContain("night");
    expect(result.verdict).toBe("Không nên");
    const playability = result.factors.find((f) => f.id === "playability");
    expect(playability?.impact).toBeLessThan(0);
  });

  it("5. a soaked court after heavy rain is capped", () => {
    const result = scoreConditions(input({ rain24h: 14 }));
    expect(result.gates).toContain("wet");
    expect(result.score).toBeLessThanOrEqual(35);
    expect(result.verdict).toBe("Không nên");
  });

  it("6. missing data is reported instead of invented", () => {
    const result = scoreConditions(
      input({
        rainCurrent: null,
        windGust: null,
        apparentTemperature: null,
        visibility: null,
        aqi: null,
        sunElevation: null,
        sunAzimuth: null,
      }),
    );
    expect(result.missing).toEqual(
      expect.arrayContaining([
        "rain_current",
        "wind_gust",
        "apparent_temperature",
        "visibility",
        "european_aqi",
        "sun_bearing",
      ]),
    );
    expect(result.factors.some((f) => f.id === "rain_current")).toBe(false);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it("reconciles the factor impacts with the score", () => {
    const result = scoreConditions(input({ windGust: 30, rainCurrent: 0.4 }));
    const sum = result.factors.reduce((s, f) => s + f.impact, 0);
    expect(result.score).toBe(50 + sum);
  });

  it("classifies exactly at the thresholds", () => {
    expect(classify(70)).toBe("Nên đi");
    expect(classify(69)).toBe("Cân nhắc");
    expect(classify(40)).toBe("Cân nhắc");
    expect(classify(39)).toBe("Không nên");
  });

  it("uses the court bearing for glare", () => {
    const aligned = scoreConditions(
      input({ sunElevation: 8, sunAzimuth: 180, courtBearing: 0 }),
    );
    const across = scoreConditions(
      input({ sunElevation: 8, sunAzimuth: 90, courtBearing: 0 }),
    );
    const alignedFactor = aligned.factors.find((f) => f.id === "sun_bearing");
    const acrossFactor = across.factors.find((f) => f.id === "sun_bearing");
    expect(alignedFactor!.impact).toBeLessThan(acrossFactor!.impact);
  });
});

describe("piece", () => {
  it("interpolates and clamps", () => {
    const points = [
      [0, 0],
      [10, 10],
    ] as const;
    expect(piece(-5, points)).toBe(0);
    expect(piece(5, points)).toBe(5);
    expect(piece(15, points)).toBe(10);
  });
});

describe("playabilityGates", () => {
  it("returns the expected gates", () => {
    expect(
      playabilityGates(
        input({ isDay: 0, rainCurrent: 3, windGust: 70, apparentTemperature: 36, rain24h: 20 }),
      ),
    ).toEqual(expect.arrayContaining(["night", "rain", "gust", "heat", "wet"]));
  });
});
