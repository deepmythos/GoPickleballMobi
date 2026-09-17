import { de } from "./de";
import { en } from "./en";
import { vi, type Dict, type MessageKey } from "./vi";
import type { Lang } from "../types";

export type { Dict, MessageKey };

export const dictionaries: Record<Lang, Dict> = { vi, de, en };

export const localeByLang: Record<Lang, string> = {
  vi: "vi-VN",
  de: "de-DE",
  en: "en-GB",
};

export const langs: Lang[] = ["vi", "de", "en"];

export function isLang(value: string | null | undefined): value is Lang {
  return value === "vi" || value === "de" || value === "en";
}

export function t(lang: Lang, key: MessageKey, params?: Record<string, string | number>): string {
  let text: string = dictionaries[lang][key] ?? dictionaries.vi[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

export function formatNumber(
  lang: Lang,
  value: number,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(localeByLang[lang], options).format(value);
}

export function formatDateTime(lang: Lang, localISO: string): string {
  const m = localISO.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return localISO;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return new Intl.DateTimeFormat(localeByLang[lang], {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }).format(date);
}

export function formatClock(lang: Lang, localISO: string): string {
  const m = localISO.match(/T(\d{2}):(\d{2})/);
  if (!m) return localISO;
  const date = new Date(Date.UTC(2000, 0, 1, +m[1], +m[2]));
  return new Intl.DateTimeFormat(localeByLang[lang], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }).format(date);
}

export const WMO_GROUPS: { codes: number[]; key: MessageKey }[] = [
  { codes: [0], key: "wmo.clear" },
  { codes: [1], key: "wmo.mainlyClear" },
  { codes: [2], key: "wmo.partlyCloudy" },
  { codes: [3], key: "wmo.overcast" },
  { codes: [45, 48], key: "wmo.fog" },
  { codes: [51, 53, 55], key: "wmo.drizzle" },
  { codes: [56, 57], key: "wmo.freezingDrizzle" },
  { codes: [61, 63, 65], key: "wmo.rain" },
  { codes: [66, 67], key: "wmo.freezingRain" },
  { codes: [71, 73, 75], key: "wmo.snow" },
  { codes: [77], key: "wmo.snowGrains" },
  { codes: [80, 81, 82], key: "wmo.rainShowers" },
  { codes: [85, 86], key: "wmo.snowShowers" },
  { codes: [95], key: "wmo.thunderstorm" },
  { codes: [96, 99], key: "wmo.thunderstormHail" },
];

export function weatherCodeKey(code: number | null): MessageKey | null {
  if (code === null) return null;
  for (const group of WMO_GROUPS) {
    if (group.codes.includes(code)) return group.key;
  }
  return null;
}

export type Band = "good" | "bad" | "neutral";

export function bandFor(impact: number): Band {
  if (impact > 0.5) return "good";
  if (impact < -0.5) return "bad";
  return "neutral";
}
