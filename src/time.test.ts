import { describe, expect, it } from "vitest";
import {
  APP_TIMEZONE,
  ceilToHour,
  formatUtcOffset,
  getOffsetMinutes,
  zonedToUtc,
} from "./time";

describe("Europe/Berlin time handling", () => {
  it("knows summer and winter offsets", () => {
    expect(getOffsetMinutes(new Date("2026-07-01T12:00:00Z"))).toBe(120);
    expect(getOffsetMinutes(new Date("2026-01-15T12:00:00Z"))).toBe(60);
  });

  it("converts winter wall-clock time to UTC", () => {
    expect(zonedToUtc("2026-01-15T12:00").toISOString()).toBe("2026-01-15T11:00:00.000Z");
  });

  it("converts summer wall-clock time to UTC", () => {
    expect(zonedToUtc("2026-07-15T12:00").toISOString()).toBe("2026-07-15T10:00:00.000Z");
  });

  it("handles the spring DST transition", () => {
    // 02:00 local does not exist; 03:00 CEST is 01:00 UTC.
    expect(zonedToUtc("2026-03-29T03:00").toISOString()).toBe("2026-03-29T01:00:00.000Z");
    expect(getOffsetMinutes(new Date("2026-03-29T01:00:00Z"), APP_TIMEZONE)).toBe(120);
  });

  it("handles the autumn DST transition", () => {
    expect(zonedToUtc("2026-10-25T02:00").toISOString()).toBe("2026-10-25T01:00:00.000Z");
    expect(getOffsetMinutes(new Date("2026-10-25T01:00:00Z"), APP_TIMEZONE)).toBe(60);
  });

  it("rounds up to the next hour", () => {
    expect(ceilToHour("2026-09-17T13:00")).toBe("2026-09-17T13:00");
    expect(ceilToHour("2026-09-17T13:01")).toBe("2026-09-17T14:00");
    expect(ceilToHour("2026-09-17T23:59")).toBe("2026-09-18T00:00");
  });

  it("formats UTC offsets", () => {
    expect(formatUtcOffset(120)).toBe("UTC+02:00");
    expect(formatUtcOffset(60)).toBe("UTC+01:00");
    expect(formatUtcOffset(-330)).toBe("UTC-05:30");
  });
});
