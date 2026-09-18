import { dictionaries, t, type MessageKey } from "./i18n";
import type { Lang } from "./types";

/** Khoá i18n của từng đơn vị hiển thị trong danh sách yếu tố (đều đã tồn tại trong unit.*). */
export const UNIT_KEY = {
  mmh: "unit.mmh",
  mm: "unit.mm",
  kmh: "unit.kmh",
  percent: "unit.percent",
  celsius: "unit.celsius",
  meter: "unit.meter",
  deg: "unit.deg",
  uv: "unit.uv",
  eaqi: "unit.eaqi",
} as const satisfies Record<string, MessageKey>;

export type UnitId = keyof typeof UNIT_KEY;

/** Chuỗi hiển thị của đơn vị — nguồn DUY NHẤT là từ điển (vi), không có literal rời rạc ở đây. */
export const UNIT: Record<UnitId, string> = {
  mmh: dictionaries.vi["unit.mmh"],
  mm: dictionaries.vi["unit.mm"],
  kmh: dictionaries.vi["unit.kmh"],
  percent: dictionaries.vi["unit.percent"],
  celsius: dictionaries.vi["unit.celsius"],
  meter: dictionaries.vi["unit.meter"],
  deg: dictionaries.vi["unit.deg"],
  uv: dictionaries.vi["unit.uv"],
  eaqi: dictionaries.vi["unit.eaqi"],
};

const UNIT_TEXT_TO_KEY: Record<string, MessageKey> = Object.fromEntries(
  (Object.keys(UNIT) as UnitId[]).map((id) => [UNIT[id], UNIT_KEY[id]] as const),
);

/** Tra ngược chuỗi hiển thị -> khoá i18n; null nếu không có trong bảng (vd "bool"). */
export function unitKey(unit: string): MessageKey | null {
  return UNIT_TEXT_TO_KEY[unit] ?? null;
}

/** Chuỗi hiển thị của đơn vị theo ngôn ngữ; không tra được thì trả nguyên chuỗi cũ. */
export function unitText(lang: Lang, unit: string): string {
  const key = unitKey(unit);
  return key === null ? unit : t(lang, key);
}
