import { describe, expect, it } from "vitest";
import { dictionaries } from "./i18n";
import { scoreConditions } from "./scoring";
import type { ScoreInput } from "./types";
import { UNIT, UNIT_KEY, unitKey, unitText, type UnitId } from "./units";

const UNITS = ["km/h", "mm/h", "%", "°C", "m", "°", "UV", "EAQI", "mm"] as const;
const LANGS = ["vi", "de", "en"] as const;

function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    rainCurrent: 0,
    rainProbability: 0,
    rain3h: 0,
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

describe("units — đơn vị hiển thị phải đi qua từ điển", () => {
  it("unitText giữ nguyên chuỗi hiển thị ở cả 3 ngôn ngữ (byte-identical)", () => {
    const lines = LANGS.map((lang) => `${lang}: ${UNITS.map((u) => unitText(lang, u)).join(" | ")}`);
    // In 3 khối (mỗi ngôn ngữ một dòng) để có bằng chứng byte-identical.
    console.log(`\n[units] ${lines.join("\n[units] ")}`);
    const [, ...rest] = lines.map((line) => line.slice(line.indexOf(": ") + 2));
    for (const line of rest) expect(line).toBe(lines[0].slice(lines[0].indexOf(": ") + 2));
    for (const lang of LANGS) {
      for (const unit of UNITS) expect(unitText(lang, unit)).toBe(unit);
    }
  });

  it("unitKey('bool') là null và unitText fallback không nuốt chuỗi lạ", () => {
    expect(unitKey("bool")).toBeNull();
    expect(unitKey("constructor")).toBeNull();
    expect(unitKey("toString")).toBeNull();
    expect(unitKey("__proto__")).toBeNull();
    expect(unitText("vi", "bool")).toBe("bool");
    expect(unitText("vi", "constructor")).toBe("constructor");
    expect(unitText("de", "không-có-trong-bảng")).toBe("không-có-trong-bảng");
  });

  it("UNIT khớp đúng giá trị tiếng Việt trong từ điển cho cả 9 đơn vị", () => {
    const ids = Object.keys(UNIT) as UnitId[];
    expect(ids).toHaveLength(9);
    for (const id of ids) {
      expect(UNIT[id]).toBe(dictionaries.vi[UNIT_KEY[id]]);
    }
  });

  it("hợp đồng: factor.unit là chuỗi hiển thị, không phải khoá i18n", () => {
    const result = scoreConditions(input());
    for (const factor of result.factors) {
      expect(typeof factor.unit).toBe("string");
      expect(factor.unit.startsWith("unit.")).toBe(false);
    }
    const rain = result.factors.find((f) => f.id === "rain_current");
    expect(rain, "thiếu factor rain_current").toBeDefined();
    expect(rain!.unit).toBe("mm/h");
  });
});
