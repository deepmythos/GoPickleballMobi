// Mã hoá mức tác động của một yếu tố thành thanh mảnh + dấu.
// Hàm THUẦN: cùng input cho cùng output, không đọc DOM.

export interface ImpactBar {
  side: "pos" | "neg" | "none";
  widthPct: number;
}

/**
 * Độ dài thanh = |impact| / maxWeight, kẹp [0, 100], làm tròn 1 chữ số.
 * - impact === 0 → side "none", widthPct 0 (không có gì để vẽ).
 * - maxWeight <= 0 → widthPct 0 (không có trọng số tham chiếu), vẫn giữ dấu.
 */
export function impactBar(impact: number, maxWeight: number): ImpactBar {
  if (impact === 0) return { side: "none", widthPct: 0 };
  const side: ImpactBar["side"] = impact > 0 ? "pos" : "neg";
  if (!(maxWeight > 0)) return { side, widthPct: 0 };
  const clamped = Math.max(0, Math.min(100, (Math.abs(impact) / maxWeight) * 100));
  return { side, widthPct: Math.round(clamped * 10) / 10 };
}
