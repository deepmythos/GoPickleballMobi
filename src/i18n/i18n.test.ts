import { describe, expect, it } from "vitest";
import { dictionaries, weatherCodeKey } from "./index";
import { vi } from "./vi";

describe("i18n dictionaries", () => {
  it("have exactly the same keys in every language", () => {
    const viKeys = Object.keys(vi).sort();
    for (const lang of ["de", "en"] as const) {
      expect(Object.keys(dictionaries[lang]).sort()).toEqual(viKeys);
    }
  });

  it("have no empty strings", () => {
    for (const dict of Object.values(dictionaries)) {
      for (const value of Object.values(dict)) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("maps WMO weather codes", () => {
    expect(weatherCodeKey(0)).toBe("wmo.clear");
    expect(weatherCodeKey(63)).toBe("wmo.rain");
    expect(weatherCodeKey(95)).toBe("wmo.thunderstorm");
    expect(weatherCodeKey(9999)).toBeNull();
  });

  it("provides the shared placeholder and the unit glyphs in every language", () => {
    for (const lang of ["vi", "de", "en"] as const) {
      expect(dictionaries[lang]["common.none"]).toBe("—");
      expect(dictionaries[lang]["unit.km"]).toBe("km");
      expect(dictionaries[lang]["unit.meter"]).toBe("m");
      expect(dictionaries[lang]["unit.ugm3"]).toBe("µg/m³");
      expect(dictionaries[lang]["unit.deg"]).toBe("°");
    }
  });
});
