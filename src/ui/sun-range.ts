// MỘT NGUỒN SỰ THẬT cho dữ liệu mặt trời của một khoảng giờ.
//
// Trước đây logic này nằm trong closure `rangeViewFor` của renderInputsSheet. Khi hình sân
// full được dời lên màn hình chính (và hình compact ở hàng "chói nắng" phải mang CÙNG dữ
// liệu), hai mặt vẽ cần chung một phép tính. Module này chuyển nguyên logic đó ra ngoài:
// phương vị/cao độ tính bằng `solarPosition` + `zonedToUtc`, nhãn giờ bằng `formatClock`.
//
// Tuyệt đối KHÔNG tính lại mặt trời ở chỗ nào khác: mọi mặt vẽ đều đi qua `sunRangeView`.

import { formatClock, t, type MessageKey } from "../i18n";
import { solarPosition } from "../sun";
import { APP_TIMEZONE, zonedToUtc } from "../time";
import { midpointHourOf } from "../window";
import { compassSector, type CourtDiagramSunRange } from "./court-diagram";
import type { AppState } from "./state";

/** Khoảng mặt trời caller truyền cho hình, kèm nhãn giờ của giờ giữa. */
export interface SunRangeView extends CourtDiagramSunRange {
  midpoint: string;
}

const MSG = (key: string): MessageKey => key as MessageKey;

/**
 * Khoảng mặt trời vẽ được chỉ khi cửa sổ THẬT SỰ dài hơn một giờ (nếu không, cửa sổ suy
 * biến vẫn dùng một mặt trời như cũ). Phương vị tính bằng solarPosition + zonedToUtc,
 * KHÔNG đọc lại từ evaluation để hai mặt vẽ luôn khớp khi kéo tay nắm.
 */
export function sunRangeView(state: AppState, fromHour: string, toHour: string): SunRangeView | null {
  if (fromHour === toHour) return null;
  const start = solarPosition(zonedToUtc(fromHour, APP_TIMEZONE), state.location.lat, state.location.lon);
  const end = solarPosition(zonedToUtc(toHour, APP_TIMEZONE), state.location.lat, state.location.lon);
  return {
    start: { azimuth: start.azimuth, elevation: start.elevation, label: formatClock(state.lang, fromHour) },
    end: { azimuth: end.azimuth, elevation: end.elevation, label: formatClock(state.lang, toHour) },
    midpoint: formatClock(state.lang, midpointHourOf(fromHour, toHour)),
  };
}

/**
 * Nhãn aria cho hình sân — DÙNG CHUNG cho hình full (màn hình chính) và hình compact
 * (hàng "chói nắng"). Phương vị/cao độ lấy nguyên từ evaluation.sun, không tính lại.
 * Ba key `court.diagramLabel*` giữ nguyên hợp đồng i18n.
 */
export function diagramLabelFor(
  state: AppState,
  bearing: number,
  range: CourtDiagramSunRange | null,
): string {
  const lang = state.lang;
  const ev = state.evaluation;
  const axis = Math.round(((bearing % 360) + 360) % 360) % 360;
  const axisDir = t(lang, MSG(`compass.${compassSector(bearing)}`));
  if (!ev) return t(lang, "court.diagramLabelUnknown", { axis, axisDir });
  if (ev.point.is_day === 0 || ev.sun.elevation <= 0) {
    return t(lang, "court.diagramLabelNight", { axis, axisDir });
  }
  if (range) {
    return t(lang, "court.diagramLabelRange", {
      axis,
      axisDir,
      start: range.start.label,
      end: range.end.label,
      sunStart: Math.round(range.start.azimuth),
      sunEnd: Math.round(range.end.azimuth),
      midpoint: range.midpoint ?? "",
    });
  }
  return t(lang, "court.diagramLabel", {
    axis,
    axisDir,
    sun: Math.round(ev.sun.azimuth),
    sunDir: t(lang, MSG(`compass.${compassSector(ev.sun.azimuth)}`)),
    alt: Math.round(ev.sun.elevation),
    shadowDir: t(lang, MSG(`compass.${compassSector(ev.sun.azimuth + 180)}`)),
  });
}
