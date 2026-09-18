// Validation THUẦN cho dữ liệu người dùng nhập trước khi "Áp dụng".
// Không phụ thuộc DOM; chỉ dùng thêm hàm thuần hourDiff từ ../time.

import { hourDiff } from "../time";
import type { GeoLocation } from "../types";

export type ApplyErrorKey = "location.invalidCoords" | "time.invalidTime";

/** Ô trống KHÔNG được coi là 0: chuỗi rỗng (sau trim) trả về NaN. */
export function parseCoordInput(raw: string): number {
  if (raw.trim() === "") return Number.NaN;
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * Kiểm tra toạ độ nháp trước khi áp dụng. Từ chối khi vĩ độ/kinh độ không hữu hạn
 * (gồm cả NaN do ô trống) hoặc ngoài khoảng hợp lệ. Khi hợp lệ trả về object MỚI,
 * không sửa draft gốc.
 */
export function validateDraftLocation(
  draft: GeoLocation,
): { ok: true; location: GeoLocation } | { ok: false; errorKey: ApplyErrorKey } {
  const { lat, lon, name } = draft;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, errorKey: "location.invalidCoords" };
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { ok: false, errorKey: "location.invalidCoords" };
  }
  return {
    ok: true,
    location: {
      lat,
      lon,
      name: name.trim() || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    },
  };
}

/**
 * Kiểm tra ô ngày-giờ trước khi áp dụng. Từ chối khi rỗng, sai mẫu ISO phút,
 * hoặc tháng/ngày/giờ/phút ngoài khoảng.
 */
export function validateAtInput(
  value: string,
): { ok: true; targetHour: string } | { ok: false; errorKey: ApplyErrorKey } {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return { ok: false, errorKey: "time.invalidTime" };
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return { ok: false, errorKey: "time.invalidTime" };
  }
  return { ok: true, targetHour: `${value.slice(0, 13)}:00` };
}

/**
 * Kiểm tra CẢ HAI đầu của cửa sổ giờ trước khi áp dụng. Mỗi đầu phải là mốc giờ hợp lệ;
 * `to` không được đứng trước `from` và cửa sổ không được dài quá 24 giờ. Vi phạm ->
 * `time.invalidTime`. Khi hợp lệ trả object MỚI đã chuẩn hoá về "YYYY-MM-DDTHH:00".
 */
export function validateRangeInput(
  fromValue: string,
  toValue: string,
): { ok: true; from: string; to: string } | { ok: false; errorKey: ApplyErrorKey } {
  const from = validateAtInput(fromValue);
  if (!from.ok) return from;
  const to = validateAtInput(toValue);
  if (!to.ok) return to;
  const span = hourDiff(to.targetHour, from.targetHour);
  if (!Number.isFinite(span) || span < 0 || span > 24) {
    return { ok: false, errorKey: "time.invalidTime" };
  }
  return { ok: true, from: from.targetHour, to: to.targetHour };
}
