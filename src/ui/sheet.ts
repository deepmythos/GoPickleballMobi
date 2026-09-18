// State machine THUẦN của bottom sheet — tất định, không đọc clock/DOM.

export type SheetPanel = "none" | "inputs" | "location";

/** Quãng kéo xuống (px) đủ để đóng sheet khi nhả tay. */
export const SHEET_DRAG_DISMISS_PX = 96;

export interface SheetState {
  panel: SheetPanel; // "none" = đóng
  dragging: boolean;
  dragOffsetPx: number; // >= 0
}

export const initialSheetState: SheetState = {
  panel: "none",
  dragging: false,
  dragOffsetPx: 0,
};

export type SheetAction =
  | { type: "open"; panel: Exclude<SheetPanel, "none"> }
  | { type: "close" }
  | { type: "dragStart" }
  | { type: "dragMove"; offsetPx: number }
  | { type: "dragEnd" };

export function sheetReducer(state: SheetState, action: SheetAction): SheetState {
  switch (action.type) {
    case "open":
      // Mở trong lúc đang mở = đổi panel, luôn về một tầng sạch.
      return { panel: action.panel, dragging: false, dragOffsetPx: 0 };
    case "close":
      // Đường DUY NHẤT để đóng; idempotent, gọi bao nhiêu lần cũng vậy.
      return initialSheetState;
    case "dragStart":
      // Chỉ có tác dụng khi sheet đang mở.
      if (state.panel === "none") return state;
      return { ...state, dragging: true };
    case "dragMove":
      // Chỉ có tác dụng khi đang kéo; kẹp offset âm về 0 (không kéo lên quá đỉnh).
      if (!state.dragging) return state;
      return { ...state, dragOffsetPx: Math.max(0, action.offsetPx) };
    case "dragEnd":
      if (state.dragOffsetPx >= SHEET_DRAG_DISMISS_PX) return initialSheetState;
      return { ...state, dragging: false, dragOffsetPx: 0 };
  }
}

export function isSheetOpen(state: SheetState): boolean {
  return state.panel !== "none";
}

/** Hình dáng thị giác của lần kéo: một công thức duy nhất cho cả render lẫn fast-path mỗi frame. */
export function dragVisual(offsetPx: number): { offsetPx: number; backdropOpacity: number } {
  const offset = Math.max(0, offsetPx);
  return { offsetPx: offset, backdropOpacity: Math.max(0, 1 - offset / 320) };
}
