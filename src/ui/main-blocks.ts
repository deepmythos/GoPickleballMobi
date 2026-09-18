// Khối gấp DUY NHẤT gộp NGÀY/GIỜ và HƯỚNG SÂN/ÁNH SÁNG.
//
// Trước đây là hai <section> rời (data-block="time" và data-block="court"); chủ dự án
// yêu cầu gộp thành MỘT khối gấp: một dòng tóm tắt, một nội dung mở rộng chứa cả hai.
// Dùng lại đúng mẫu gấp có sẵn của hàng yếu tố: <details>/<summary> gốc của trình duyệt,
// KHÔNG dựng thêm cơ chế gấp thứ hai.
//
// - Mặc định GẤP: chỉ khi state.blocksOpen.timecourt = true mới render thuộc tính `open`.
// - Dòng tóm tắt tự đổi TẠI CHỖ khi kéo tay nắm khoảng giờ hoặc thanh bearing (không render lại app).
// - Sự kiện `toggle` chỉ ghi state.blocksOpen.timecourt + aria-expanded, KHÔNG gọi render():
//   DOM giữ nguyên trạng thái mở nên focus/scroll không mất.
//
// Hành vi kéo tay nắm giữ nguyên như khi còn là hai khối: kéo tự cập nhật tại chỗ cả hình
// full lẫn hình compact, chỉ `change` mới chốt state.

import { formatClock, formatNumber, t, type MessageKey } from "../i18n";
import { APP_TIMEZONE } from "../time";
import { midpointHourOf } from "../window";
import {
  compassSector,
  courtDiagram,
  rotateAllCourtDiagrams,
  updateAllCourtDiagramsSun,
} from "./court-diagram";
import { hourRangeSpanText, renderHourRange } from "./hour-range";
import { ICONS, makeIcon } from "./icons";
import type { Actions, AppState } from "./state";
import { diagramLabelFor, sunRangeView } from "./sun-range";

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

/** Ép khoá i18n dựng động ("compass.ne"…) về MessageKey như các module khác. */
const MSG = (key: string): MessageKey => key as MessageKey;

/**
 * Bản sao nhỏ của `h()` trong ./render. Cố ý KHÔNG import ./render: renderApp import
 * module này để ghép khối, nên import ngược lại sẽ tạo vòng.
 */
function el(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (key === "dataset") Object.assign(node.dataset, value as Record<string, string>);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
  return node;
}

/** Đưa ô nhập vào tầm nhìn khi bàn phím iOS mở ra (không để bàn phím che). */
function focusScroll(e: FocusEvent): void {
  const target = e.target as HTMLElement | null;
  target?.scrollIntoView({ block: "nearest" });
}

/**
 * Khối gấp "Ngày/giờ + Hướng sân": một <details> chứa cả bộ chọn khoảng giờ lẫn thanh
 * bearing và hình sân full. Dòng tóm tắt = mảnh khoảng giờ (tái dùng hourRangeSpanText)
 * ghép với mảnh trục sân (court.axis) qua template collapse.timeCourtSummary.
 */
export function renderTimeCourtBlock(state: AppState, actions: Actions): HTMLElement {
  const lang = state.lang;
  const ev = state.evaluation;
  const from = state.targetHour;
  const to = state.toHour ?? state.targetHour;

  /** "Bắc–Nam · 0°": hai hướng compass cộng số độ đã địa phương hoá. */
  const axisText = (bearing: number): string => {
    const rounded = Math.round(((bearing % 360) + 360) % 360) % 360;
    return t(lang, "court.axis", {
      dir: `${t(lang, MSG(`compass.${compassSector(bearing)}`))}–${t(
        lang,
        MSG(`compass.${compassSector(bearing + 180)}`),
      )}`,
      deg: formatNumber(lang, rounded),
    });
  };

  // Hai mảnh tóm tắt giữ riêng để cập nhật tại chỗ độc lập nhau khi kéo.
  const spanValue = el("span", {
    class: "collapse-span",
    text: hourRangeSpanText(lang, from, to),
  });
  const axisValue = el("span", { class: "collapse-axis", text: axisText(state.courtBearing) });

  // Dấu phân cách lấy từ chính template tóm tắt (thay hai placeholder bằng rỗng) nên
  // không có ký tự hiển thị nào bị chốt cứng ngoài i18n.
  const summaryValues = el(
    "span",
    { class: "collapse-summary-values" },
    spanValue,
    t(lang, "collapse.timeCourtSummary", { span: "", axis: "" }),
    axisValue,
  );

  const preview = (fromHour: string, toHour: string): void => {
    // Một nguồn sự thật: cùng sunRangeView() cấp dữ liệu cho cả hai mặt vẽ.
    updateAllCourtDiagramsSun(sunRangeView(state, fromHour, toHour));
    // Dòng tóm tắt đổi theo ngay, không cần render lại DOM.
    spanValue.textContent = hourRangeSpanText(lang, fromHour, toHour);
  };

  const initialRange = ev ? sunRangeView(state, ev.range.from, ev.range.to) : null;
  const bearingValue = el("span", {
    class: "bearing-value",
    text: `${formatNumber(lang, state.courtBearing)}${t(lang, "unit.deg")}`,
  });
  const courtSvg = courtDiagram({
    bearing: state.courtBearing,
    sun: ev ? { azimuth: ev.sun.azimuth, elevation: ev.sun.elevation } : null,
    sunRange: initialRange,
    isDay: ev ? ev.point.is_day !== 0 : undefined,
    variant: "full",
    ariaLabel: diagramLabelFor(state, state.courtBearing, initialRange),
    ariaLabelFor: (bearing, range) => diagramLabelFor(state, bearing, range),
    northLabel: t(lang, "compass.n"),
    noSunLabel: t(lang, "court.diagramNoSun"),
  });

  const bearingInput = el("input", {
    type: "range",
    min: "0",
    max: "359",
    step: "1",
    value: String(state.courtBearing),
    class: "range",
    "aria-label": t(lang, "court.bearing"),
    // Cập nhật nhãn, mảnh trục sân của tóm tắt VÀ xoay CẢ HAI hình ngay khi kéo
    // (KHÔNG render lại DOM giữa cử chỉ), chỉ chốt state lúc nhả tay.
    oninput: (e: Event) => {
      const value = Number((e.target as HTMLInputElement).value);
      bearingValue.textContent = `${formatNumber(lang, value)}${t(lang, "unit.deg")}`;
      axisValue.textContent = axisText(value);
      rotateAllCourtDiagrams(value);
    },
    onchange: (e: Event) => actions.setBearing(Number((e.target as HTMLInputElement).value)),
    onfocus: focusScroll,
  });

  const summary = el(
    "summary",
    {
      class: "collapse-summary",
      dataset: { collapseSummary: "timecourt" },
      "aria-expanded": state.blocksOpen.timecourt ? "true" : "false",
    },
    summaryValues,
    makeIcon(ICONS.chevronDown, 18, "collapse-chevron"),
  );

  const details = el(
    "details",
    {
      class: "collapse",
      dataset: { collapse: "timecourt" },
      // Có `open` chỉ khi state cho phép — mặc định gấp, và render lại vẫn khôi phục đúng.
      open: state.blocksOpen.timecourt ? true : false,
    },
    summary,
    el(
      "div",
      { class: "collapse-body", id: "collapse-body-timecourt" },
      el("span", { class: "field-label", text: t(lang, "time.title") }),
      el("div", { class: "hour-range-slot" }, renderHourRange(state, actions, preview)),
      el("p", {
        class: "sheet-note",
        text: t(lang, "time.midpointNote", {
          hour: formatClock(
            lang,
            state.evaluation?.detailHour ??
              state.evaluation?.range.midpointHour ??
              midpointHourOf(state.targetHour, state.toHour ?? state.targetHour),
          ),
        }),
      }),
      el("p", { class: "sheet-note", text: `${t(lang, "time.local")}: ${APP_TIMEZONE}` }),
      state.applyErrorKey === "time.invalidTime"
        ? el("p", { class: "sheet-note error-text apply-error", text: t(lang, "time.invalidTime") })
        : null,
      el("span", { class: "field-label", text: t(lang, "court.title") }),
      el("div", { class: "bearing-row" }, bearingInput, bearingValue),
      courtSvg,
    ),
  );

  // Sự kiện gấp/mở của <details>: chỉ ghi state + aria-expanded, KHÔNG render lại.
  details.addEventListener("toggle", () => {
    const open = details.hasAttribute("open");
    state.blocksOpen.timecourt = open;
    summary.setAttribute("aria-expanded", open ? "true" : "false");
  });

  return el("section", { class: "section", dataset: { block: "timecourt" } }, details);
}
