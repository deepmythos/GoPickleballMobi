import { describe, expect, it } from "vitest";
import {
  createSwipeLatch,
  decideSwipeBack,
  SWIPE_BACK_MIN_PX,
  type SwipeSample,
} from "./gesture";

/** Mẫu mặc định hợp lệ: bắt đầu ở mép trái và vuốt đủ ngưỡng. */
function sample(overrides: Partial<SwipeSample> = {}): SwipeSample {
  return {
    startX: 10,
    startY: 300,
    endX: 10 + SWIPE_BACK_MIN_PX,
    endY: 300,
    durationMs: 300,
    startedInHorizontalScroller: false,
    ...overrides,
  };
}

describe("decideSwipeBack", () => {
  it("returns none just below the horizontal threshold", () => {
    const startX = 10;
    expect(decideSwipeBack(sample({ startX, endX: startX + 63 }))).toBe("none");
  });

  it("returns back exactly at the horizontal threshold", () => {
    const startX = 10;
    expect(decideSwipeBack(sample({ startX, endX: startX + 64 }))).toBe("back");
  });

  it("returns back for a real edge swipe", () => {
    expect(decideSwipeBack(sample({ startX: 10, endX: 200 }))).toBe("back");
  });

  it("returns none when swiping to the left", () => {
    expect(decideSwipeBack(sample({ startX: 10, endX: -70 }))).toBe("none");
  });

  it("returns none above the off-axis limit and back at the boundary", () => {
    const startY = 300;
    expect(decideSwipeBack(sample({ startX: 10, endX: 200, startY, endY: startY + 57 }))).toBe(
      "none",
    );
    expect(decideSwipeBack(sample({ startX: 10, endX: 200, startY, endY: startY + 56 }))).toBe(
      "back",
    );
  });

  it("returns none when starting outside the edge zone", () => {
    expect(decideSwipeBack(sample({ startX: 60, endX: 260 }))).toBe("none");
  });

  it("returns none when the gesture starts in a horizontal scroller", () => {
    expect(
      decideSwipeBack(sample({ startX: 10, endX: 200, startedInHorizontalScroller: true })),
    ).toBe("none");
  });

  it("returns none above the duration limit and back at the boundary", () => {
    expect(decideSwipeBack(sample({ startX: 10, endX: 200, durationMs: 901 }))).toBe("none");
    expect(decideSwipeBack(sample({ startX: 10, endX: 200, durationMs: 900 }))).toBe("back");
  });
});

describe("createSwipeLatch", () => {
  it("consumes a back decision only once until reset", () => {
    const latch = createSwipeLatch();
    const strong = sample({ startX: 10, endX: 200 });
    expect([latch.decide(strong), latch.decide(strong)]).toEqual(["back", "none"]);
    latch.reset();
    expect(latch.decide(strong)).toBe("back");
  });

  it("does not consume anything on a below-threshold gesture", () => {
    const latch = createSwipeLatch();
    const weak = sample({ startX: 10, endX: 10 + 63 });
    expect([latch.decide(weak), latch.decide(weak)]).toEqual(["none", "none"]);
    latch.reset();
    expect(latch.decide(sample({ startX: 10, endX: 200 }))).toBe("back");
  });
});
