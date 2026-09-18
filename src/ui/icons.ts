import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  Cloud,
  CloudDrizzle,
  CloudRain,
  Droplets,
  Eye,
  Gauge,
  Info,
  Leaf,
  Loader2,
  LocateFixed,
  MapPin,
  Moon,
  MoonStar,
  Navigation,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Snowflake,
  Sun,
  Thermometer,
  ThermometerSun,
  Umbrella,
  Wind,
  X,
  Zap,
  createElement,
  type IconNode,
} from "lucide";

export const ICONS = {
  mapPin: MapPin,
  chevronDown: ChevronDown,
  calendar: CalendarClock,
  refresh: RefreshCw,
  search: Search,
  locate: LocateFixed,
  sun: Sun,
  moon: Moon,
  navigation: Navigation,
  close: X,
  arrowLeft: ArrowLeft,
  sliders: SlidersHorizontal,
  shieldAlert: ShieldAlert,
  info: Info,
  warning: AlertTriangle,
  loader: Loader2,
  gauge: Gauge,
} as const;

export type IconName = keyof typeof ICONS;

const FACTOR_ICONS: Record<string, IconNode> = {
  rain_current: CloudRain,
  rain_probability: Umbrella,
  rain_3h: CloudDrizzle,
  wind_speed: Wind,
  wind_gust: Zap,
  apparent_temperature: Thermometer,
  uv_index: Sun,
  cloud_cover: Cloud,
  visibility: Eye,
  european_aqi: Leaf,
  sun_bearing: Navigation,
  is_day: MoonStar,
  playability: ShieldAlert,
};

const GATE_ICONS: Record<string, IconNode> = {
  night: MoonStar,
  rain: CloudRain,
  gust: Zap,
  heat: ThermometerSun,
  cold: Snowflake,
  wet: Droplets,
};

export function factorIcon(id: string, size = 20): SVGElement {
  return makeIcon(FACTOR_ICONS[id] ?? Info, size);
}

export function gateIcon(id: string, size = 18): SVGElement {
  return makeIcon(GATE_ICONS[id] ?? AlertTriangle, size);
}

export function makeIcon(node: IconNode, size = 20, className = ""): SVGElement {
  return createElement(node, {
    width: String(size),
    height: String(size),
    class: `icon${className ? ` ${className}` : ""}`,
    "stroke-width": "1.9",
    "aria-hidden": "true",
    focusable: "false",
  }) as unknown as SVGElement;
}
