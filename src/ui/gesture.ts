// Quyết định cử chỉ vuốt lùi (swipe-back) — THUẦN, không đọc DOM/clock.
// Tầng gọi chịu trách nhiệm thu thập mẫu chạm và xác định vùng cuộn ngang.

/** Vùng mép trái (px) được coi là "bắt đầu từ mép". */
export const SWIPE_EDGE_ZONE_PX = 28;
/** Quãng ngang tối thiểu (px) để tính là "lùi một cấp". */
export const SWIPE_BACK_MIN_PX = 64;
/** Lệch dọc tối đa (px) cho phép; quá lớn nghĩa là người dùng đang cuộn dọc. */
export const SWIPE_MAX_OFF_AXIS_PX = 56;
/** Vuốt lâu hơn mức này (ms) không còn là cử chỉ lùi. */
export const SWIPE_MAX_DURATION_MS = 900;

export interface SwipeSample {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  durationMs: number;
  /** true nếu điểm chạm nằm trong vùng cuộn ngang (băng chọn, slider...) — do tầng gọi xác định. */
  startedInHorizontalScroller: boolean;
}

export type SwipeOutcome = "back" | "none";

/** Trả "back" chỉ khi mẫu thoả mọi điều kiện; ngược lại "none". Biên tính là hợp lệ. */
export function decideSwipeBack(sample: SwipeSample): SwipeOutcome {
  const { startX, startY, endX, endY, durationMs, startedInHorizontalScroller } = sample;
  // Vùng cuộn ngang tự xử lý cử chỉ của nó.
  if (startedInHorizontalScroller) return "none";
  // Bắt buộc bắt đầu từ mép trái.
  if (startX > SWIPE_EDGE_ZONE_PX) return "none";
  // Vuốt quá lâu không phải cử chỉ lùi.
  if (durationMs > SWIPE_MAX_DURATION_MS) return "none";
  // Phải đủ quãng ngang sang phải (vuốt sang trái = "none").
  if (endX - startX < SWIPE_BACK_MIN_PX) return "none";
  // Lệch dọc quá nhiều → để dành cho cuộn dọc.
  if (Math.abs(endY - startY) > SWIPE_MAX_OFF_AXIS_PX) return "none";
  return "back";
}

/**
 * Bọc trạng thái "đã tiêu thụ" của một cử chỉ: quyết định đầu tiên là "back"
 * sẽ khoá các quyết định sau cho tới khi reset() — bảo đảm một cử chỉ chỉ lùi đúng một cấp.
 */
export function createSwipeLatch(): { decide(sample: SwipeSample): SwipeOutcome; reset(): void } {
  let consumed = false;
  return {
    decide(sample: SwipeSample): SwipeOutcome {
      if (consumed) return "none";
      const outcome = decideSwipeBack(sample);
      if (outcome === "back") consumed = true;
      return outcome;
    },
    reset(): void {
      consumed = false;
    },
  };
}
