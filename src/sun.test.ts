import { describe, expect, it } from "vitest";
import { axisAngle, solarPosition } from "./sun";

describe("solarPosition", () => {
  it("puts the sun high at summer noon in Dietzenbach", () => {
    const sun = solarPosition(new Date("2026-06-21T11:15:00Z"), 49.9960846, 8.7605459);
    expect(sun.elevation).toBeGreaterThan(60);
    expect(sun.elevation).toBeLessThan(66);
    expect(sun.azimuth).toBeGreaterThan(120);
    expect(sun.azimuth).toBeLessThan(220);
  });

  it("puts the sun below the horizon at night", () => {
    const sun = solarPosition(new Date("2026-12-21T23:00:00Z"), 49.9960846, 8.7605459);
    expect(sun.elevation).toBeLessThan(0);
  });

  it("never returns NaN", () => {
    const sun = solarPosition(new Date("2026-03-29T01:00:00Z"), 49.9960846, 8.7605459);
    expect(Number.isFinite(sun.elevation)).toBe(true);
    expect(Number.isFinite(sun.azimuth)).toBe(true);
  });
});

describe("axisAngle", () => {
  it("is 0 when aligned with the court axis", () => {
    expect(axisAngle(180, 0)).toBe(0);
    expect(axisAngle(0, 0)).toBe(0);
  });
  it("is 90 when perpendicular", () => {
    expect(axisAngle(90, 0)).toBe(90);
    expect(axisAngle(270, 0)).toBe(90);
  });
  it("is symmetric around the axis", () => {
    expect(axisAngle(200, 0)).toBe(20);
    expect(axisAngle(160, 0)).toBe(20);
  });
});
