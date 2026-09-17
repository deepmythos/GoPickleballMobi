export const APP_TIMEZONE = "Europe/Berlin";

export interface LocalParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

export function getLocalParts(date: Date, timeZone = APP_TIMEZONE): LocalParts {
  const out: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(date)) {
    if (part.type !== "literal") out[part.type] = part.value;
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/**
 * Offset of a timezone at a given instant, in minutes east of UTC.
 * Handles DST because Intl resolves the zone rules for the exact date.
 */
export function getOffsetMinutes(date: Date, timeZone = APP_TIMEZONE): number {
  const p = getLocalParts(date, timeZone);
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUTC - date.getTime()) / 60000);
}

/**
 * Convert a wall-clock time in `timeZone` ("YYYY-MM-DDTHH:mm", no offset)
 * into the corresponding UTC instant, resolving DST.
 */
export function zonedToUtc(localISO: string, timeZone = APP_TIMEZONE): Date {
  const m = localISO.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) throw new Error(`Invalid local time: ${localISO}`);
  const [, y, mo, d, h, mi] = m;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0);
  const off1 = getOffsetMinutes(new Date(guess), timeZone);
  let utc = guess - off1 * 60000;
  const off2 = getOffsetMinutes(new Date(utc), timeZone);
  if (off2 !== off1) utc = guess - off2 * 60000;
  return new Date(utc);
}

export function formatLocalISO(date: Date, timeZone = APP_TIMEZONE): string {
  const p = getLocalParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function formatLocalHour(date: Date, timeZone = APP_TIMEZONE): string {
  const p = getLocalParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
}

export function formatUtcOffset(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}

/** Round a local ISO time up to the next full hour ("YYYY-MM-DDTHH:00"). */
export function ceilToHour(localISO: string): string {
  const m = localISO.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) throw new Error(`Invalid local time: ${localISO}`);
  const [, y, mo, d, h, mi] = m;
  const base = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), 0, 0));
  if (Number(mi) > 0) base.setUTCHours(base.getUTCHours() + 1);
  const p = {
    year: base.getUTCFullYear(),
    month: String(base.getUTCMonth() + 1).padStart(2, "0"),
    day: String(base.getUTCDate()).padStart(2, "0"),
    hour: String(base.getUTCHours()).padStart(2, "0"),
  };
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
}

/** Difference in whole hours between two local wall-clock strings. */
export function hourDiff(a: string, b: string): number {
  const ma = a.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  const mb = b.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!ma || !mb) return NaN;
  const da = Date.UTC(+ma[1], +ma[2] - 1, +ma[3], +ma[4], +ma[5]);
  const db = Date.UTC(+mb[1], +mb[2] - 1, +mb[3], +mb[4], +mb[5]);
  return Math.round((da - db) / 3600000);
}
