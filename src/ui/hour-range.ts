import { formatNumber, t } from "../i18n";
import type { Lang, VerdictLabel } from "../types";
import { windowSpanHours } from "../window";
import type { Actions, AppState } from "./state";

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

/**
 * Bản sao nhỏ của `h()` trong ./render. Cố ý KHÔNG import ./render để tránh vòng
 * import, và để khối này tự đứng được khi được chuyển sang màn hình chính sau này.
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

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** "16:00"; giá trị >= 24 được cuộn về 0..23 (24 = nửa đêm kết thúc ngày). */
function clockText(value: number): string {
  const hour = ((value % 24) + 24) % 24;
  return `${pad2(hour)}:00`;
}

function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1, date));
  base.setUTCDate(base.getUTCDate() + days);
  return `${base.getUTCFullYear()}-${pad2(base.getUTCMonth() + 1)}-${pad2(base.getUTCDate())}`;
}

/** Ghép ngày của cửa sổ với giờ trên thanh trượt; 24+ nghĩa là sang ngày kế tiếp. */
function combine(day: string, hourValue: number): string {
  const dayOffset = Math.floor(hourValue / 24);
  const hour = ((hourValue % 24) + 24) % 24;
  return `${shiftDay(day, dayOffset)}T${pad2(hour)}:00`;
}

function verdictLabel(lang: Lang, verdict: VerdictLabel): string {
  if (verdict === "Nên đi") return t(lang, "verdict.go");
  if (verdict === "Cân nhắc") return t(lang, "verdict.maybe");
  return t(lang, "verdict.no");
}

/**
 * Bộ chọn KHOẢNG GIỜ tự đứng (sẽ được chuyển sang màn hình chính ở ticket sau).
 * Nhận AppState + Actions, không đọc DOM của sheet, không dùng class `sheet-*`.
 *
 * DOM: .hour-range[data-from-hour][data-to-hour][data-span-hours] chứa
 * một input[type=date].input (ngày của from), hai input[type=range].hour-range-handle
 * (data-handle from/to, 0..24), nhãn .hour-range-value, .hour-range-span và .hour-range-score.
 *
 * `oninput` cập nhật nhãn/caption TẠI CHỖ (không render lại app — ticket sau còn vẽ lại
 * hình sân ở đây); `onchange` mới chốt cửa sổ qua actions.setHourRange() và re-evaluate.
 */
export function renderHourRange(state: AppState, actions: Actions): HTMLElement {
  const lang = state.lang;
  const from = state.targetHour;
  const to = state.toHour ?? state.targetHour;
  const day = from.slice(0, 10);

  let fromValue = Number(from.slice(11, 13));
  const span = windowSpanHours(from, to);
  let toValue = fromValue + (Number.isFinite(span) && span >= 0 ? span : 0);

  const fromText = el("span", { class: "hour-range-value" });
  const toText = el("span", { class: "hour-range-value" });
  const spanText = el("p", { class: "hour-range-span" });
  const scoreText = el("p", { class: "hour-range-score" });

  const refresh = (): void => {
    fromText.textContent = clockText(fromValue);
    toText.textContent = clockText(toValue);
    spanText.textContent = t(lang, "time.span", {
      from: clockText(fromValue),
      to: clockText(toValue),
      hours: String(Math.max(0, toValue - fromValue)),
    });
  };

  const range = state.evaluation?.range;
  scoreText.textContent = t(lang, "time.rangeScore", {
    score: range && range.score !== null ? formatNumber(lang, range.score) : t(lang, "common.none"),
    verdict:
      range && range.verdict !== null ? verdictLabel(lang, range.verdict) : t(lang, "common.none"),
  });
  refresh();

  const fromSlider = el("input", {
    type: "range",
    class: "range hour-range-handle",
    min: "0",
    max: "24",
    step: "1",
    value: String(fromValue),
    dataset: { handle: "from" },
    "aria-label": t(lang, "time.from"),
    "aria-valuetext": clockText(fromValue),
  });
  fromSlider.addEventListener("input", (event: Event) => {
    fromValue = Number((event.target as HTMLInputElement).value);
    if (toValue < fromValue) toValue = fromValue;
    fromSlider.setAttribute("aria-valuetext", clockText(fromValue));
    refresh();
  });
  fromSlider.addEventListener("change", () => {
    actions.setHourRange(combine(day, fromValue), combine(day, toValue));
  });

  const toSlider = el("input", {
    type: "range",
    class: "range hour-range-handle",
    min: "0",
    max: "24",
    step: "1",
    value: String(toValue),
    dataset: { handle: "to" },
    "aria-label": t(lang, "time.to"),
    "aria-valuetext": clockText(toValue),
  });
  toSlider.addEventListener("input", (event: Event) => {
    toValue = Number((event.target as HTMLInputElement).value);
    if (toValue < fromValue) fromValue = toValue;
    toSlider.setAttribute("aria-valuetext", clockText(toValue));
    refresh();
  });
  toSlider.addEventListener("change", () => {
    actions.setHourRange(combine(day, fromValue), combine(day, toValue));
  });

  const dateInput = el("input", {
    type: "date",
    class: "input",
    value: day,
    "aria-label": t(lang, "time.rangeLabel"),
  });
  dateInput.addEventListener("change", (event: Event) => {
    const nextDay = (event.target as HTMLInputElement).value || day;
    actions.setHourRange(combine(nextDay, fromValue), combine(nextDay, toValue));
  });

  return el(
    "div",
    {
      class: "hour-range",
      dataset: {
        fromHour: String(fromValue),
        toHour: String(toValue),
        spanHours: String(Math.max(0, toValue - fromValue)),
      },
    },
    dateInput,
    el("div", { class: "hour-range-row" }, fromSlider, fromText),
    el("div", { class: "hour-range-row" }, toSlider, toText),
    spanText,
    scoreText,
  );
}
