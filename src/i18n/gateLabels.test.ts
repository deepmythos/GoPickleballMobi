import { describe, expect, it } from "vitest";
import { dictionaries, t } from "./index";
import type { MessageKey } from "./index";
import { playabilityGates } from "../scoring";
import type { GateId } from "../scoring";
import type { ScoreInput } from "../types";

/**
 * Một đầu vào tối thiểu cho MỖI GateId. Kiểu `Record<GateId, ...>` là ràng buộc
 * lúc biên dịch: nếu scoring.ts thêm cổng mới, `tsc --noEmit` (trong npm run build)
 * sẽ đỏ ngay tại đây — cổng mới không thể hồi quy âm thầm thành khoá thô.
 */
const BASE: ScoreInput = {
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
};

const GATE_FIXTURES: Record<GateId, ScoreInput> = {
  night: { ...BASE, isDay: 0 },
  rain: { ...BASE, rainCurrent: 3 },
  gust: { ...BASE, windGust: 65 },
  heat: { ...BASE, apparentTemperature: 36 },
  cold: { ...BASE, apparentTemperature: -6 },
  wet: { ...BASE, rain24h: 20 },
};

const LANGS = ["vi", "de", "en"] as const;

describe("gate labels", () => {
  it("has a dictionary entry for every GateId in every language", () => {
    for (const gate of Object.keys(GATE_FIXTURES) as GateId[]) {
      expect(playabilityGates(GATE_FIXTURES[gate]), `fixture must trigger "${gate}"`).toContain(gate);
      const key = `reason.gate.${gate}`;
      for (const lang of LANGS) {
        expect(
          Object.prototype.hasOwnProperty.call(dictionaries[lang], key),
          `${lang} dictionary is missing "${key}"`,
        ).toBe(true);
        const label = t(lang, key as MessageKey);
        expect(label, `"${key}" must not render as a raw key in ${lang}`).not.toBe(key);
        expect(label.trim().length, `"${key}" must not be empty in ${lang}`).toBeGreaterThan(0);
      }
    }
  });
});
