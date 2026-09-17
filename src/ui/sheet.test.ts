import { describe, expect, it } from "vitest";
import {
  initialSheetState,
  isSheetOpen,
  sheetReducer,
  type SheetState,
} from "./sheet";

/** Mở panel "inputs" từ trạng thái đóng để làm điểm xuất phát cho các ca kéo. */
function openInputs(): SheetState {
  return sheetReducer(initialSheetState, { type: "open", panel: "inputs" });
}

describe("sheetReducer", () => {
  it("opens a panel and reports the sheet as open", () => {
    const state = sheetReducer(initialSheetState, { type: "open", panel: "location" });
    expect(state.panel).toBe("location");
    expect(isSheetOpen(state)).toBe(true);
  });

  it("closes an open sheet back to the initial state", () => {
    const closed = sheetReducer(openInputs(), { type: "close" });
    expect(closed).toEqual(initialSheetState);
  });

  it("stays closed when close is dispatched twice", () => {
    const once = sheetReducer(openInputs(), { type: "close" });
    const twice = sheetReducer(once, { type: "close" });
    expect(twice).toEqual(initialSheetState);
    expect(isSheetOpen(twice)).toBe(false);
  });

  it("ignores dragStart while the sheet is closed", () => {
    const state = sheetReducer(initialSheetState, { type: "dragStart" });
    expect(state).toEqual(initialSheetState);
  });

  it("snaps back to the panel with offset 0 below the dismiss threshold", () => {
    let state = sheetReducer(openInputs(), { type: "dragStart" });
    state = sheetReducer(state, { type: "dragMove", offsetPx: 95 });
    state = sheetReducer(state, { type: "dragEnd" });
    expect(state.panel).toBe("inputs");
    expect(state.dragging).toBe(false);
    expect(state.dragOffsetPx).toBe(0);
  });

  it("dismisses at exactly the drag threshold", () => {
    let state = sheetReducer(openInputs(), { type: "dragStart" });
    state = sheetReducer(state, { type: "dragMove", offsetPx: 96 });
    state = sheetReducer(state, { type: "dragEnd" });
    expect(state).toEqual(initialSheetState);
  });

  it("clamps a negative drag offset to 0", () => {
    let state = sheetReducer(openInputs(), { type: "dragStart" });
    state = sheetReducer(state, { type: "dragMove", offsetPx: -30 });
    expect(state.dragOffsetPx).toBe(0);
  });

  it("switches to the new panel when opening another one", () => {
    const state = sheetReducer(openInputs(), { type: "open", panel: "location" });
    expect(state.panel).toBe("location");
    expect(state.dragOffsetPx).toBe(0);
    expect(state.dragging).toBe(false);
  });

  it("ends a full open → over-drag → close → reopen cycle in a clean state", () => {
    let state = sheetReducer(openInputs(), { type: "dragStart" });
    state = sheetReducer(state, { type: "dragMove", offsetPx: 120 });
    state = sheetReducer(state, { type: "dragEnd" });
    expect(state).toEqual(initialSheetState);
    state = sheetReducer(state, { type: "open", panel: "location" });
    expect(state).toEqual({ panel: "location", dragging: false, dragOffsetPx: 0 });
  });
});
