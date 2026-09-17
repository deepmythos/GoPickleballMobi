import type { AirQualityData, ForecastData, GeocodingResult } from "../api";
import type { Evaluation } from "../evaluate";
import type { BaseUrls, GeoLocation, Lang } from "../types";

export type Panel = "none" | "location" | "time" | "settings";
export type ThemeChoice = "system" | "light" | "dark";
export type GeoStatus = "idle" | "loading" | "done" | "error";

export interface AppState {
  lang: Lang;
  location: GeoLocation;
  targetHour: string;
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
  panel: Panel;
  geoStatus: GeoStatus;
  geoResults: GeocodingResult[];
  searchQuery: string;
  draft: GeoLocation;
  atInput: string;
  theme: ThemeChoice;
}

export interface Actions {
  openPanel: (panel: Panel) => void;
  closePanel: () => void;
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
  setAtInput: (value: string) => void;
  applyTime: () => void;
  useNextHour: () => void;
  refresh: () => void;
}
