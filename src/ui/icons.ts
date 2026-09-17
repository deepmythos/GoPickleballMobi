import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Cloud,
  CloudDrizzle,
  CloudRain,
  Droplets,
  Eye,
  Gauge,
  Globe,
  Info,
  Leaf,
  Loader2,
  LocateFixed,
  MapPin,
  Minus,
  Moon,
  MoonStar,
  Navigation,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Snowflake,
  Sun,
  Sunrise,
  Sunset,
  Thermometer,
  ThermometerSun,
  Umbrella,
  Waves,
  Wind,
  X,
  Zap,
  createElement,
  type IconNode,
} from "lucide";

export const ICONS = {
  mapPin: MapPin,
  chevronDown: ChevronDown,
  settings: Settings,
  calendar: CalendarClock,
  refresh: RefreshCw,
  search: Search,
  locate: LocateFixed,
  sun: Sun,
  moon: Moon,
  moonStar: MoonStar,
  cloudRain: CloudRain,
  cloudDrizzle: CloudDrizzle,
  cloud: Cloud,
  umbrella: Umbrella,
  wind: Wind,
  zap: Zap,
  thermometer: Thermometer,
  thermometerSun: ThermometerSun,
  snowflake: Snowflake,
  eye: Eye,
  waves: Waves,
  leaf: Leaf,
  navigation: Navigation,
  close: X,
  arrowLeft: ArrowLeft,
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  sliders: SlidersHorizontal,
  minus: Minus,
  shieldAlert: ShieldAlert,
  info: Info,
  check: CheckCircle2,
  warning: AlertTriangle,
  globe: Globe,
  droplets: Droplets,
  sunrise: Sunrise,
  sunset: Sunset,
  loader: Loader2,
  gauge: Gauge,
} as const;

export type IconName = keyof typeof ICONS;

const FACTOR_ICONS: Record<string, IconNode> = {
  rain_current: CloudRain,
  rain_probability: Umbrella,
  rain_24h: CloudDrizzle,
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
