import { describe, expect, it } from "vitest";
import { parseCoordInput, validateAtInput, validateDraftLocation, validateRangeInput } from "./validate";

describe("parseCoordInput", () => {
  it("ô trống trả NaN, KHÔNG được hoá thành 0", () => {
    expect(Number.isNaN(parseCoordInput(""))).toBe(true);
    expect(parseCoordInput("")).not.toBe(0);
    expect(Number.isNaN(parseCoordInput("   "))).toBe(true);
  });

  it("giữ nguyên số hợp lệ", () => {
    expect(parseCoordInput("8.76")).toBe(8.76);
    expect(parseCoordInput("-90")).toBe(-90);
    expect(parseCoordInput("0")).toBe(0);
  });

  it("chuỗi không phải số trả NaN", () => {
    expect(Number.isNaN(parseCoordInput("abc"))).toBe(true);
    expect(Number.isNaN(parseCoordInput("12abc"))).toBe(true);
  });
});

describe("validateDraftLocation", () => {
  it("từ chối NaN (ô trống) với errorKey location.invalidCoords", () => {
    const result = validateDraftLocation({ lat: Number.NaN, lon: 8.76, name: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorKey).toBe("location.invalidCoords");
      expect("location" in result).toBe(false);
    }
  });

  it("từ chối vĩ độ ngoài khoảng", () => {
    const result = validateDraftLocation({ lat: 91, lon: 8.76, name: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorKey).toBe("location.invalidCoords");
      expect("location" in result).toBe(false);
    }
  });

  it("từ chối kinh độ ngoài khoảng", () => {
    const result = validateDraftLocation({ lat: 49, lon: -181, name: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorKey).toBe("location.invalidCoords");
      expect("location" in result).toBe(false);
    }
  });

  it("gốc toạ độ 0,0 hợp lệ và tự đặt tên khi tên rỗng", () => {
    const result = validateDraftLocation({ lat: 0, lon: 0, name: "" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.location.name).toBe("0.0000, 0.0000");
      expect(result.location.lat).toBe(0);
      expect(result.location.lon).toBe(0);
    }
  });

  it("trả object MỚI và KHÔNG sửa draft gốc", () => {
    const draft = { lat: 49.9960846, lon: 8.7605459, name: "  Sân  " };
    const before = { ...draft };
    const result = validateDraftLocation(draft);
    expect(result.ok).toBe(true);
    expect(draft).toEqual(before);
    if (result.ok) {
      expect(result.location).not.toBe(draft);
      expect(result.location.name).toBe("Sân");
    }
  });

  it("giữ tên đã nhập khi có nội dung", () => {
    const result = validateDraftLocation({ lat: 10, lon: 20, name: "Court" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.location.name).toBe("Court");
  });
});

describe("validateAtInput", () => {
  it("từ chối chuỗi rỗng", () => {
    const result = validateAtInput("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorKey).toBe("time.invalidTime");
      expect("targetHour" in result).toBe(false);
    }
  });

  it("từ chối ngày thiếu giờ", () => {
    const result = validateAtInput("2026-09-18");
    expect(result.ok).toBe(false);
    if (!result.ok) expect("targetHour" in result).toBe(false);
  });

  it("từ chối tháng ngoài khoảng", () => {
    const result = validateAtInput("2026-13-01T10:00");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorKey).toBe("time.invalidTime");
  });

  it("từ chối giờ ngoài khoảng", () => {
    const result = validateAtInput("2026-09-18T25:00");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorKey).toBe("time.invalidTime");
  });

  it("chấp nhận mốc hợp lệ và làm tròn về đầu giờ", () => {
    const result = validateAtInput("2026-09-18T14:37");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.targetHour).toBe("2026-09-18T14:00");
  });
});

describe("validateRangeInput", () => {
  it("chấp nhận khoảng hợp lệ và chuẩn hoá về đầu giờ", () => {
    const result = validateRangeInput("2026-09-18T16:00", "2026-09-18T18:00");
    expect(result).toEqual({ ok: true, from: "2026-09-18T16:00", to: "2026-09-18T18:00" });
    const normalized = validateRangeInput("2026-09-18T16:37", "2026-09-18T18:12");
    expect(normalized).toEqual({ ok: true, from: "2026-09-18T16:00", to: "2026-09-18T18:00" });
  });

  it("chấp nhận cửa sổ suy biến (from = to)", () => {
    const result = validateRangeInput("2026-09-18T16:00", "2026-09-18T16:00");
    expect(result).toEqual({ ok: true, from: "2026-09-18T16:00", to: "2026-09-18T16:00" });
  });

  it("từ chối khi `to` đứng trước `from`", () => {
    const result = validateRangeInput("2026-09-18T18:00", "2026-09-18T16:00");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorKey).toBe("time.invalidTime");
      expect("from" in result).toBe(false);
    }
  });

  it("từ chối khoảng dài hơn 24 giờ", () => {
    const result = validateRangeInput("2026-09-18T00:00", "2026-09-20T00:00");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorKey).toBe("time.invalidTime");
    // Đúng 24 giờ vẫn hợp lệ.
    const border = validateRangeInput("2026-09-18T00:00", "2026-09-19T00:00");
    expect(border).toEqual({ ok: true, from: "2026-09-18T00:00", to: "2026-09-19T00:00" });
  });

  it("từ chối đầu mút rỗng hoặc sai định dạng", () => {
    expect(validateRangeInput("", "2026-09-18T18:00").ok).toBe(false);
    expect(validateRangeInput("2026-09-18T16:00", "").ok).toBe(false);
    expect(validateRangeInput("2026-09-18", "2026-09-18T18:00").ok).toBe(false);
    expect(validateRangeInput("abc", "def").ok).toBe(false);
  });
});
