import { describe, expect, it } from "vitest";
import { impactBar } from "./impact";

describe("impactBar", () => {
  it("zero impact has no side and no width", () => {
    expect(impactBar(0, 5)).toEqual({ side: "none", widthPct: 0 });
  });

  it("full positive impact fills the bar", () => {
    expect(impactBar(5, 5)).toEqual({ side: "pos", widthPct: 100 });
  });

  it("full negative impact fills the bar on the negative side", () => {
    expect(impactBar(-5, 5)).toEqual({ side: "neg", widthPct: 100 });
  });

  it("clamps over-max impact to 100", () => {
    expect(impactBar(9, 5)).toEqual({ side: "pos", widthPct: 100 });
    expect(impactBar(-9, 5)).toEqual({ side: "neg", widthPct: 100 });
  });

  it("is safe when maxWeight is zero or negative", () => {
    expect(impactBar(2, 0)).toEqual({ side: "pos", widthPct: 0 });
    expect(impactBar(-2, 0)).toEqual({ side: "neg", widthPct: 0 });
    expect(impactBar(2, -3)).toEqual({ side: "pos", widthPct: 0 });
  });

  it("keeps the sign and rounds the width to one decimal", () => {
    const pos = impactBar(2, 3);
    expect(pos.side).toBe("pos");
    expect(pos.widthPct).toBe(66.7);
    const neg = impactBar(-1, 3);
    expect(neg.side).toBe("neg");
    expect(neg.widthPct).toBe(33.3);
  });
});
