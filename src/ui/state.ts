import type { AirQualityData, ForecastData, GeocodingResult } from "../api";
import type { Evaluation } from "../evaluate";
import type { BaseUrls, GeoLocation, Lang } from "../types";
import type { SheetState } from "./sheet";
import type { ThemeChoice } from "./theme";
import type { ApplyErrorKey } from "./validate";

// Re-export để giữ nguyên các import cũ từ "./ui/state" (không phá hợp đồng cũ).
export type { ThemeChoice };
export type GeoStatus = "idle" | "loading" | "done" | "error";

/** Phân biệt lỗi tìm địa điểm với lỗi định vị — hai thao tác, hai thông báo. */
export type GeoError = "search" | "locate" | null;

export interface AppState {
  lang: Lang;
  location: GeoLocation;
  /** Giờ BẮT ĐẦU của cửa sổ đánh giá (trước đây là giờ duy nhất). */
  targetHour: string;
  /**
   * Giờ KẾT THÚC của cửa sổ. Tùy chọn để mọi fixture cũ vẫn hợp lệ; nơi đọc
   * dùng `state.toHour ?? state.targetHour` (cửa sổ suy biến một giờ).
   */
  toHour?: string;
  nowLocal: string;
  courtBearing: number;
  lights: boolean;
  baseUrls: BaseUrls;
  status: "loading" | "ready" | "error";
  evaluation: Evaluation | null;
  error: string | null;
  stale: boolean;
  forecast: ForecastData | null;
  air: AirQualityData | null;
  fetchedAt: string | null;
  fetching: boolean;
  /** Tầng 1: đúng một bottom sheet đang mở (hoặc "none"). Mọi thay đổi qua sheetReducer. */
  sheet: SheetState;
  /** Panel "điều kiện thô" mặc định gấp; chỉ mở khi người dùng chạm. */
  rawOpen: boolean;
  geoStatus: GeoStatus;
  /** Nguồn của trạng thái geoStatus="error"/"loading" gần nhất — quyết định nhãn hiển thị. */
  geoError: GeoError;
  geoResults: GeocodingResult[];
  searchQuery: string;
  draft: GeoLocation;
  /** Ô nhập giờ BẮT ĐẦU (giữ tên cũ để không phá fixture). */
  atInput: string;
  /** Ô nhập giờ KẾT THÚC; tùy chọn, nơi đọc dùng `?? atInput`. */
  toInput?: string;
  /** Lỗi của lần bấm "Áp dụng" gần nhất; hiện ngay trong sheet, sheet vẫn mở. */
  applyErrorKey: ApplyErrorKey | null;
  theme: ThemeChoice;
  offline: boolean;
  update: { available: boolean; dismissed: boolean };
  /**
   * Kết quả của lần bấm "Kiểm tra cập nhật" gần nhất.
   * Tùy chọn (optional) để mọi fixture AppState cũ/khác làn vẫn hợp lệ; nơi đọc
   * dùng `?? "idle"` để mặc định là chưa kiểm tra.
   */
  updateCheck?: {
    status: "idle" | "checking" | "current" | "available" | "unsupported" | "error";
  };
}

export interface Actions {
  openSheet: (panel: "inputs" | "location") => void;
  closeSheet: () => void;
  toggleRaw: () => void;
  setLang: (lang: Lang) => void;
  setTheme: (theme: ThemeChoice) => void;
  setBearing: (bearing: number) => void;
  setLights: (lights: boolean) => void;
  setSearchQuery: (query: string) => void;
  runSearch: () => void;
  chooseGeoResult: (result: GeocodingResult) => void;
  patchDraft: (patch: Partial<GeoLocation>) => void;
  applyLocation: () => void;
  locateMe: () => void;
  setFromInput: (value: string) => void;
  setToInput: (value: string) => void;
  setHourRange: (from: string, to: string) => void;
  applyTime: () => void;
  refresh: () => void;
  checkUpdate: () => void;
  applyUpdate: () => void;
  dismissUpdate: () => void;
}
