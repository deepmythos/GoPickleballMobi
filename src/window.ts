import { classify } from "./scoring";
import { ceilToHour, hourDiff } from "./time";
import type { VerdictLabel } from "./types";

/** Số giờ tối đa của cửa sổ đánh giá. Chặn trần cứng để tham số URL xấu không sinh hàng triệu mốc giờ. */
export const MAX_WINDOW_SPAN_HOURS = 24;

/** Số giờ mặc định của cửa sổ đánh giá: from .. from + 2 h (D1). */
export const DEFAULT_SPAN_HOURS = 2;

export interface HourScore {
  /** Mốc giờ "YYYY-MM-DDTHH:00" của bucket. */
  hour: string;
  score: number;
  verdict: VerdictLabel;
}

export interface WindowRange {
  from: string;
  to: string;
  /** hourDiff(to, from) — 2 với cửa sổ mặc định. */
  spanHours: number;
  /** from + floor(span/2) giờ (D4); mọi chi tiết thuộc giờ này. */
  midpointHour: string;
  /** Mỗi giờ CÓ dữ liệu một dòng, theo đúng thứ tự thời gian của cửa sổ. */
  hours: HourScore[];
  /** Trung bình cộng của các giờ có dữ liệu; null khi không giờ nào có dữ liệu. */
  score: number | null;
  /** classify(score); null khi score null. */
  verdict: VerdictLabel | null;
  /** Số giờ đã vào phép trung bình. */
  countedHours: number;
  /** Các giờ của cửa sổ không có dữ liệu (bị loại khỏi trung bình). */
  missingHours: string[];
}

/** Mốc giờ "YYYY-MM-DDTHH:mm" -> số ms UTC trên lịch tường (không phải instant thật). */
function parseHour(localISO: string): number | null {
  const m = localISO.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), 0, 0);
}

function formatHour(ms: number): string {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hour = String(d.getUTCHours()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:00`;
}

/**
 * Chuẩn hoá tham số giờ và XÁC THỰC định dạng. Chỉ nhận "YYYY-MM-DDTHH" (có thể kèm
 * ":mm"), từ chối ngày trần ("2026-09-18"), chuỗi rác ("abc") hay tháng/ngày/giờ vô lệ.
 * Trả về mốc "YYYY-MM-DDTHH:00" hoặc null khi không hợp lệ.
 */
function normalizeHour(value: string): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = m[5] === undefined ? 0 : Number(m[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:00`;
}

/**
 * Danh sách giờ của cửa sổ, BAO GỒM cả hai đầu, bước 1 giờ.
 * Dùng số học UTC trên lịch tường (cùng phong cách hourDiff trong ./time) nên
 * cửa sổ vượt qua nửa đêm vẫn liệt kê đúng ngày kế tiếp.
 *
 * ĐÂY LÀ NƠI DUY NHẤT dựng danh sách giờ, nên cũng là nơi DUY NHẤT chặn trần:
 * cửa sổ dài hơn MAX_WINDOW_SPAN_HOURS bị cắt còn tối đa MAX_WINDOW_SPAN_HOURS + 1 mốc.
 * Khoảng đảo ngược trả về [] (không có giờ nào).
 */
export function windowHours(from: string, to: string): string[] {
  const start = parseHour(from);
  const end = parseHour(to);
  if (start === null || end === null || end < start) return [];
  const cap = start + MAX_WINDOW_SPAN_HOURS * 3600000;
  const hours: string[] = [];
  for (let ms = start; ms <= end && ms <= cap; ms += 3600000) hours.push(formatHour(ms));
  return hours;
}

/** Số giờ giữa hai đầu cửa sổ: hourDiff(to, from). */
export function windowSpanHours(from: string, to: string): number {
  return hourDiff(to, from);
}

/** Giờ giữa cửa sổ: from + floor(span/2) giờ (D4). 16:00–18:00 -> 17:00. */
export function midpointHourOf(from: string, to: string): string {
  const span = windowSpanHours(from, to);
  const start = parseHour(from);
  if (start === null || !Number.isFinite(span) || span < 0) return from;
  return formatHour(start + Math.floor(span / 2) * 3600000);
}

/** Cửa sổ mặc định: giờ hiện tại (làm tròn lên) + DEFAULT_SPAN_HOURS giờ (D1). */
export function defaultWindow(nowLocal: string): { from: string; to: string } {
  const from = ceilToHour(nowLocal);
  const start = parseHour(from);
  if (start === null) return { from, to: from };
  return { from, to: formatHour(start + DEFAULT_SPAN_HOURS * 3600000) };
}

/**
 * NƠI DUY NHẤT định nghĩa luật gộp cửa sổ. Điểm của cửa sổ là TRUNG BÌNH CỘNG
 * (arithmetic mean) của điểm từng giờ CÓ dữ liệu, làm tròn bằng Math.round
 * (làm tròn nửa lên, giống mọi phép làm tròn khác của app).
 *
 * Tuyệt đối KHÔNG phải giờ xấu nhất, KHÔNG phải min, KHÔNG phải max. Giờ không có
 * dữ liệu bị LOẠI khỏi phép tính (không quy về 0) và được báo trong `missingHours`.
 * Nếu không giờ nào có dữ liệu thì score = null, verdict = null.
 */
export function aggregateWindow(from: string, to: string, perHour: HourScore[]): WindowRange {
  const byHour = new Map<string, HourScore>();
  for (const entry of perHour) byHour.set(entry.hour.slice(0, 16), entry);

  const hours: HourScore[] = [];
  const missingHours: string[] = [];
  for (const hour of windowHours(from, to)) {
    const entry = byHour.get(hour);
    if (entry) hours.push(entry);
    else missingHours.push(hour);
  }

  const countedHours = hours.length;
  const sum = hours.reduce((acc, entry) => acc + entry.score, 0);
  const score = countedHours > 0 ? Math.round(sum / countedHours) : null;

  return {
    from,
    to,
    spanHours: windowSpanHours(from, to),
    midpointHour: midpointHourOf(from, to),
    hours,
    score,
    verdict: score === null ? null : classify(score),
    countedHours,
    missingHours,
  };
}

export type WindowSource = "range" | "at" | "default";

/**
 * Đọc cửa sổ từ query string. Hàm THUẦN, dùng chung cho main.ts và test (D5/D6):
 * - đủ cả `from` + `to` -> cửa sổ khoảng, source "range";
 * - ngược lại có `at` -> cửa sổ SUY BIẾN from = to (một bucket, hành vi cũ), source "at";
 * - không có gì -> defaultWindow(nowLocal), source "default".
 */
export function windowFromParams(
  params: URLSearchParams,
  nowLocal: string,
): { from: string; to: string; source: WindowSource } {
  const fromRaw = params.get("from");
  const toRaw = params.get("to");
  if (fromRaw !== null && toRaw !== null) {
    // Chỉ nhận cửa sổ hợp lệ: đúng định dạng, không đảo ngược, không dài quá trần.
    // Tham số xấu rơi tiếp xuống nhánh `at`/mặc định, KHÔNG bao giờ tạo cửa sổ rác.
    const from = normalizeHour(fromRaw);
    const to = normalizeHour(toRaw);
    if (from !== null && to !== null) {
      const span = hourDiff(to, from);
      if (Number.isFinite(span) && span >= 0 && span <= MAX_WINDOW_SPAN_HOURS) {
        return { from, to, source: "range" };
      }
    }
  }
  const atRaw = params.get("at");
  if (atRaw !== null) {
    const hour = normalizeHour(atRaw);
    if (hour !== null) return { from: hour, to: hour, source: "at" };
  }
  const fallback = defaultWindow(nowLocal);
  return { from: fallback.from, to: fallback.to, source: "default" };
}
