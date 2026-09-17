import type { SunPosition } from "./types";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function sin(deg: number): number {
  return Math.sin(deg * RAD);
}
function cos(deg: number): number {
  return Math.cos(deg * RAD);
}
function tan(deg: number): number {
  return Math.tan(deg * RAD);
}
function asin(x: number): number {
  return Math.asin(Math.max(-1, Math.min(1, x))) * DEG;
}
function acos(x: number): number {
  return Math.acos(Math.max(-1, Math.min(1, x))) * DEG;
}

/**
 * Solar elevation and azimuth (NOAA algorithm) for an exact instant.
 * Azimuth is measured clockwise from true north, in degrees [0, 360).
 * No network call: pure astronomy, so results are deterministic.
 */
export function solarPosition(date: Date, lat: number, lon: number): SunPosition {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;

  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  const c =
    sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    sin(2 * m) * (0.019993 - 0.000101 * t) +
    sin(3 * m) * 0.000289;

  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * sin(omega);

  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * cos(omega);

  const declination = asin(sin(eps) * sin(lambda));

  const y = tan(eps / 2) * tan(eps / 2);
  const eqTime =
    4 *
    DEG *
    (y * sin(2 * l0) -
      2 * e * sin(m) +
      4 * e * y * sin(m) * cos(2 * l0) -
      0.5 * y * y * sin(4 * l0) -
      1.25 * e * e * sin(2 * m));

  const utcMinutes =
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  let trueSolarTime = (utcMinutes + eqTime + 4 * lon) % 1440;
  if (trueSolarTime < 0) trueSolarTime += 1440;
  let hourAngle = trueSolarTime / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;

  const zenith = acos(
    sin(lat) * sin(declination) + cos(lat) * cos(declination) * cos(hourAngle),
  );
  const elevation = 90 - zenith;

  let azimuth: number;
  const cosZenith = cos(zenith);
  const denom = cos(lat) * sin(zenith);
  if (Math.abs(denom) < 1e-9) {
    azimuth = 0;
  } else {
    const cosAz = (sin(lat) * cosZenith - sin(declination)) / denom;
    if (hourAngle > 0) {
      azimuth = (acos(cosAz) + 180) % 360;
    } else {
      azimuth = (540 - acos(cosAz)) % 360;
    }
  }

  return { elevation, azimuth };
}

/**
 * Smallest angle (0-90) between the sun azimuth and the court's long axis.
 * 0 means the sun is straight down the court axis (worst glare for a
 * baseline player), 90 means it is fully to the side.
 */
export function axisAngle(sunAzimuth: number, courtBearing: number): number {
  const a = ((sunAzimuth % 180) + 180) % 180;
  const b = ((courtBearing % 180) + 180) % 180;
  let d = Math.abs(a - b);
  if (d > 90) d = 180 - d;
  return d;
}
