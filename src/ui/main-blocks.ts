// Hai khối điều khiển dời từ sheet Cài đặt lên MÀN HÌNH CHÍNH, ngay dưới hero:
//   - renderTimeBlock  -> <section class="section" data-block="time">
//   - renderCourtBlock -> <section class="section" data-block="court">
//
// Đổi thứ tự = đổi 1 dòng trong renderApp (xem src/ui/render.ts), không phải sửa module này.
//
// Hành vi giữ nguyên như khi còn nằm trong sheet: kéo tay nắm tự cập nhật TẠI CHỖ cả hình
// full lẫn hình compact, không bấm nút "Áp dụng". Nút đó đã bị bỏ vì nó chỉ áp
// state.atInput/state.toInput — thứ bộ chọn khoảng giờ KHÔNG hề đặt.

import { formatClock, formatNumber, t } from "../i18n";
import { APP_TIMEZONE } from "../time";
import { midpointHourOf } from "../window";
import {
  courtDiagram,
  rotateAllCourtDiagrams,
  updateAllCourtDiagramsSun,
} from "./court-diagram";
import { renderHourRange } from "./hour-range";
import type { Actions, AppState } from "./state";
import { diagramLabelFor, sunRangeView } from "./sun-range";

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

/**
 * Bản sao nhỏ của `h()` trong ./render. Cố ý KHÔNG import ./render: renderApp import
 * module này để ghép hai khối, nên import ngược lại sẽ tạo vòng.
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
 * Khối NGÀY/GIỜ. Kéo tay nắm khoảng giờ vẽ lại phần mặt trời của MỌI hình đang sống
 * (full + compact) trong cùng một nhịp; chỉ `change` mới chốt state qua setHourRange.
 * Không còn nút "Áp dụng" (xem ghi chú đầu file).
 */
export function renderTimeBlock(state: AppState, actions: Actions): HTMLElement {
  const lang = state.lang;
  const preview = (fromHour: string, toHour: string): void => {
    // Một nguồn sự thật: cùng sunRangeView() cấp dữ liệu cho cả hai mặt vẽ.
    updateAllCourtDiagramsSun(sunRangeView(state, fromHour, toHour));
  };
  return el(
    "section",
    { class: "section", dataset: { block: "time" } },
    el("span", { class: "field-label", text: t(lang, "time.title") }),
    renderHourRange(state, actions, preview),
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
  );
}

/**
 * Khối HƯỚNG SÂN/ÁNH SÁNG với hình FULL. Kéo thanh bearing xoay TẠI CHỖ cả hình full lẫn
 * hình compact; chỉ `change` mới chốt state qua setBearing (giống hành vi cũ).
 * Công tắc "Sân có đèn" KHÔNG thuộc khối này — nó ở lại sheet Cài đặt.
 */
export function renderCourtBlock(state: AppState, actions: Actions): HTMLElement {
  const lang = state.lang;
  const ev = state.evaluation;
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
  return el(
    "section",
    { class: "section", dataset: { block: "court" } },
    el("span", { class: "field-label", text: t(lang, "court.title") }),
    el(
      "div",
      { class: "bearing-row" },
      el("input", {
        type: "range",
        min: "0",
        max: "359",
        step: "1",
        value: String(state.courtBearing),
        class: "range",
        "aria-label": t(lang, "court.bearing"),
        // Cập nhật nhãn VÀ xoay CẢ HAI hình ngay khi kéo (KHÔNG render lại DOM giữa cử chỉ),
        // chỉ chốt state lúc nhả tay để thanh trượt không bị huỷ.
        oninput: (e: Event) => {
          const value = Number((e.target as HTMLInputElement).value);
          bearingValue.textContent = `${formatNumber(lang, value)}${t(lang, "unit.deg")}`;
          rotateAllCourtDiagrams(value);
        },
        onchange: (e: Event) => actions.setBearing(Number((e.target as HTMLInputElement).value)),
        onfocus: focusScroll,
      }),
      bearingValue,
    ),
    courtSvg,
  );
}
