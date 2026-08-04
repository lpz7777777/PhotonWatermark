"use client";

import { ChangeEvent, DragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import exifr from "exifr";
import JSZip from "jszip";

type PresetId = "classic" | "noir" | "gallery" | "overlay" | "kodak" | "fujifilm" | "provia" | "northern-blue" | "forest-gold" | "editorial" | "monolith" | "archive" | "centered" | "floating" | "cinematic" | "immersive" | "sidecar";
type ExportFormat = "png" | "jpeg";
type ElementId = "cameraBrand" | "cameraModel" | "lens" | "aperture" | "exposure" | "iso" | "focalLength" | "signature" | "date" | "location" | "filmBrand" | "filmName" | "lab" | "scanner";
type LayoutKey = PresetId | `film-mode-${PresetId}` | `film-compact-${PresetId}`;

type ElementTransform = {
  x: number;
  y: number;
  scale: number;
  fontScale: number;
};

type ElementBounds = { x: number; y: number; width: number; height: number };
type ElementBoundsMap = Partial<Record<ElementId, ElementBounds>>;
type RenderedPhoto = { canvas: HTMLCanvasElement; bounds: ElementBoundsMap };

type PhotoMetadata = {
  make?: string;
  model?: string;
  lens?: string;
  aperture?: string;
  exposure?: string;
  iso?: string;
  focalLength?: string;
  takenAt?: string;
  location?: string;
};

type PhotoItem = {
  id: string;
  file: File;
  url: string;
  image: CanvasImageSource;
  width: number;
  height: number;
  metadata: PhotoMetadata;
  filmMetadata: PhotoMetadata;
  autoMetadata: PhotoMetadata;
  coordinates?: { latitude: number; longitude: number };
};

const defaultFilmMetadata: PhotoMetadata = {
  make: "OLYMPUS",
  model: "OM-1",
  lens: "50mm/1.8",
  aperture: "",
  exposure: "",
  iso: "100",
  focalLength: "",
  takenAt: "",
  location: "地点",
};

type Settings = {
  preset: PresetId;
  bandSize: number;
  filmBandSize: number;
  signature: string;
  showSignature: boolean;
  showBrand: boolean;
  showModel: boolean;
  showDate: boolean;
  showLens: boolean;
  showAperture: boolean;
  showExposure: boolean;
  showIso: boolean;
  showFocalLength: boolean;
  showLocationByPreset: Partial<Record<PresetId, boolean>>;
  filmMode: boolean;
  filmCompact: boolean;
  filmShowSignature: boolean;
  filmShowBrand: boolean;
  filmShowModel: boolean;
  filmShowDate: boolean;
  filmShowLens: boolean;
  filmShowAperture: boolean;
  filmShowExposure: boolean;
  filmShowIso: boolean;
  filmShowFocalLength: boolean;
  filmBrand: string;
  filmName: string;
  labName: string;
  scannerBrand: string;
  scannerName: string;
  showFilmBrand: boolean;
  showFilmName: boolean;
  showLab: boolean;
  showScanner: boolean;
  transforms: Partial<Record<LayoutKey, Partial<Record<ElementId, ElementTransform>>>>;
  format: ExportFormat;
};

type Layout = {
  width: number;
  height: number;
  photoX: number;
  photoY: number;
  photoWidth: number;
  photoHeight: number;
  bandX: number;
  bandY: number;
  bandWidth: number;
  bandHeight: number;
};

type ThemePalette = {
  background: string;
  ink: string;
  muted: string;
  faint: string;
  accent: string;
};

const presets: Array<{ id: PresetId; name: string; note: string; swatch: string }> = [
  { id: "classic", name: "经典铭牌", note: "还原样片", swatch: "classic" },
  { id: "centered", name: "纯白画册", note: "居中信息卡", swatch: "centered" },
  { id: "floating", name: "浮光画册", note: "悬浮留白", swatch: "floating" },
  { id: "cinematic", name: "暮色浮影", note: "柔焦暗场", swatch: "cinematic" },
  { id: "immersive", name: "沉浸底片", note: "画内叠印", swatch: "immersive" },
  { id: "noir", name: "夜黑铭牌", note: "高反差", swatch: "noir" },
  { id: "gallery", name: "画廊相框", note: "四周留白", swatch: "gallery" },
  { id: "overlay", name: "渐变叠印", note: "不增加尺寸", swatch: "overlay" },
  { id: "kodak", name: "柯达胶片", note: "黄 · 红主题", swatch: "kodak" },
  { id: "fujifilm", name: "富士胶片", note: "高级绿主题", swatch: "fujifilm" },
  { id: "provia", name: "PROVIA 100F", note: "反转片包装", swatch: "provia" },
  { id: "northern-blue", name: "北境蓝调", note: "冰川蓝 · 深湖蓝", swatch: "northern-blue" },
  { id: "forest-gold", name: "林野金绿", note: "暖金黄 · 森林绿", swatch: "forest-gold" },
  { id: "editorial", name: "编辑部", note: "瑞士网格", swatch: "editorial" },
  { id: "monolith", name: "静奢石碑", note: "暖白留白", swatch: "monolith" },
  { id: "archive", name: "影像档案", note: "理性秩序", swatch: "archive" },
  { id: "sidecar", name: "侧栏档案", note: "右侧参数栏", swatch: "sidecar" },
];

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp", "image/x-bmp", "image/x-ms-bmp"]);
const stripePresets: PresetId[] = ["kodak", "fujifilm", "northern-blue", "forest-gold"];
const locationCache = new Map<string, string>();
let geocodeQueue: Promise<void> = Promise.resolve();
let lastGeocodeAt = 0;

function isStripePreset(preset: PresetId) {
  return stripePresets.includes(preset);
}

function locationVisible(settings: Settings) {
  return settings.showLocationByPreset[settings.preset] ?? ["centered", "floating", "cinematic"].includes(settings.preset);
}

function reverseGeocodeCity(latitude: number, longitude: number) {
  const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  const cached = locationCache.get(key);
  if (cached) return Promise.resolve(cached);
  let resolveResult: (value: string) => void = () => undefined;
  const result = new Promise<string>((resolve) => { resolveResult = resolve; });
  geocodeQueue = geocodeQueue.then(async () => {
    const remaining = 1100 - (Date.now() - lastGeocodeAt);
    if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
    lastGeocodeAt = Date.now();
    try {
      const query = new URLSearchParams({ format: "geocodejson", lat: latitude.toString(), lon: longitude.toString(), zoom: "10", addressdetails: "1", "accept-language": "zh-CN,zh,en" });
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${query.toString()}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("地点识别服务暂时不可用");
      const payload = await response.json() as { features?: Array<{ properties?: { geocoding?: Record<string, string> } }> };
      const address = payload.features?.[0]?.properties?.geocoding || {};
      const city = clean(address.city || address.town || address.municipality || address.village || address.county || address.state) || "地点";
      locationCache.set(key, city);
      resolveResult(city);
    } catch {
      resolveResult("地点");
    }
  });
  return result;
}

type BrandDefinition = {
  value: string;
  label: string;
  keywords: string[];
  asset?: string;
  monochrome?: boolean;
  inverseMonochrome?: boolean;
  clearWhiteBorder?: boolean;
  color?: string;
};

const brands: BrandDefinition[] = [
  { value: "Canon", label: "Canon", keywords: ["CANON"], asset: "canon-mark.png", color: "#cc0000" },
  { value: "Nikon", label: "Nikon", keywords: ["NIKON"], asset: "nikon.svg", clearWhiteBorder: true },
  { value: "SONY", label: "Sony", keywords: ["SONY"], asset: "sony.svg", monochrome: true },
  { value: "FUJIFILM", label: "Fujifilm", keywords: ["FUJI"], asset: "fujifilm.svg", inverseMonochrome: true },
  { value: "Leica Camera AG", label: "Leica", keywords: ["LEICA"], asset: "leica.svg", color: "#d71920" },
  { value: "Hasselblad", label: "Hasselblad", keywords: ["HASSELBLAD"], asset: "hasselblad.svg", monochrome: true },
  { value: "OM SYSTEM", label: "OM SYSTEM", keywords: ["OM SYSTEM", "OM DIGITAL"], asset: "omsystem.svg", monochrome: true },
  { value: "OLYMPUS", label: "Olympus", keywords: ["OLYMPUS"], asset: "olympus.png", inverseMonochrome: true },
  { value: "Panasonic", label: "Panasonic / Lumix", keywords: ["PANASONIC", "LUMIX"], asset: "panasonic.png", inverseMonochrome: true },
  { value: "RICOH", label: "Ricoh", keywords: ["RICOH"], asset: "ricoh.svg", inverseMonochrome: true },
  { value: "PENTAX", label: "Pentax", keywords: ["PENTAX"], color: "#d71920" },
  { value: "DJI", label: "DJI", keywords: ["DJI"], asset: "dji.svg", monochrome: true },
  { value: "Apple", label: "Apple / iPhone", keywords: ["APPLE", "IPHONE", "IPAD"], asset: "apple.svg", monochrome: true },
  { value: "HUAWEI", label: "Huawei / 华为", keywords: ["HUAWEI", "华为"], asset: "huawei.svg", monochrome: true },
  { value: "HONOR", label: "HONOR / 荣耀", keywords: ["HONOR", "荣耀"], asset: "honor.svg", monochrome: true },
  { value: "Xiaomi", label: "Xiaomi / 小米", keywords: ["XIAOMI", "小米", "REDMI", "POCO"], asset: "xiaomi.svg", monochrome: true },
  { value: "OPPO", label: "OPPO", keywords: ["OPPO", "ONEPLUS", "一加"], asset: "oppo.svg", monochrome: true },
  { value: "vivo", label: "vivo", keywords: ["VIVO"], asset: "vivo.svg", monochrome: true },
  { value: "Google", label: "Google / Pixel", keywords: ["GOOGLE"] },
  { value: "Samsung", label: "Samsung", keywords: ["SAMSUNG"], color: "#1428a0" },
];

const filmBrands: BrandDefinition[] = [
  { value: "KODAK", label: "Kodak / 柯达", keywords: ["KODAK"], asset: "kodak.png" },
  { value: "LUCKY", label: "Lucky / 乐凯", keywords: ["LUCKY", "乐凯"], asset: "lucky.png", monochrome: true },
  { value: "FUJIFILM", label: "Fujifilm / 富士", keywords: ["FUJIFILM", "FUJI", "富士"], asset: "fujifilm.svg" },
];

const scannerBrands: BrandDefinition[] = [
  { value: "NORITSU", label: "Noritsu / 诺日士", keywords: ["NORITSU", "诺日士"], asset: "noritsu.svg", monochrome: true },
  { value: "FUJIFILM", label: "Fujifilm Frontier / 富士", keywords: ["FUJIFILM", "FUJI", "FRONTIER", "富士"], asset: "fujifilm.svg" },
];

const elementLabels: Record<ElementId, string> = {
  cameraBrand: "相机厂商 Logo",
  cameraModel: "相机型号",
  lens: "镜头信息",
  aperture: "光圈",
  exposure: "快门",
  iso: "ISO",
  focalLength: "焦距",
  signature: "签名",
  date: "拍摄日期",
  location: "拍摄地点",
  filmBrand: "胶卷厂商 Logo",
  filmName: "胶卷名称",
  lab: "冲洗店名称",
  scanner: "扫描仪 Logo 与名称",
};

const standardElementIds: ElementId[] = ["cameraBrand", "cameraModel", "lens", "aperture", "exposure", "iso", "focalLength", "signature", "date", "location"];
const filmElementIds: ElementId[] = [...standardElementIds, "filmBrand", "filmName", "lab", "scanner"];
const compactFilmElementIds: ElementId[] = ["cameraBrand", "cameraModel", "lens", "filmBrand", "filmName", "iso", "location"];
const defaultTransform: ElementTransform = { x: 0, y: 0, scale: 1, fontScale: 1 };
let collectingElementBounds: ElementBoundsMap | null = null;
let italicThemeText = false;

function recordElementBounds(element: ElementId, bounds: ElementBounds) {
  if (!collectingElementBounds) return;
  const previous = collectingElementBounds[element];
  if (!previous) {
    collectingElementBounds[element] = bounds;
    return;
  }
  const left = Math.min(previous.x, bounds.x);
  const top = Math.min(previous.y, bounds.y);
  const right = Math.max(previous.x + previous.width, bounds.x + bounds.width);
  const bottom = Math.max(previous.y + previous.height, bounds.y + bounds.height);
  collectingElementBounds[element] = { x: left, y: top, width: right - left, height: bottom - top };
}

const logoCache = new Map<string, HTMLImageElement>();
let logoLoadPromise: Promise<void> | undefined;

function preloadOfficialLogos() {
  if (logoLoadPromise) return logoLoadPromise;
  const definitions = [...brands, ...filmBrands, ...scannerBrands]
    .filter((brand, index, all) => brand.asset && all.findIndex((candidate) => candidate.value === brand.value && candidate.asset === brand.asset) === index);
  logoLoadPromise = Promise.all(
    definitions.map((brand) => new Promise<void>((resolve) => {
      const image = new Image();
      image.onload = () => {
        logoCache.set(brand.value, image);
        resolve();
      };
      image.onerror = () => resolve();
      image.src = new URL(`brands/${brand.asset}`, document.baseURI).href;
    })),
  ).then(() => undefined);
  return logoLoadPromise;
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.replace(/\0/g, "").trim();
  return result || undefined;
}

function asNumber(value: unknown): number | undefined {
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function numberString(value: unknown): string | undefined {
  const result = asNumber(value);
  if (result === undefined) return undefined;
  return Number.isInteger(result) ? result.toFixed(0) : result.toString();
}

function exposureString(value: unknown): string | undefined {
  const result = asNumber(value);
  if (!result) return undefined;
  if (result >= 1) return Number.isInteger(result) ? result.toFixed(0) : result.toString();
  return `1/${Math.round(1 / result)}`;
}

function dateInputString(value: unknown): string | undefined {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return undefined;
  const pad = (part: number) => part.toString().padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function formatAperture(value?: string) {
  if (!value) return "f/—";
  return value.toLowerCase().startsWith("f/") ? value : `f/${value}`;
}

function formatExposure(value?: string) {
  if (!value) return "—s";
  return value.toLowerCase().endsWith("s") ? value : `${value}s`;
}

function formatFocal(value?: string) {
  if (!value) return "—mm";
  return value.toLowerCase().endsWith("mm") ? value : `${value}mm`;
}

function formatDate(value?: string) {
  if (!value) return "日期未知";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|\s)(\d{2}):(\d{2})/);
  return match ? `${match[1]}.${match[2]}.${match[3]} ${match[4]}:${match[5]}` : value;
}

function brandInfo(make?: string, model?: string): BrandDefinition {
  // A user-selected EXIF Make is authoritative. Only fall back to Model when Make
  // is empty or unrecognized, otherwise an old model name could override the selection.
  const normalizedMake = (make || "").toUpperCase();
  const normalizedModel = (model || "").toUpperCase();
  return brands.find((brand) => brand.keywords.some((keyword) => normalizedMake.includes(keyword)))
    || brands.find((brand) => brand.keywords.some((keyword) => normalizedModel.includes(keyword)))
    || {
    value: clean(make) || clean(model) || "CAMERA",
    label: clean(make) || clean(model) || "CAMERA",
    keywords: [],
    color: "#111111",
  };
}

function catalogInfo(catalog: BrandDefinition[], value: string): BrandDefinition {
  const normalized = value.toUpperCase();
  return catalog.find((brand) => brand.value === value || brand.keywords.some((keyword) => normalized.includes(keyword))) || {
    value: clean(value) || "CUSTOM",
    label: clean(value) || "CUSTOM",
    keywords: [],
    color: "#111111",
  };
}

function currentLayoutKey(settings: Settings): LayoutKey {
  if (settings.filmMode && settings.filmCompact) return `film-compact-${settings.preset}`;
  return settings.filmMode ? `film-mode-${settings.preset}` : settings.preset;
}

function elementTransform(settings: Settings, element: ElementId): ElementTransform {
  return settings.transforms[currentLayoutKey(settings)]?.[element] || defaultTransform;
}

function elementPoint(settings: Settings, layout: Layout, element: ElementId, x: number, y: number) {
  const transform = elementTransform(settings, element);
  return {
    x: x + transform.x * layout.width,
    y: y + transform.y * layout.height,
    scale: transform.scale,
    fontScale: transform.fontScale,
  };
}

function font(size: number, weight = 500, family = 'Arial, "PingFang SC", sans-serif') {
  return `${italicThemeText ? "italic " : ""}${weight} ${Math.max(8, Math.round(size))}px ${family}`;
}

function drawTextFit(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  options: { weight?: number; align?: CanvasTextAlign; color?: string; family?: string } = {},
) {
  let currentSize = size;
  context.textAlign = options.align || "left";
  context.fillStyle = options.color || "#111111";
  context.font = font(currentSize, options.weight || 500, options.family);
  while (context.measureText(text).width > maxWidth && currentSize > size * 0.58) {
    currentSize -= 1;
    context.font = font(currentSize, options.weight || 500, options.family);
  }
  context.fillText(text, x, y);
}

function drawElementText(
  context: CanvasRenderingContext2D,
  settings: Settings,
  layout: Layout,
  element: ElementId,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  options: { weight?: number; align?: CanvasTextAlign; color?: string; family?: string } = {},
) {
  const point = elementPoint(settings, layout, element, x, y);
  const renderedWidth = maxWidth * point.scale;
  const renderedHeight = Math.max(18, size * point.fontScale * 1.7);
  const align = options.align || "left";
  const boundsX = align === "center" ? point.x - renderedWidth / 2 : align === "right" ? point.x - renderedWidth : point.x;
  recordElementBounds(element, { x: boundsX, y: point.y - renderedHeight / 2, width: renderedWidth, height: renderedHeight });
  drawTextFit(context, text, point.x, point.y, renderedWidth, size * point.fontScale, options);
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawImageCover(context: CanvasRenderingContext2D, image: CanvasImageSource, sourceWidth: number, sourceHeight: number, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function themePalette(preset: PresetId): ThemePalette | undefined {
  if (preset === "kodak") {
    return {
      background: "#ffffff",
      ink: "#111111",
      muted: "#5f625f",
      faint: "#8b8d85",
      accent: "#ED0000",
    };
  }
  if (preset === "fujifilm") {
    return {
      background: "#ffffff",
      ink: "#111111",
      muted: "#5f625f",
      faint: "#8b8d85",
      accent: "#01916D",
    };
  }
  if (preset === "provia") {
    return {
      background: "#ffffff",
      ink: "#f2d88a",
      muted: "#d8d9ee",
      faint: "#aeb2d8",
      accent: "#00A567",
    };
  }
  if (preset === "northern-blue") {
    return {
      background: "#ffffff",
      ink: "#101820",
      muted: "#566775",
      faint: "#8797a3",
      accent: "#174A7E",
    };
  }
  if (preset === "forest-gold") {
    return {
      background: "#ffffff",
      ink: "#121812",
      muted: "#607064",
      faint: "#8b988b",
      accent: "#356B45",
    };
  }
  if (preset === "editorial") {
    return { background: "#ffffff", ink: "#111111", muted: "#676962", faint: "#a0a29b", accent: "#8f1d22" };
  }
  if (preset === "monolith") {
    return { background: "#f5f1e8", ink: "#171713", muted: "#69665f", faint: "#aaa59b", accent: "#a28349" };
  }
  if (preset === "archive") {
    return { background: "#f8f8f5", ink: "#151613", muted: "#656860", faint: "#a4a79e", accent: "#3f5547" };
  }
  return undefined;
}

function drawThemeRules(context: CanvasRenderingContext2D, layout: Layout, theme: ThemePalette, preset: PresetId) {
  const { bandX: x, bandY: y, bandWidth: width, bandHeight: height } = layout;
  context.save();
  context.fillStyle = theme.background;
  context.fillRect(x, y, width, height);
  const stripeHeight = Math.max(6, layout.photoHeight * 0.014);
  const splitX = x + width * 0.287;
  if (preset === "kodak") {
    context.fillStyle = "#FFB700";
    context.fillRect(x, y, splitX - x, stripeHeight);
    context.fillStyle = "#ED0000";
    context.fillRect(splitX, y, x + width - splitX, stripeHeight);
  } else if (preset === "fujifilm") {
    context.fillStyle = "#01916D";
    context.fillRect(x, y, splitX - x, stripeHeight);
    context.fillStyle = "#99D3C5";
    context.fillRect(splitX, y, x + width - splitX, stripeHeight);
  } else if (preset === "northern-blue") {
    context.fillStyle = "#8EC5E8";
    context.fillRect(x, y, splitX - x, stripeHeight);
    context.fillStyle = "#174A7E";
    context.fillRect(splitX, y, x + width - splitX, stripeHeight);
  } else if (preset === "forest-gold") {
    context.fillStyle = "#E4B538";
    context.fillRect(x, y, splitX - x, stripeHeight);
    context.fillStyle = "#356B45";
    context.fillRect(splitX, y, x + width - splitX, stripeHeight);
  } else if (preset === "editorial") {
    context.fillStyle = "#111111";
    context.fillRect(x + width * 0.03, y + height * 0.13, width * 0.16, Math.max(2, layout.photoHeight * 0.0012));
    context.fillStyle = theme.accent;
    context.fillRect(x + width * 0.03, y + height * 0.13, width * 0.018, Math.max(5, layout.photoHeight * 0.004));
    context.fillStyle = "rgba(20,20,18,.12)";
    context.fillRect(x + width * 0.555, y + height * 0.18, Math.max(1, layout.photoWidth * 0.0007), height * 0.64);
  } else if (preset === "monolith") {
    context.fillStyle = "rgba(35,32,26,.18)";
    context.fillRect(x + width * 0.5, y + height * 0.2, Math.max(1, layout.photoWidth * 0.0006), height * 0.6);
    context.fillStyle = theme.accent;
    context.fillRect(x + width * 0.475, y + height * 0.13, width * 0.05, Math.max(3, layout.photoHeight * 0.002));
  } else if (preset === "archive") {
    context.strokeStyle = "rgba(30,34,29,.22)";
    context.lineWidth = Math.max(1, layout.photoWidth * 0.00045);
    context.strokeRect(x + width * 0.026, y + height * 0.17, width * 0.948, height * 0.66);
    context.fillStyle = theme.accent;
    context.beginPath();
    context.arc(x + width * 0.044, y + height * 0.5, Math.max(3, layout.photoWidth * 0.003), 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawLogoDefinition(
  context: CanvasRenderingContext2D,
  brand: BrandDefinition,
  x: number,
  y: number,
  maxWidth: number,
  height: number,
  inverse = false,
  align: CanvasTextAlign = "left",
  forceMonochrome = false,
) {
  const image = logoCache.get(brand.value);
  context.save();
  context.textBaseline = "middle";

  if (image?.naturalWidth && image?.naturalHeight) {
    const logoScale = brand.value === "HONOR" ? 2 : 1;
    const maxHeight = height * (brand.value === "Nikon" || brand.value === "Leica Camera AG" ? 0.58 : 0.38) * logoScale;
    const scale = Math.min((maxWidth * logoScale) / image.naturalWidth, maxHeight / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const drawX = align === "center" ? x - drawWidth / 2 : align === "right" ? x - drawWidth : x;
    const drawY = y - drawHeight / 2;
    let logoSource: CanvasImageSource = image;

    if (brand.clearWhiteBorder) {
      const cleaned = document.createElement("canvas");
      cleaned.width = Math.max(1, Math.round(drawWidth));
      cleaned.height = Math.max(1, Math.round(drawHeight));
      const cleanedContext = cleaned.getContext("2d", { willReadFrequently: true });
      if (cleanedContext) {
        cleanedContext.drawImage(image, 0, 0, cleaned.width, cleaned.height);
        const pixels = cleanedContext.getImageData(0, 0, cleaned.width, cleaned.height);
        const visited = new Uint8Array(cleaned.width * cleaned.height);
        const queue: number[] = [];
        const enqueueWhite = (pixelIndex: number) => {
          if (visited[pixelIndex]) return;
          visited[pixelIndex] = 1;
          const offset = pixelIndex * 4;
          if (pixels.data[offset + 3] && pixels.data[offset] > 242 && pixels.data[offset + 1] > 242 && pixels.data[offset + 2] > 242) queue.push(pixelIndex);
        };
        for (let column = 0; column < cleaned.width; column += 1) {
          enqueueWhite(column);
          enqueueWhite((cleaned.height - 1) * cleaned.width + column);
        }
        for (let row = 0; row < cleaned.height; row += 1) {
          enqueueWhite(row * cleaned.width);
          enqueueWhite(row * cleaned.width + cleaned.width - 1);
        }
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
          const pixelIndex = queue[cursor];
          pixels.data[pixelIndex * 4 + 3] = 0;
          const column = pixelIndex % cleaned.width;
          const row = Math.floor(pixelIndex / cleaned.width);
          if (column > 0) enqueueWhite(pixelIndex - 1);
          if (column + 1 < cleaned.width) enqueueWhite(pixelIndex + 1);
          if (row > 0) enqueueWhite(pixelIndex - cleaned.width);
          if (row + 1 < cleaned.height) enqueueWhite(pixelIndex + cleaned.width);
        }
        cleanedContext.putImageData(pixels, 0, 0);
        logoSource = cleaned;
      }
    }

    const renderAsMask = forceMonochrome || brand.monochrome || (inverse && (brand.inverseMonochrome || brand.value === "FUJIFILM"));
    if (renderAsMask) {
      const mask = document.createElement("canvas");
      mask.width = Math.max(1, Math.round(drawWidth));
      mask.height = Math.max(1, Math.round(drawHeight));
      const maskContext = mask.getContext("2d");
      if (maskContext) {
        maskContext.drawImage(logoSource, 0, 0, mask.width, mask.height);
        if (brand.value === "LUCKY") {
          const pixels = maskContext.getImageData(0, 0, mask.width, mask.height);
          for (let index = 0; index < pixels.data.length; index += 4) {
            if (pixels.data[index] > 245 && pixels.data[index + 1] > 245 && pixels.data[index + 2] > 245) pixels.data[index + 3] = 0;
          }
          maskContext.putImageData(pixels, 0, 0);
        }
        maskContext.globalCompositeOperation = "source-in";
        maskContext.fillStyle = inverse ? "#ffffff" : "#111111";
        maskContext.fillRect(0, 0, mask.width, mask.height);
        context.drawImage(mask, drawX, drawY, drawWidth, drawHeight);
      }
    } else {
      context.drawImage(logoSource, drawX, drawY, drawWidth, drawHeight);
    }
  } else {
    drawTextFit(context, brand.label, x, y, maxWidth, height * 0.24, {
      weight: 800,
      align,
      color: inverse ? "#ffffff" : brand.color || "#111111",
    });
  }
  context.restore();
}

function drawBrand(
  context: CanvasRenderingContext2D,
  make: string | undefined,
  model: string | undefined,
  x: number,
  y: number,
  maxWidth: number,
  height: number,
  inverse = false,
  align: CanvasTextAlign = "left",
  forceMonochrome = false,
) {
  drawLogoDefinition(context, brandInfo(make, model), x, y, maxWidth, height, inverse, align, forceMonochrome);
}

function getLayout(photo: PhotoItem, settings: Settings, scale = 1): Layout {
  const photoWidth = Math.max(1, Math.round(photo.width * scale));
  const photoHeight = Math.max(1, Math.round(photo.height * scale));
  const activeBandSize = settings.filmMode ? settings.filmBandSize : settings.bandSize;
  const baseBand = Math.max(72, Math.round(photoHeight * (activeBandSize / 100)));

  if (settings.filmMode && settings.filmCompact && settings.preset === "sidecar") {
    const margin = Math.max(14, Math.round(Math.min(photoWidth, photoHeight) * 0.018));
    return {
      width: photoWidth + margin * 2,
      height: photoHeight + margin + baseBand,
      photoX: margin,
      photoY: margin,
      photoWidth,
      photoHeight,
      bandX: margin,
      bandY: photoHeight + margin,
      bandWidth: photoWidth,
      bandHeight: baseBand,
    };
  }

  if (settings.preset === "floating") {
    const margin = Math.max(30, Math.round(Math.min(photoWidth, photoHeight) * 0.07));
    const cardBand = Math.max(baseBand, Math.round(photoHeight * 0.2));
    return {
      width: photoWidth + margin * 2,
      height: photoHeight + margin + cardBand,
      photoX: margin,
      photoY: margin,
      photoWidth,
      photoHeight,
      bandX: margin,
      bandY: photoHeight + margin,
      bandWidth: photoWidth,
      bandHeight: cardBand,
    };
  }

  if (settings.preset === "cinematic") {
    const margin = Math.max(18, Math.round(Math.min(photoWidth, photoHeight) * 0.025));
    const cardBand = Math.max(baseBand, Math.round(photoHeight * 0.17));
    return {
      width: photoWidth + margin * 2,
      height: photoHeight + margin + cardBand,
      photoX: margin,
      photoY: margin,
      photoWidth,
      photoHeight,
      bandX: margin,
      bandY: photoHeight + margin,
      bandWidth: photoWidth,
      bandHeight: cardBand,
    };
  }

  if (settings.preset === "centered") {
    const margin = Math.max(18, Math.round(Math.min(photoWidth, photoHeight) * 0.028));
    const cardBand = Math.max(baseBand, Math.round(photoHeight * 0.19));
    return {
      width: photoWidth + margin * 2,
      height: photoHeight + margin + cardBand,
      photoX: margin,
      photoY: margin,
      photoWidth,
      photoHeight,
      bandX: margin,
      bandY: photoHeight + margin,
      bandWidth: photoWidth,
      bandHeight: cardBand,
    };
  }

  if (settings.preset === "immersive") {
    const margin = Math.max(14, Math.round(Math.min(photoWidth, photoHeight) * 0.018));
    const overlayBand = Math.max(baseBand, Math.round(photoHeight * 0.17));
    return {
      width: photoWidth + margin * 2,
      height: photoHeight + margin * 2,
      photoX: margin,
      photoY: margin,
      photoWidth,
      photoHeight,
      bandX: margin,
      bandY: margin + photoHeight - overlayBand,
      bandWidth: photoWidth,
      bandHeight: overlayBand,
    };
  }

  if (settings.preset === "sidecar") {
    const margin = Math.max(14, Math.round(Math.min(photoWidth, photoHeight) * 0.018));
    const panelWidth = Math.max(Math.round(photoWidth * 0.34), Math.round(photoWidth * (activeBandSize / 100) * 3.5));
    return {
      width: photoWidth + panelWidth + margin * 3,
      height: photoHeight + margin * 2,
      photoX: margin,
      photoY: margin,
      photoWidth,
      photoHeight,
      bandX: photoWidth + margin * 2,
      bandY: margin,
      bandWidth: panelWidth,
      bandHeight: photoHeight,
    };
  }

  if (settings.preset === "gallery") {
    const margin = Math.max(18, Math.round(Math.min(photoWidth, photoHeight) * 0.025));
    return {
      width: photoWidth + margin * 2,
      height: photoHeight + margin * 2 + baseBand,
      photoX: margin,
      photoY: margin,
      photoWidth,
      photoHeight,
      bandX: margin,
      bandY: photoHeight + margin,
      bandWidth: photoWidth,
      bandHeight: baseBand + margin,
    };
  }

  if (settings.preset === "overlay") {
    return {
      width: photoWidth,
      height: photoHeight,
      photoX: 0,
      photoY: 0,
      photoWidth,
      photoHeight,
      bandX: 0,
      bandY: photoHeight - baseBand,
      bandWidth: photoWidth,
      bandHeight: baseBand,
    };
  }

  return {
    width: photoWidth,
    height: photoHeight + baseBand,
    photoX: 0,
    photoY: 0,
    photoWidth,
    photoHeight,
    bandX: 0,
    bandY: photoHeight,
    bandWidth: photoWidth,
    bandHeight: baseBand,
  };
}

function drawThemeMicroDivider(
  context: CanvasRenderingContext2D,
  layout: Layout,
  theme: ThemePalette,
  x: number,
  centerY: number,
  height: number,
) {
  context.save();
  context.globalAlpha = 0.34;
  context.fillStyle = theme.accent;
  context.fillRect(x, centerY - height / 2, Math.max(1, layout.photoWidth * 0.00065), height);
  context.restore();
}

function paintProviaPackage(context: CanvasRenderingContext2D, layout: Layout) {
  const { bandX: x, bandY: y, bandWidth: width, bandHeight: height } = layout;
  const body = context.createLinearGradient(x, y, x + width, y + height);
  body.addColorStop(0, "#17163f");
  body.addColorStop(0.56, "#28248a");
  body.addColorStop(1, "#111224");
  context.fillStyle = body;
  context.fillRect(x, y, width, height);
  const header = context.createLinearGradient(x, y, x + width, y);
  header.addColorStop(0, "#008f59");
  header.addColorStop(0.55, "#08ad70");
  header.addColorStop(1, "#007d4d");
  context.fillStyle = header;
  context.fillRect(x, y, width, height * 0.3);
  context.fillStyle = "rgba(174,181,255,.7)";
  context.fillRect(x, y + height * 0.3, width, Math.max(2, layout.photoHeight * 0.0015));
  context.fillStyle = "rgba(242,216,138,.78)";
  context.fillRect(x, y + height * 0.965, width, Math.max(2, layout.photoHeight * 0.0012));
}

function paintProviaLabel(context: CanvasRenderingContext2D, layout: Layout, x: number, y: number, width: number, height: number) {
  context.save();
  context.shadowColor = "rgba(169,177,255,.7)";
  context.shadowBlur = Math.max(6, layout.photoWidth * 0.006);
  context.fillStyle = "rgba(8,9,15,.94)";
  context.fillRect(x, y, width, height);
  context.shadowColor = "transparent";
  context.strokeStyle = "rgba(242,216,138,.76)";
  context.lineWidth = Math.max(1, layout.photoWidth * 0.0006);
  context.strokeRect(x, y, width, height);
  context.restore();
}

function drawProviaStandardBand(context: CanvasRenderingContext2D, photo: PhotoItem, settings: Settings, layout: Layout) {
  const { bandX: x, bandY: y, bandWidth: width, bandHeight: height } = layout;
  const meta = photo.metadata;
  const contentHeight = layout.photoHeight * 0.1612;
  const gold = "#f2d88a";
  const white = "#f6f8f3";
  const pale = "#c9ccea";
  context.save();
  context.textBaseline = "middle";
  paintProviaPackage(context, layout);
  paintProviaLabel(context, layout, x + width * 0.235, y + height * 0.39, width * 0.45, height * 0.43);
  if (settings.showBrand) {
    const point = elementPoint(settings, layout, "cameraBrand", x + width * 0.028, y + height * 0.15);
    recordElementBounds("cameraBrand", { x: point.x, y: point.y - contentHeight * 0.18 * point.scale, width: width * 0.15 * point.scale, height: contentHeight * 0.36 * point.scale });
    drawBrand(context, meta.make, meta.model, point.x, point.y, width * 0.15 * point.scale, contentHeight * 0.68 * point.scale, true);
  }
  if (settings.showModel) drawElementText(context, settings, layout, "cameraModel", meta.model || "CAMERA", x + width * 0.22, y + height * 0.15, width * 0.17, contentHeight * 0.15, { color: white, weight: 750 });
  if (settings.showLens && meta.lens) drawElementText(context, settings, layout, "lens", meta.lens, x + width * 0.4, y + height * 0.15, width * 0.28, contentHeight * 0.115, { color: "rgba(255,255,255,.78)", weight: 450 });
  drawTextFit(context, "PROFESSIONAL", x + width * 0.035, y + height * 0.6, width * 0.16, contentHeight * 0.115, { color: gold, weight: 400, family: "Georgia, serif" });
  if (settings.showAperture) drawElementText(context, settings, layout, "aperture", formatAperture(meta.aperture), x + width * 0.295, y + height * 0.605, width * 0.075, contentHeight * 0.145, { align: "center", color: gold, weight: 600, family: "Georgia, serif" });
  if (settings.showExposure) drawElementText(context, settings, layout, "exposure", formatExposure(meta.exposure), x + width * 0.405, y + height * 0.605, width * 0.09, contentHeight * 0.145, { align: "center", color: gold, weight: 600, family: "Georgia, serif" });
  if (settings.showIso) drawElementText(context, settings, layout, "iso", `ISO ${meta.iso || "—"}`, x + width * 0.525, y + height * 0.605, width * 0.1, contentHeight * 0.145, { align: "center", color: gold, weight: 600, family: "Georgia, serif" });
  if (settings.showFocalLength) drawElementText(context, settings, layout, "focalLength", formatFocal(meta.focalLength), x + width * 0.635, y + height * 0.605, width * 0.08, contentHeight * 0.145, { align: "center", color: gold, weight: 600, family: "Georgia, serif" });
  if (locationVisible(settings)) drawElementText(context, settings, layout, "location", meta.location || "地点", x + width * 0.82, y + height * 0.58, width * 0.18, contentHeight * 0.105, { align: "center", color: pale, weight: 500 });
  if (settings.showDate) drawElementText(context, settings, layout, "date", formatDate(meta.takenAt), x + width * 0.97, y + height * 0.15, width * 0.22, contentHeight * 0.105, { align: "right", color: white, weight: 450 });
  if (settings.showSignature && settings.signature) drawElementText(context, settings, layout, "signature", `by ${settings.signature}`, x + width * 0.97, y + height * 0.77, width * 0.24, contentHeight * 0.11, { align: "right", color: white, weight: 500 });
  context.restore();
}

function drawProviaFilmBand(context: CanvasRenderingContext2D, photo: PhotoItem, settings: Settings, layout: Layout, compact = false) {
  const { bandX: x, bandY: y, bandWidth: width, bandHeight: height } = layout;
  const meta = photo.filmMetadata;
  const contentHeight = layout.photoHeight * 0.1612;
  const filmBrand = catalogInfo(filmBrands, settings.filmBrand);
  const scannerBrand = catalogInfo(scannerBrands, settings.scannerBrand);
  const gold = "#f2d88a";
  const white = "#f6f8f3";
  const pale = "#c9ccea";
  const topRow = y + height * 0.15;
  const bottomRow = y + height * 0.64;
  context.save();
  context.textBaseline = "middle";
  paintProviaPackage(context, layout);
  paintProviaLabel(context, layout, x + width * 0.205, y + height * 0.405, width * (compact ? 0.59 : 0.4), height * 0.46);
  if (settings.filmShowBrand) {
    const point = elementPoint(settings, layout, "cameraBrand", x + width * 0.025, topRow);
    recordElementBounds("cameraBrand", { x: point.x, y: point.y - contentHeight * 0.18 * point.scale, width: width * 0.14 * point.scale, height: contentHeight * 0.36 * point.scale });
    drawBrand(context, meta.make, meta.model, point.x, point.y, width * 0.14 * point.scale, contentHeight * 0.68 * point.scale, true);
  }
  if (settings.filmShowModel) drawElementText(context, settings, layout, "cameraModel", meta.model || "CAMERA", x + width * 0.2, topRow, width * 0.13, contentHeight * 0.145, { color: white, weight: 750 });
  if (settings.filmShowLens && meta.lens) drawElementText(context, settings, layout, "lens", meta.lens, x + width * 0.34, topRow, width * 0.23, contentHeight * 0.11, { color: "rgba(255,255,255,.76)", weight: 450 });
  if (!compact && settings.showScanner) {
    const point = elementPoint(settings, layout, "scanner", x + width * 0.63, topRow);
    recordElementBounds("scanner", { x: point.x, y: point.y - contentHeight * 0.18 * point.scale, width: width * 0.14 * point.scale, height: contentHeight * 0.36 * point.scale });
    drawLogoDefinition(context, scannerBrand, point.x, point.y, width * 0.14 * point.scale, contentHeight * 0.64 * point.scale, true);
    drawElementText(context, settings, layout, "scanner", settings.scannerName || "FILM SCANNER", x + width * 0.8, topRow, width * 0.17, contentHeight * 0.125, { color: white, weight: 650 });
  }
  if (settings.showFilmBrand) {
    const point = elementPoint(settings, layout, "filmBrand", x + width * 0.025, bottomRow);
    recordElementBounds("filmBrand", { x: point.x, y: point.y - contentHeight * 0.18 * point.scale, width: width * 0.14 * point.scale, height: contentHeight * 0.36 * point.scale });
    drawLogoDefinition(context, filmBrand, point.x, point.y, width * 0.14 * point.scale, contentHeight * 0.68 * point.scale, true);
  }
  if (settings.showFilmName) drawElementText(context, settings, layout, "filmName", settings.filmName || "PROVIA 100F", x + width * 0.245, bottomRow, width * (compact ? 0.38 : 0.27), contentHeight * 0.2, { color: gold, weight: 600, family: "Georgia, serif" });
  if (settings.filmShowIso) drawElementText(context, settings, layout, "iso", `ISO ${meta.iso || "100"}`, x + width * (compact ? 0.67 : 0.51), bottomRow, width * 0.1, contentHeight * 0.145, { color: gold, weight: 600, family: "Georgia, serif" });
  if (!compact && settings.showLab) {
    drawElementText(context, settings, layout, "lab", "DEVELOPED BY", x + width * 0.65, y + height * 0.52, width * 0.16, contentHeight * 0.09, { color: pale, weight: 650 });
    drawElementText(context, settings, layout, "lab", settings.labName || "YOUR FILM LAB", x + width * 0.65, y + height * 0.75, width * 0.31, contentHeight * 0.145, { color: white, weight: 650 });
  }
  const optionalRow = y + height * 0.93;
  if (settings.filmShowAperture) drawElementText(context, settings, layout, "aperture", formatAperture(meta.aperture), x + width * 0.22, optionalRow, width * 0.08, contentHeight * 0.08, { color: pale, weight: 550 });
  if (settings.filmShowExposure) drawElementText(context, settings, layout, "exposure", formatExposure(meta.exposure), x + width * 0.31, optionalRow, width * 0.08, contentHeight * 0.08, { color: pale, weight: 550 });
  if (settings.filmShowFocalLength) drawElementText(context, settings, layout, "focalLength", formatFocal(meta.focalLength), x + width * 0.4, optionalRow, width * 0.08, contentHeight * 0.08, { color: pale, weight: 550 });
  if (settings.filmShowDate) drawElementText(context, settings, layout, "date", formatDate(meta.takenAt), x + width * 0.64, optionalRow, width * 0.15, contentHeight * 0.075, { color: pale, weight: 450 });
  if (locationVisible(settings)) drawElementText(context, settings, layout, "location", meta.location || "地点", x + width * 0.79, optionalRow, width * 0.13, contentHeight * 0.075, { color: pale, weight: 450 });
  if (settings.filmShowSignature && settings.signature) drawElementText(context, settings, layout, "signature", `by ${settings.signature}`, x + width * 0.97, optionalRow, width * 0.18, contentHeight * 0.075, { align: "right", color: pale, weight: 500 });
  context.restore();
}

function drawStandardBand(
  context: CanvasRenderingContext2D,
  photo: PhotoItem,
  settings: Settings,
  layout: Layout,
  inverse = false,
  theme?: ThemePalette,
) {
  const { bandX: x, bandY: baseY, bandWidth: width, bandHeight: height } = layout;
  const contentHeight = layout.photoHeight * 0.1612;
  const contentOffsetY = isStripePreset(settings.preset) ? contentHeight * 0.055 : 0;
  const y = baseY + contentOffsetY;
  const ink = theme?.ink || (inverse ? "#f7f7f3" : "#111111");
  const muted = theme?.muted || (inverse ? "rgba(255,255,255,.68)" : "#5f625f");
  const meta = photo.metadata;
  const anchors = {
    brandX: 0.032, brandY: 0.5, brandWidth: 0.18,
    modelX: 0.28, modelY: 0.32, modelWidth: 0.16, modelSize: 0.16,
    lensX: 0.45, lensY: 0.32, lensWidth: 0.25, lensSize: 0.13,
    apertureX: 0.32, apertureY: 0.72,
    exposureX: 0.41, exposureY: 0.72,
    isoX: 0.5, isoY: 0.72,
    focalX: 0.6, focalY: 0.72,
    parameterAlign: "center" as CanvasTextAlign,
    signatureX: 0.968, signatureY: 0.32, signatureWidth: 0.25,
    dateX: 0.968, dateY: 0.72, dateWidth: 0.27,
  };
  if (settings.preset === "editorial") Object.assign(anchors, {
    brandX: 0.03, brandY: 0.55, brandWidth: 0.16,
    modelX: 0.225, modelY: 0.32, modelWidth: 0.29, modelSize: 0.19,
    lensX: 0.225, lensY: 0.7, lensWidth: 0.29, lensSize: 0.115,
    apertureX: 0.59, apertureY: 0.32, exposureX: 0.68, exposureY: 0.32,
    isoX: 0.59, isoY: 0.7, focalX: 0.68, focalY: 0.7,
    parameterAlign: "left",
  });
  if (settings.preset === "monolith") Object.assign(anchors, {
    brandX: 0.035, brandY: 0.5, brandWidth: 0.15,
    modelX: 0.22, modelY: 0.5, modelWidth: 0.22, modelSize: 0.18,
    lensX: 0.54, lensY: 0.5, lensWidth: 0.18, lensSize: 0.12,
    apertureX: 0.74, apertureY: 0.32, exposureX: 0.81, exposureY: 0.32,
    isoX: 0.74, isoY: 0.7, focalX: 0.81, focalY: 0.7,
    parameterAlign: "left",
    signatureX: 0.965, signatureY: 0.32, dateX: 0.965, dateY: 0.7,
  });
  if (settings.preset === "archive") Object.assign(anchors, {
    brandX: 0.06, brandY: 0.5, brandWidth: 0.13,
    modelX: 0.23, modelY: 0.3, modelWidth: 0.25, modelSize: 0.17,
    lensX: 0.23, lensY: 0.7, lensWidth: 0.25, lensSize: 0.115,
    apertureX: 0.53, apertureY: 0.3, exposureX: 0.62, exposureY: 0.3,
    isoX: 0.53, isoY: 0.7, focalX: 0.62, focalY: 0.7,
    parameterAlign: "left",
    signatureX: 0.95, signatureY: 0.3, dateX: 0.95, dateY: 0.7,
  });
  const advancedPortrait = layout.photoHeight > layout.photoWidth * 1.15 && ["editorial", "monolith", "archive"].includes(settings.preset);
  if (advancedPortrait) Object.assign(anchors, {
    brandX: 0.035, brandY: 0.5, brandWidth: 0.14,
    modelX: 0.22, modelY: 0.5, modelWidth: 0.28, modelSize: 0.17,
    lensX: 0.22, lensY: 0.7, lensWidth: 0.28, lensSize: 0.11,
    apertureX: 0.55, apertureY: 0.3, exposureX: 0.65, exposureY: 0.3,
    isoX: 0.55, isoY: 0.7, focalX: 0.65, focalY: 0.7,
    parameterAlign: "left",
    signatureX: 0.965, signatureY: 0.3, signatureWidth: 0.19,
    dateX: 0.965, dateY: 0.7, dateWidth: 0.19,
  });
  context.save();
  context.textBaseline = "middle";

  if (theme && isStripePreset(settings.preset)) {
    if (settings.showModel && settings.showLens && meta.lens) {
      drawThemeMicroDivider(context, layout, theme, x + width * 0.435, y + height * 0.32, contentHeight * 0.15);
    }
    if ((settings.showModel || settings.showLens) && (settings.showSignature || settings.showDate)) {
      drawThemeMicroDivider(context, layout, theme, x + width * 0.755, y + height * 0.5, contentHeight * 0.3);
    }
  }

  if (settings.showBrand) {
    const point = elementPoint(settings, layout, "cameraBrand", x + width * anchors.brandX, y + height * anchors.brandY);
    recordElementBounds("cameraBrand", { x: point.x, y: point.y - contentHeight * 0.28 * point.scale, width: width * anchors.brandWidth * point.scale, height: contentHeight * 0.56 * point.scale });
    drawBrand(context, meta.make, meta.model, point.x, point.y, width * anchors.brandWidth * point.scale, contentHeight * point.scale, inverse);
  }

  if (settings.showModel) drawElementText(context, settings, layout, "cameraModel", meta.model || "相机型号未知", x + width * anchors.modelX, y + height * anchors.modelY, width * anchors.modelWidth, contentHeight * anchors.modelSize, { color: ink, weight: 650 });
  if (settings.showLens && meta.lens) drawElementText(context, settings, layout, "lens", meta.lens, x + width * anchors.lensX, y + height * anchors.lensY, width * anchors.lensWidth, contentHeight * anchors.lensSize, { color: muted, weight: 400 });
  if (settings.showAperture) drawElementText(context, settings, layout, "aperture", formatAperture(meta.aperture), x + width * anchors.apertureX, y + height * anchors.apertureY, width * 0.08, contentHeight * 0.13, { align: anchors.parameterAlign, color: muted, weight: 500 });
  if (settings.showExposure) drawElementText(context, settings, layout, "exposure", formatExposure(meta.exposure), x + width * anchors.exposureX, y + height * anchors.exposureY, width * 0.08, contentHeight * 0.13, { align: anchors.parameterAlign, color: muted, weight: 500 });
  if (settings.showIso) drawElementText(context, settings, layout, "iso", `ISO ${meta.iso || "—"}`, x + width * anchors.isoX, y + height * anchors.isoY, width * 0.09, contentHeight * 0.13, { align: anchors.parameterAlign, color: muted, weight: 500 });
  if (settings.showFocalLength) drawElementText(context, settings, layout, "focalLength", formatFocal(meta.focalLength), x + width * anchors.focalX, y + height * anchors.focalY, width * 0.09, contentHeight * 0.13, { align: anchors.parameterAlign, color: muted, weight: 500 });
  if (locationVisible(settings)) drawElementText(context, settings, layout, "location", meta.location || "地点", x + width * 0.77, y + height * anchors.dateY, width * 0.12, contentHeight * 0.12, { align: "center", color: muted, weight: 450 });

  const right = x + width * anchors.signatureX;
  if (settings.showSignature && settings.signature) drawElementText(context, settings, layout, "signature", `by ${settings.signature}`, right, y + height * anchors.signatureY, width * anchors.signatureWidth, contentHeight * 0.14, { align: "right", color: ink, weight: 500 });
  if (settings.showDate) {
    drawElementText(context, settings, layout, "date", formatDate(meta.takenAt), x + width * anchors.dateX, y + height * anchors.dateY, width * anchors.dateWidth, contentHeight * 0.13, { align: "right", color: muted, weight: 400 });
  }
  context.restore();
}

function drawFilmWorkflowBand(context: CanvasRenderingContext2D, photo: PhotoItem, settings: Settings, layout: Layout, inverse = false, theme?: ThemePalette) {
  const { bandX: x, bandY: baseY, bandWidth: width, bandHeight: height } = layout;
  const meta = photo.filmMetadata;
  // Keep visual sizes anchored to the former 16.12% nameplate. Changing the
  // nameplate height only redistributes the row positions.
  const contentHeight = layout.photoHeight * 0.1612;
  const contentOffsetY = isStripePreset(settings.preset) ? contentHeight * 0.055 : 0;
  const y = baseY + contentOffsetY;
  const filmBrand = catalogInfo(filmBrands, settings.filmBrand);
  const scannerBrand = catalogInfo(scannerBrands, settings.scannerBrand);
  const ink = theme?.ink || (inverse ? "#ffffff" : "#111111");
  const muted = theme?.muted || (inverse ? "rgba(255,255,255,.62)" : "#62655d");
  const faint = theme?.faint || (inverse ? "rgba(255,255,255,.46)" : "#8b8d85");
  const accent = theme?.accent || (inverse ? "#d7ef3d" : "#758514");
  const filmAnchors = {
    cameraLogoX: 0.035, detailsPrimaryX: 0.205, detailsSecondaryX: 0.39,
    scannerLogoX: 0.59, scannerModelX: 0.79, filmLogoX: 0.035,
    labLabelX: 0.59, labNameX: 0.79, topRow: 0.29, bottomRow: 0.69,
  };
  if (settings.preset === "editorial") Object.assign(filmAnchors, {
    cameraLogoX: 0.03, detailsPrimaryX: 0.235, detailsSecondaryX: 0.405,
    scannerLogoX: 0.625, scannerModelX: 0.82, filmLogoX: 0.03,
    labLabelX: 0.625, labNameX: 0.82, topRow: 0.34, bottomRow: 0.72,
  });
  if (settings.preset === "monolith") Object.assign(filmAnchors, {
    cameraLogoX: 0.055, detailsPrimaryX: 0.24, detailsSecondaryX: 0.4,
    scannerLogoX: 0.63, scannerModelX: 0.82, filmLogoX: 0.055,
    labLabelX: 0.63, labNameX: 0.82, topRow: 0.31, bottomRow: 0.69,
  });
  if (settings.preset === "archive") Object.assign(filmAnchors, {
    cameraLogoX: 0.065, detailsPrimaryX: 0.24, detailsSecondaryX: 0.385,
    scannerLogoX: 0.61, scannerModelX: 0.79, filmLogoX: 0.065,
    labLabelX: 0.61, labNameX: 0.79, topRow: 0.31, bottomRow: 0.69,
  });
  const cameraLogoX = x + width * filmAnchors.cameraLogoX;
  const detailsPrimaryX = x + width * filmAnchors.detailsPrimaryX;
  const detailsSecondaryX = x + width * filmAnchors.detailsSecondaryX;
  const scannerLogoX = x + width * filmAnchors.scannerLogoX;
  const scannerModelX = x + width * filmAnchors.scannerModelX;
  const filmLogoX = x + width * filmAnchors.filmLogoX;
  const filmNameX = detailsPrimaryX;
  const filmIsoX = detailsSecondaryX;
  const labLabelX = x + width * filmAnchors.labLabelX;
  const labNameX = x + width * filmAnchors.labNameX;
  const topRow = y + height * filmAnchors.topRow;
  const bottomRow = y + height * filmAnchors.bottomRow;
  const optionalRow = y + height * 0.91;
  context.save();
  context.textBaseline = "middle";

  const dividerColor = theme?.accent || (inverse ? "#ffffff" : "#343630");
  const drawWorkflowDivider = (dividerX: number, centerY: number, dividerHeight: number, emphasis = false) => {
    context.save();
    context.globalAlpha = emphasis ? (theme ? 0.38 : 0.2) : (theme ? 0.3 : 0.14);
    context.fillStyle = dividerColor;
    context.fillRect(dividerX, centerY - dividerHeight / 2, Math.max(1, layout.photoWidth * 0.00065), dividerHeight);
    context.restore();
  };
  const detailsDividerX = x + width * (filmAnchors.detailsSecondaryX - 0.015);
  const workflowDividerX = x + width * (filmAnchors.scannerModelX - 0.015);
  if (settings.filmShowModel && settings.filmShowLens && meta.lens) drawWorkflowDivider(detailsDividerX, topRow, contentHeight * 0.15);
  if (settings.showFilmName && settings.filmShowIso) drawWorkflowDivider(detailsDividerX, bottomRow, contentHeight * 0.15);
  if (settings.showScanner) drawWorkflowDivider(workflowDividerX, topRow, contentHeight * 0.15);
  if (settings.showLab) drawWorkflowDivider(workflowDividerX, bottomRow, contentHeight * 0.15);
  if ((settings.filmShowBrand || settings.showFilmBrand) && (settings.showScanner || settings.showLab)) {
    drawWorkflowDivider(x + width * 0.555, y + height * 0.5, contentHeight * 0.48, true);
  }

  if (settings.filmShowBrand) {
    const point = elementPoint(settings, layout, "cameraBrand", cameraLogoX, topRow);
    recordElementBounds("cameraBrand", { x: point.x, y: point.y - contentHeight * 0.18 * point.scale, width: width * 0.145 * point.scale, height: contentHeight * 0.36 * point.scale });
    drawBrand(context, meta.make, meta.model, point.x, point.y, width * 0.145 * point.scale, contentHeight * 0.76 * point.scale, inverse);
  }
  if (settings.showFilmBrand) {
    const point = elementPoint(settings, layout, "filmBrand", filmLogoX, bottomRow);
    recordElementBounds("filmBrand", { x: point.x, y: point.y - contentHeight * 0.18 * point.scale, width: width * 0.1 * point.scale, height: contentHeight * 0.36 * point.scale });
    drawLogoDefinition(context, filmBrand, point.x, point.y, width * 0.1 * point.scale, contentHeight * 0.62 * point.scale, inverse);
  }
  if (settings.showScanner) {
    const point = elementPoint(settings, layout, "scanner", scannerLogoX, topRow);
    recordElementBounds("scanner", { x: point.x, y: point.y - contentHeight * 0.18 * point.scale, width: width * 0.17 * point.scale, height: contentHeight * 0.36 * point.scale });
    drawLogoDefinition(context, scannerBrand, point.x, point.y, width * 0.17 * point.scale, contentHeight * 0.7 * point.scale, inverse);
    drawElementText(context, settings, layout, "scanner", settings.scannerName || "FILM SCANNER", scannerModelX, topRow, width * 0.17, contentHeight * 0.145, { color: ink, weight: 650 });
  }
  if (settings.showLab) {
    drawElementText(context, settings, layout, "lab", "DEVELOPED BY", labLabelX, bottomRow, width * 0.17, contentHeight * 0.115, { color: faint, weight: 700 });
    drawElementText(context, settings, layout, "lab", settings.labName || "YOUR FILM LAB", labNameX, bottomRow, width * 0.17, contentHeight * 0.15, { color: ink, weight: 600 });
  }

  if (settings.filmShowModel) drawElementText(context, settings, layout, "cameraModel", meta.model || "CAMERA", detailsPrimaryX, topRow, width * 0.16, contentHeight * 0.15, { color: ink, weight: 650 });
  if (settings.filmShowLens && meta.lens) drawElementText(context, settings, layout, "lens", meta.lens, detailsSecondaryX, topRow, width * 0.15, contentHeight * 0.125, { color: muted, weight: 450 });
  if (settings.showFilmName) drawElementText(context, settings, layout, "filmName", settings.filmName || "FILM STOCK", filmNameX, bottomRow, width * 0.135, contentHeight * 0.15, { color: ink, weight: 700 });
  if (settings.filmShowIso) drawElementText(context, settings, layout, "iso", `ISO${meta.iso || "—"}`, filmIsoX, bottomRow, width * 0.09, contentHeight * 0.125, { color: muted, weight: 550 });

  if (settings.filmShowAperture) drawElementText(context, settings, layout, "aperture", formatAperture(meta.aperture), cameraLogoX, optionalRow, width * 0.08, contentHeight * 0.095, { color: accent, weight: 600 });
  if (settings.filmShowExposure) drawElementText(context, settings, layout, "exposure", formatExposure(meta.exposure), cameraLogoX + width * 0.09, optionalRow, width * 0.08, contentHeight * 0.095, { color: accent, weight: 600 });
  if (settings.filmShowFocalLength) drawElementText(context, settings, layout, "focalLength", formatFocal(meta.focalLength), cameraLogoX + width * 0.18, optionalRow, width * 0.07, contentHeight * 0.095, { color: accent, weight: 600 });
  if (settings.filmShowDate) drawElementText(context, settings, layout, "date", formatDate(meta.takenAt), scannerLogoX, optionalRow, width * 0.2, contentHeight * 0.085, { color: faint, weight: 400 });
  if (locationVisible(settings)) drawElementText(context, settings, layout, "location", meta.location || "地点", scannerLogoX + width * 0.21, optionalRow, width * 0.13, contentHeight * 0.085, { color: faint, weight: 450 });
  if (settings.filmShowSignature && settings.signature) drawElementText(context, settings, layout, "signature", `by ${settings.signature}`, x + width * 0.97, optionalRow, width * 0.2, contentHeight * 0.085, { align: "right", color: muted, weight: 500 });
  context.restore();
}

function drawCompactFilmBand(context: CanvasRenderingContext2D, photo: PhotoItem, settings: Settings, layout: Layout, inverse = false, theme?: ThemePalette) {
  const { bandX: x, bandY: y, bandWidth: width, bandHeight: height } = layout;
  const meta = photo.filmMetadata;
  const contentHeight = layout.photoHeight * 0.1612;
  const centerY = y + height * (isStripePreset(settings.preset) ? 0.59 : 0.52);
  const filmBrand = catalogInfo(filmBrands, settings.filmBrand);
  const ink = theme?.ink || (inverse ? "#ffffff" : "#171815");
  const muted = theme?.muted || (inverse ? "rgba(255,255,255,.66)" : "#696c65");
  const dividerColor = theme?.accent || (inverse ? "#ffffff" : "#272923");
  const anchors = {
    cameraLogo: 0.035, cameraModel: 0.18, lens: 0.31,
    filmLogo: 0.6, filmName: 0.715, iso: 0.835, location: 0.94,
  };
  const dividerXs = locationVisible(settings) ? [0.16, 0.285, 0.54, 0.695, 0.815, 0.915] : [0.16, 0.285, 0.54, 0.695, 0.825];

  context.save();
  context.textBaseline = "middle";
  context.fillStyle = dividerColor;
  context.globalAlpha = theme ? 0.46 : 0.24;
  for (const dividerX of dividerXs) {
    context.fillRect(x + width * dividerX, centerY - contentHeight * 0.105, Math.max(1, layout.photoWidth * 0.00065), contentHeight * 0.21);
  }
  context.globalAlpha = 1;

  if (settings.filmShowBrand) {
    const point = elementPoint(settings, layout, "cameraBrand", x + width * anchors.cameraLogo, centerY);
    recordElementBounds("cameraBrand", { x: point.x, y: point.y - contentHeight * 0.18 * point.scale, width: width * 0.105 * point.scale, height: contentHeight * 0.36 * point.scale });
    drawBrand(context, meta.make, meta.model, point.x, point.y, width * 0.105 * point.scale, contentHeight * 0.7 * point.scale, inverse);
  }
  if (settings.filmShowModel) drawElementText(context, settings, layout, "cameraModel", meta.model || "CAMERA", x + width * anchors.cameraModel, centerY, width * 0.08, contentHeight * 0.13, { color: ink, weight: 700 });
  if (settings.filmShowLens && meta.lens) drawElementText(context, settings, layout, "lens", meta.lens, x + width * anchors.lens, centerY, width * 0.17, contentHeight * 0.115, { color: muted, weight: 450 });
  if (settings.showFilmBrand) {
    const point = elementPoint(settings, layout, "filmBrand", x + width * anchors.filmLogo, centerY);
    recordElementBounds("filmBrand", { x: point.x, y: point.y - contentHeight * 0.18 * point.scale, width: width * 0.075 * point.scale, height: contentHeight * 0.36 * point.scale });
    drawLogoDefinition(context, filmBrand, point.x, point.y, width * 0.075 * point.scale, contentHeight * 0.58 * point.scale, inverse);
  }
  if (settings.showFilmName) drawElementText(context, settings, layout, "filmName", settings.filmName || "FILM STOCK", x + width * anchors.filmName, centerY, width * 0.095, contentHeight * 0.135, { color: ink, weight: 700 });
  if (settings.filmShowIso) drawElementText(context, settings, layout, "iso", `ISO${meta.iso || "—"}`, x + width * anchors.iso, centerY, width * 0.1, contentHeight * 0.115, { color: muted, weight: 600 });
  if (locationVisible(settings)) drawElementText(context, settings, layout, "location", meta.location || "地点", x + width * anchors.location, centerY, width * 0.09, contentHeight * 0.105, { align: "center", color: muted, weight: 500 });
  context.restore();
}

function drawCenteredCard(context: CanvasRenderingContext2D, photo: PhotoItem, settings: Settings, layout: Layout) {
  const { bandX: x, bandY: y, bandWidth: width, bandHeight: height } = layout;
  const meta = settings.filmMode ? photo.filmMetadata : photo.metadata;
  const contentHeight = layout.photoHeight * 0.1612;
  const showBrand = settings.filmMode ? settings.filmShowBrand : settings.showBrand;
  const showModel = settings.filmMode ? settings.filmShowModel : settings.showModel;
  const showLens = settings.filmMode ? settings.filmShowLens : settings.showLens;
  const showDate = settings.filmMode ? settings.filmShowDate : settings.showDate;
  const showAperture = settings.filmMode ? settings.filmShowAperture : settings.showAperture;
  const showExposure = settings.filmMode ? settings.filmShowExposure : settings.showExposure;
  const showIso = settings.filmMode ? settings.filmShowIso : settings.showIso;
  const showFocal = settings.filmMode ? settings.filmShowFocalLength : settings.showFocalLength;
  const showSignature = settings.filmMode ? settings.filmShowSignature : settings.showSignature;
  context.save();
  context.fillStyle = "#fffefb";
  context.fillRect(x, y, width, height);
  context.strokeStyle = "rgba(30,30,26,.24)";
  context.lineWidth = Math.max(1, layout.photoWidth * 0.00045);
  const parameterBaselineY = y + height * 0.67;
  const dividerCenterY = parameterBaselineY - contentHeight * 0.037;
  const dividerHeight = contentHeight * 0.15;
  for (const dividerX of [0.2725, 0.74]) {
    context.beginPath();
    context.moveTo(x + width * dividerX, dividerCenterY - dividerHeight / 2);
    context.lineTo(x + width * dividerX, dividerCenterY + dividerHeight / 2);
    context.stroke();
  }
  if (showBrand) {
    const brandWidth = width * 0.2;
    const point = elementPoint(settings, layout, "cameraBrand", x + width * 0.5, y + height * 0.19);
    recordElementBounds("cameraBrand", { x: point.x - brandWidth * point.scale / 2, y: point.y - contentHeight * 0.16 * point.scale, width: brandWidth * point.scale, height: contentHeight * 0.32 * point.scale });
    drawBrand(context, meta.make, meta.model, point.x, point.y, brandWidth * point.scale, contentHeight * 0.72 * point.scale, false, "center");
  }
  if (showModel) drawElementText(context, settings, layout, "cameraModel", meta.model || "CAMERA", x + width * 0.5, y + height * 0.37, width * 0.34, contentHeight * 0.13, { align: "center", color: "#171815", weight: 700 });
  if (showLens && meta.lens) drawElementText(context, settings, layout, "lens", meta.lens, x + width * 0.5, y + height * 0.5, width * 0.42, contentHeight * 0.1, { align: "center", color: "#777870", weight: 400 });
  if (showDate) drawElementText(context, settings, layout, "date", formatDate(meta.takenAt), x + width * 0.15, parameterBaselineY, width * 0.21, contentHeight * 0.105, { align: "center", color: "#262722", weight: 450 });
  if (showFocal) drawElementText(context, settings, layout, "focalLength", formatFocal(meta.focalLength), x + width * 0.34, parameterBaselineY, width * 0.1, contentHeight * 0.105, { align: "center", color: "#262722", weight: 520 });
  if (showAperture) drawElementText(context, settings, layout, "aperture", formatAperture(meta.aperture), x + width * 0.45, parameterBaselineY, width * 0.09, contentHeight * 0.105, { align: "center", color: "#262722", weight: 520 });
  if (showExposure) drawElementText(context, settings, layout, "exposure", formatExposure(meta.exposure), x + width * 0.56, parameterBaselineY, width * 0.1, contentHeight * 0.105, { align: "center", color: "#262722", weight: 520 });
  if (showIso) drawElementText(context, settings, layout, "iso", `ISO ${meta.iso || "—"}`, x + width * 0.67, parameterBaselineY, width * 0.1, contentHeight * 0.105, { align: "center", color: "#262722", weight: 520 });
  if (locationVisible(settings)) drawElementText(context, settings, layout, "location", meta.location || "地点", x + width * 0.85, parameterBaselineY, width * 0.18, contentHeight * 0.105, { align: "center", color: "#262722", weight: 450 });
  if (showSignature && settings.signature) drawElementText(context, settings, layout, "signature", `© ${settings.signature}`, x + width * 0.5, y + height * 0.87, width * 0.42, contentHeight * 0.105, { align: "center", color: "#30312c", weight: 450 });
  context.restore();
}

function drawFloatingCard(context: CanvasRenderingContext2D, photo: PhotoItem, settings: Settings, layout: Layout) {
  const { bandX: x, bandY: y, bandWidth: width, bandHeight: height } = layout;
  const meta = photo.metadata;
  const contentHeight = layout.photoHeight * 0.1612;
  const rowY = y + height * 0.58;
  context.save();
  if (settings.showBrand) {
    const brandWidth = width * 0.15;
    const point = elementPoint(settings, layout, "cameraBrand", x + width * 0.5, y + height * 0.22);
    recordElementBounds("cameraBrand", { x: point.x - brandWidth * point.scale / 2, y: point.y - contentHeight * 0.16 * point.scale, width: brandWidth * point.scale, height: contentHeight * 0.32 * point.scale });
    drawBrand(context, meta.make, meta.model, point.x, point.y, brandWidth * point.scale, contentHeight * 0.7 * point.scale, false, "center");
  }
  context.strokeStyle = "rgba(29,30,27,.22)";
  context.lineWidth = Math.max(1, layout.photoWidth * 0.0005);
  for (const dividerX of locationVisible(settings) ? [0.275, 0.755] : [0.275]) {
    context.beginPath();
    context.moveTo(x + width * dividerX, rowY - contentHeight * 0.085);
    context.lineTo(x + width * dividerX, rowY + contentHeight * 0.085);
    context.stroke();
  }
  if (settings.showDate) drawElementText(context, settings, layout, "date", formatDate(meta.takenAt), x + width * 0.16, rowY, width * 0.21, contentHeight * 0.105, { align: "center", color: "#292a26", weight: 450 });
  if (settings.showFocalLength) drawElementText(context, settings, layout, "focalLength", formatFocal(meta.focalLength), x + width * 0.35, rowY, width * 0.1, contentHeight * 0.105, { align: "center", color: "#292a26", weight: 520 });
  if (settings.showAperture) drawElementText(context, settings, layout, "aperture", formatAperture(meta.aperture), x + width * 0.46, rowY, width * 0.09, contentHeight * 0.105, { align: "center", color: "#292a26", weight: 520 });
  if (settings.showExposure) drawElementText(context, settings, layout, "exposure", formatExposure(meta.exposure), x + width * 0.57, rowY, width * 0.1, contentHeight * 0.105, { align: "center", color: "#292a26", weight: 520 });
  if (settings.showIso) drawElementText(context, settings, layout, "iso", `ISO${meta.iso || "—"}`, x + width * 0.68, rowY, width * 0.1, contentHeight * 0.105, { align: "center", color: "#292a26", weight: 520 });
  if (locationVisible(settings)) drawElementText(context, settings, layout, "location", meta.location || "地点", x + width * 0.86, rowY, width * 0.17, contentHeight * 0.105, { align: "center", color: "#292a26", weight: 450 });
  if (settings.showSignature && settings.signature) drawElementText(context, settings, layout, "signature", `© ${settings.signature}`, x + width * 0.5, y + height * 0.84, width * 0.42, contentHeight * 0.105, { align: "center", color: "#383934", weight: 450 });
  context.restore();
}

function drawCinematicCard(context: CanvasRenderingContext2D, photo: PhotoItem, settings: Settings, layout: Layout) {
  const { bandX: x, bandY: y, bandWidth: width, bandHeight: height } = layout;
  const meta = photo.metadata;
  const contentHeight = layout.photoHeight * 0.1612;
  context.save();
  if (settings.showBrand) {
    const brandWidth = width * 0.18;
    const point = elementPoint(settings, layout, "cameraBrand", x + width * 0.5, y + height * 0.24);
    recordElementBounds("cameraBrand", { x: point.x - brandWidth * point.scale / 2, y: point.y - contentHeight * 0.16 * point.scale, width: brandWidth * point.scale, height: contentHeight * 0.32 * point.scale });
    drawBrand(context, meta.make, meta.model, point.x, point.y, brandWidth * point.scale, contentHeight * 0.75 * point.scale, true, "center", true);
  }
  const parameterFamily = '"Segoe UI Variable Display", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  if (settings.showFocalLength) drawElementText(context, settings, layout, "focalLength", formatFocal(meta.focalLength), x + width * 0.34, y + height * 0.55, width * 0.11, contentHeight * 0.12, { align: "center", color: "#ffffff", weight: 680, family: parameterFamily });
  if (settings.showAperture) drawElementText(context, settings, layout, "aperture", formatAperture(meta.aperture), x + width * 0.45, y + height * 0.55, width * 0.1, contentHeight * 0.12, { align: "center", color: "#ffffff", weight: 680, family: parameterFamily });
  if (settings.showExposure) drawElementText(context, settings, layout, "exposure", formatExposure(meta.exposure), x + width * 0.56, y + height * 0.55, width * 0.11, contentHeight * 0.12, { align: "center", color: "#ffffff", weight: 680, family: parameterFamily });
  if (settings.showIso) drawElementText(context, settings, layout, "iso", `ISO${meta.iso || "—"}`, x + width * 0.68, y + height * 0.55, width * 0.11, contentHeight * 0.12, { align: "center", color: "#ffffff", weight: 680, family: parameterFamily });
  const locationX = settings.showDate ? 0.42 : 0.5;
  const dateX = locationVisible(settings) ? 0.62 : 0.5;
  if (locationVisible(settings)) drawElementText(context, settings, layout, "location", meta.location || "地点", x + width * locationX, y + height * 0.82, width * 0.28, contentHeight * 0.09, { align: "center", color: "rgba(255,255,255,.62)", weight: 400, family: "Georgia, serif" });
  if (settings.showDate) drawElementText(context, settings, layout, "date", formatDate(meta.takenAt), x + width * dateX, y + height * 0.82, width * 0.28, contentHeight * 0.09, { align: "center", color: "rgba(255,255,255,.58)", weight: 400 });
  context.restore();
}

function drawImmersiveCard(context: CanvasRenderingContext2D, photo: PhotoItem, settings: Settings, layout: Layout) {
  const { bandX: x, bandY: y, bandWidth: width, bandHeight: height } = layout;
  const meta = settings.filmMode ? photo.filmMetadata : photo.metadata;
  const contentHeight = layout.photoHeight * 0.1612;
  const showBrand = settings.filmMode ? settings.filmShowBrand : settings.showBrand;
  const showModel = settings.filmMode ? settings.filmShowModel : settings.showModel;
  const showLens = settings.filmMode ? settings.filmShowLens : settings.showLens;
  const showDate = settings.filmMode ? settings.filmShowDate : settings.showDate;
  const showAperture = settings.filmMode ? settings.filmShowAperture : settings.showAperture;
  const showExposure = settings.filmMode ? settings.filmShowExposure : settings.showExposure;
  const showIso = settings.filmMode ? settings.filmShowIso : settings.showIso;
  const showFocal = settings.filmMode ? settings.filmShowFocalLength : settings.showFocalLength;
  const showSignature = settings.filmMode ? settings.filmShowSignature : settings.showSignature;
  context.save();
  const gradient = context.createLinearGradient(0, y - height * 0.8, 0, y + height);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.46, "rgba(0,0,0,.24)");
  gradient.addColorStop(1, "rgba(0,0,0,.82)");
  context.fillStyle = gradient;
  context.fillRect(x, y - height * 0.8, width, height * 1.8);
  if (showBrand) {
    const brandWidth = width * 0.16;
    const point = elementPoint(settings, layout, "cameraBrand", layout.photoX + layout.photoWidth * 0.5, layout.photoY + layout.photoHeight * 0.055);
    recordElementBounds("cameraBrand", { x: point.x - brandWidth * point.scale / 2, y: point.y - contentHeight * 0.16 * point.scale, width: brandWidth * point.scale, height: contentHeight * 0.32 * point.scale });
    drawBrand(context, meta.make, meta.model, point.x, point.y, brandWidth * point.scale, contentHeight * 0.76 * point.scale, true, "center");
  }
  if (showModel) drawElementText(context, settings, layout, "cameraModel", meta.model || "CAMERA", layout.photoX + layout.photoWidth * 0.5, layout.photoY + layout.photoHeight * 0.105, width * 0.3, contentHeight * 0.11, { align: "center", color: "rgba(255,255,255,.9)", weight: 600 });
  if (showLens && meta.lens) drawElementText(context, settings, layout, "lens", meta.lens, x + width * 0.5, y + height * 0.28, width * 0.46, contentHeight * 0.095, { align: "center", color: "rgba(255,255,255,.65)", weight: 400, family: "Georgia, serif" });
  if (showDate) drawElementText(context, settings, layout, "date", formatDate(meta.takenAt), x + width * (locationVisible(settings) ? 0.61 : 0.5), y + height * 0.43, width * 0.26, contentHeight * 0.09, { align: "center", color: "rgba(255,255,255,.68)", weight: 400 });
  if (locationVisible(settings)) drawElementText(context, settings, layout, "location", meta.location || "地点", x + width * 0.39, y + height * 0.43, width * 0.25, contentHeight * 0.09, { align: "center", color: "rgba(255,255,255,.68)", weight: 400 });
  const parameterFamily = '"Segoe UI Variable Display", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  if (showFocal) drawElementText(context, settings, layout, "focalLength", formatFocal(meta.focalLength), x + width * 0.34, y + height * 0.7, width * 0.11, contentHeight * 0.125, { align: "center", color: "#fff", weight: 650, family: parameterFamily });
  if (showAperture) drawElementText(context, settings, layout, "aperture", formatAperture(meta.aperture), x + width * 0.45, y + height * 0.7, width * 0.1, contentHeight * 0.125, { align: "center", color: "#fff", weight: 650, family: parameterFamily });
  if (showExposure) drawElementText(context, settings, layout, "exposure", formatExposure(meta.exposure), x + width * 0.56, y + height * 0.7, width * 0.11, contentHeight * 0.125, { align: "center", color: "#fff", weight: 650, family: parameterFamily });
  if (showIso) drawElementText(context, settings, layout, "iso", `ISO${meta.iso || "—"}`, x + width * 0.68, y + height * 0.7, width * 0.11, contentHeight * 0.125, { align: "center", color: "#fff", weight: 650, family: parameterFamily });
  if (showSignature && settings.signature) drawElementText(context, settings, layout, "signature", `by ${settings.signature}`, x + width * 0.5, y + height * 0.9, width * 0.34, contentHeight * 0.09, { align: "center", color: "rgba(255,255,255,.72)", weight: 450 });
  context.restore();
}

function drawSidecarCard(context: CanvasRenderingContext2D, photo: PhotoItem, settings: Settings, layout: Layout) {
  const { bandX: x, bandY: y, bandWidth: width, bandHeight: height } = layout;
  const meta = settings.filmMode ? photo.filmMetadata : photo.metadata;
  const contentHeight = layout.photoHeight * 0.1612;
  const showBrand = settings.filmMode ? settings.filmShowBrand : settings.showBrand;
  const showModel = settings.filmMode ? settings.filmShowModel : settings.showModel;
  const showLens = settings.filmMode ? settings.filmShowLens : settings.showLens;
  const showDate = settings.filmMode ? settings.filmShowDate : settings.showDate;
  const showAperture = settings.filmMode ? settings.filmShowAperture : settings.showAperture;
  const showExposure = settings.filmMode ? settings.filmShowExposure : settings.showExposure;
  const showIso = settings.filmMode ? settings.filmShowIso : settings.showIso;
  const showFocal = settings.filmMode ? settings.filmShowFocalLength : settings.showFocalLength;
  const showSignature = settings.filmMode ? settings.filmShowSignature : settings.showSignature;
  const labelX = x + width * 0.12;
  const valueX = x + width * 0.52;
  const row = (label: string, element: ElementId, value: string, position: number, visible: boolean, valueWidth = 0.4) => {
    if (!visible) return;
    drawTextFit(context, label, labelX, y + height * position, width * 0.34, contentHeight * 0.1, { align: "left", color: "#a3a59f", weight: 400 });
    drawElementText(context, settings, layout, element, value, valueX, y + height * position, width * valueWidth, contentHeight * 0.11, { color: "#292a26", weight: 500 });
  };
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(x, y, width, height);
  context.fillStyle = "#767970";
  context.font = `600 ${Math.max(10, contentHeight * 0.09)}px Arial, sans-serif`;
  context.letterSpacing = `${Math.max(1, contentHeight * 0.012)}px`;
  context.fillText("PHOTO NOTES", labelX, y + height * 0.08);
  context.strokeStyle = "rgba(30,31,27,.16)";
  context.lineWidth = Math.max(1, layout.photoWidth * 0.00045);
  for (const divider of [0.33, 0.68, 0.78, 0.87]) {
    context.beginPath();
    context.moveTo(x + width * 0.1, y + height * divider);
    context.lineTo(x + width * 0.9, y + height * divider);
    context.stroke();
  }
  row("Taken At", "date", formatDate(meta.takenAt), 0.18, showDate);
  row("Location", "location", meta.location || "地点", 0.24, locationVisible(settings));
  row("Lens", "lens", meta.lens || "—", 0.3, showLens);
  row("Focal", "focalLength", formatFocal(meta.focalLength), 0.39, showFocal);
  row("Aperture", "aperture", formatAperture(meta.aperture), 0.47, showAperture);
  row("Shutter", "exposure", formatExposure(meta.exposure), 0.55, showExposure);
  row("ISO", "iso", meta.iso || "—", 0.63, showIso);
  row("Photo By", "signature", settings.signature || "—", 0.73, showSignature);
  row("Shot On", "cameraModel", meta.model || "CAMERA", 0.83, showModel);
  if (showBrand) {
    const brandWidth = width * 0.7;
    const point = elementPoint(settings, layout, "cameraBrand", x + width * 0.5, y + height * 0.93);
    recordElementBounds("cameraBrand", { x: point.x - brandWidth * point.scale / 2, y: point.y - contentHeight * 0.17 * point.scale, width: brandWidth * point.scale, height: contentHeight * 0.34 * point.scale });
    drawBrand(context, meta.make, meta.model, point.x, point.y, brandWidth * point.scale, contentHeight * 0.82 * point.scale, false, "center");
  }
  context.restore();
}

function drawFilmSidecarCard(context: CanvasRenderingContext2D, photo: PhotoItem, settings: Settings, layout: Layout) {
  const { bandX: x, bandY: y, bandWidth: width, bandHeight: height } = layout;
  const meta = photo.filmMetadata;
  const contentHeight = layout.photoHeight * 0.1612;
  const centerX = x + width * 0.5;
  const label = (text: string, position: number) => drawTextFit(context, text, centerX, y + height * position, width * 0.76, contentHeight * 0.075, { align: "center", color: "#a0a39b", weight: 700 });
  const rule = (position: number) => {
    context.strokeStyle = "rgba(30,31,27,.14)";
    context.lineWidth = Math.max(1, layout.photoWidth * 0.00045);
    context.beginPath();
    context.moveTo(x + width * 0.13, y + height * position);
    context.lineTo(x + width * 0.87, y + height * position);
    context.stroke();
  };
  context.save();
  context.textBaseline = "middle";
  context.fillStyle = "#ffffff";
  context.fillRect(x, y, width, height);

  if (settings.filmShowDate) drawElementText(context, settings, layout, "date", formatDate(meta.takenAt), x + width * (locationVisible(settings) ? 0.32 : 0.5), y + height * 0.03, width * 0.42, contentHeight * 0.075, { align: "center", color: "#a0a39b", weight: 450 });
  if (locationVisible(settings)) drawElementText(context, settings, layout, "location", meta.location || "地点", x + width * 0.72, y + height * 0.03, width * 0.34, contentHeight * 0.075, { align: "center", color: "#a0a39b", weight: 450 });
  label("CAMERA", 0.07);
  if (settings.filmShowBrand) {
    const point = elementPoint(settings, layout, "cameraBrand", centerX, y + height * 0.145);
    recordElementBounds("cameraBrand", { x: point.x - width * 0.34 * point.scale, y: point.y - contentHeight * 0.16 * point.scale, width: width * 0.68 * point.scale, height: contentHeight * 0.32 * point.scale });
    drawBrand(context, meta.make, meta.model, point.x, point.y, width * 0.68 * point.scale, contentHeight * 0.68 * point.scale, false, "center");
  }
  if (settings.filmShowModel) drawElementText(context, settings, layout, "cameraModel", meta.model || "CAMERA", centerX, y + height * 0.215, width * 0.72, contentHeight * 0.13, { align: "center", color: "#1e201c", weight: 700 });
  if (settings.filmShowLens && meta.lens) drawElementText(context, settings, layout, "lens", meta.lens, centerX, y + height * 0.265, width * 0.76, contentHeight * 0.105, { align: "center", color: "#777a72", weight: 450 });
  if (settings.filmShowAperture) drawElementText(context, settings, layout, "aperture", formatAperture(meta.aperture), x + width * 0.25, y + height * 0.298, width * 0.2, contentHeight * 0.075, { align: "center", color: "#8b8e86", weight: 550 });
  if (settings.filmShowExposure) drawElementText(context, settings, layout, "exposure", formatExposure(meta.exposure), x + width * 0.5, y + height * 0.298, width * 0.2, contentHeight * 0.075, { align: "center", color: "#8b8e86", weight: 550 });
  if (settings.filmShowFocalLength) drawElementText(context, settings, layout, "focalLength", formatFocal(meta.focalLength), x + width * 0.75, y + height * 0.298, width * 0.2, contentHeight * 0.075, { align: "center", color: "#8b8e86", weight: 550 });
  rule(0.315);

  label("FILM STOCK", 0.37);
  if (settings.showFilmBrand) {
    const filmBrand = catalogInfo(filmBrands, settings.filmBrand);
    const point = elementPoint(settings, layout, "filmBrand", centerX, y + height * 0.445);
    recordElementBounds("filmBrand", { x: point.x - width * 0.19 * point.scale, y: point.y - contentHeight * 0.16 * point.scale, width: width * 0.38 * point.scale, height: contentHeight * 0.32 * point.scale });
    drawLogoDefinition(context, filmBrand, point.x, point.y, width * 0.38 * point.scale, contentHeight * 0.58 * point.scale, false, "center");
  }
  if (settings.showFilmName) drawElementText(context, settings, layout, "filmName", settings.filmName || "FILM STOCK", centerX, y + height * 0.515, width * 0.72, contentHeight * 0.135, { align: "center", color: "#1e201c", weight: 700 });
  if (settings.filmShowIso) drawElementText(context, settings, layout, "iso", `ISO ${meta.iso || "—"}`, centerX, y + height * 0.565, width * 0.52, contentHeight * 0.105, { align: "center", color: "#777a72", weight: 550 });
  rule(0.62);

  if (settings.showScanner) {
    label("SCANNED WITH", 0.675);
    const scannerBrand = catalogInfo(scannerBrands, settings.scannerBrand);
    const point = elementPoint(settings, layout, "scanner", centerX, y + height * 0.75);
    recordElementBounds("scanner", { x: point.x - width * 0.34 * point.scale, y: point.y - contentHeight * 0.16 * point.scale, width: width * 0.68 * point.scale, height: contentHeight * 0.32 * point.scale });
    drawLogoDefinition(context, scannerBrand, point.x, point.y, width * 0.68 * point.scale, contentHeight * 0.62 * point.scale, false, "center");
    drawElementText(context, settings, layout, "scanner", settings.scannerName || "FILM SCANNER", centerX, y + height * 0.815, width * 0.72, contentHeight * 0.11, { align: "center", color: "#555850", weight: 600 });
  }
  rule(0.855);
  if (settings.showLab) {
    label("DEVELOPED BY", 0.9);
    drawElementText(context, settings, layout, "lab", settings.labName || "YOUR FILM LAB", centerX, y + height * 0.955, width * 0.76, contentHeight * 0.12, { align: "center", color: "#1e201c", weight: 650 });
  }
  if (settings.filmShowSignature && settings.signature) drawElementText(context, settings, layout, "signature", `by ${settings.signature}`, centerX, y + height * 0.988, width * 0.72, contentHeight * 0.07, { align: "center", color: "#8b8e86", weight: 450 });
  context.restore();
}

function renderPhoto(photo: PhotoItem, settings: Settings, maxEdge?: number, collectBounds = false): RenderedPhoto {
  const fullLayout = getLayout(photo, settings, 1);
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(fullLayout.width, fullLayout.height)) : 1;
  const layout = getLayout(photo, settings, scale);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("浏览器无法创建绘图画布");
  const bounds: ElementBoundsMap = {};
  collectingElementBounds = collectBounds ? bounds : null;
  italicThemeText = settings.preset === "cinematic" || settings.preset === "immersive";
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const theme = themePalette(settings.preset);
  const background = theme?.background || (settings.preset === "noir" || settings.preset === "cinematic" ? "#101311" : settings.preset === "gallery" ? "#f2efe7" : "#ffffff");
  context.fillStyle = background;
  context.fillRect(0, 0, layout.width, layout.height);
  if (settings.preset === "cinematic") {
    context.save();
    context.filter = `blur(${Math.max(14, layout.photoWidth * 0.018)}px) brightness(.68) saturate(.9)`;
    drawImageCover(context, photo.image, photo.width, photo.height, -layout.width * 0.04, -layout.height * 0.04, layout.width * 1.08, layout.height * 1.08);
    context.restore();
    const backdrop = context.createLinearGradient(0, layout.photoHeight * 0.45, 0, layout.height);
    backdrop.addColorStop(0, "rgba(7,10,9,.03)");
    backdrop.addColorStop(0.65, "rgba(7,10,9,.26)");
    backdrop.addColorStop(1, "rgba(7,10,9,.48)");
    context.fillStyle = backdrop;
    context.fillRect(0, 0, layout.width, layout.height);
  }
  if (settings.preset === "floating") {
    const radius = Math.max(3, layout.photoWidth * 0.004);
    const paintShadowLayer = (color: string, blur: number, offsetY: number) => {
      context.save();
      context.shadowColor = color;
      context.shadowBlur = blur;
      context.shadowOffsetY = offsetY;
      context.fillStyle = "#ffffff";
      roundedRect(context, layout.photoX, layout.photoY, layout.photoWidth, layout.photoHeight, radius);
      context.fill();
      context.restore();
    };
    paintShadowLayer("rgba(30,35,30,.3)", Math.max(28, layout.photoWidth * 0.052), Math.max(16, layout.photoHeight * 0.028));
    paintShadowLayer("rgba(25,29,25,.22)", Math.max(10, layout.photoWidth * 0.018), Math.max(7, layout.photoHeight * 0.012));
    context.save();
    roundedRect(context, layout.photoX, layout.photoY, layout.photoWidth, layout.photoHeight, radius);
    context.clip();
    context.drawImage(photo.image, layout.photoX, layout.photoY, layout.photoWidth, layout.photoHeight);
    context.restore();
  } else if (settings.preset === "centered" || settings.preset === "cinematic") {
    const radius = Math.max(10, layout.photoWidth * 0.018);
    context.save();
    context.shadowColor = settings.preset === "cinematic" ? "rgba(0,0,0,.5)" : "rgba(24,27,24,.28)";
    context.shadowBlur = Math.max(12, layout.photoWidth * 0.025);
    context.shadowOffsetY = Math.max(8, layout.photoHeight * 0.014);
    context.fillStyle = "#ffffff";
    roundedRect(context, layout.photoX, layout.photoY, layout.photoWidth, layout.photoHeight, radius);
    context.fill();
    context.shadowColor = "transparent";
    roundedRect(context, layout.photoX, layout.photoY, layout.photoWidth, layout.photoHeight, radius);
    context.clip();
    context.drawImage(photo.image, layout.photoX, layout.photoY, layout.photoWidth, layout.photoHeight);
    context.restore();
  } else {
    context.drawImage(photo.image, layout.photoX, layout.photoY, layout.photoWidth, layout.photoHeight);
  }

  if (settings.filmMode && settings.filmCompact && settings.preset === "provia") {
    drawProviaFilmBand(context, photo, settings, layout, true);
  } else if (settings.filmMode && settings.filmCompact) {
    const compactInverse = settings.preset === "overlay" || settings.preset === "immersive" || settings.preset === "cinematic" || settings.preset === "noir";
    if (settings.preset === "overlay" || settings.preset === "immersive") {
      const gradient = context.createLinearGradient(0, layout.bandY - layout.bandHeight * 0.45, 0, layout.bandY + layout.bandHeight);
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(0.42, "rgba(0,0,0,.28)");
      gradient.addColorStop(1, "rgba(0,0,0,.82)");
      context.fillStyle = gradient;
      context.fillRect(layout.bandX, layout.bandY - layout.bandHeight * 0.45, layout.bandWidth, layout.bandHeight * 1.45);
    }
    if (settings.preset === "gallery") {
      context.fillStyle = "rgba(30,30,25,.15)";
      context.fillRect(layout.bandX, layout.bandY, layout.bandWidth, Math.max(1, layout.bandHeight * 0.004));
    }
    if (theme) drawThemeRules(context, layout, theme, settings.preset);
    drawCompactFilmBand(context, photo, settings, layout, compactInverse, theme);
  } else if (settings.preset === "provia") {
    if (settings.filmMode) drawProviaFilmBand(context, photo, settings, layout);
    else drawProviaStandardBand(context, photo, settings, layout);
  } else if (settings.preset === "centered") {
    if (settings.filmMode) drawFilmWorkflowBand(context, photo, settings, layout);
    else drawCenteredCard(context, photo, settings, layout);
  } else if (settings.preset === "floating") {
    if (settings.filmMode) drawFilmWorkflowBand(context, photo, settings, layout);
    else drawFloatingCard(context, photo, settings, layout);
  } else if (settings.preset === "cinematic") {
    if (settings.filmMode) drawFilmWorkflowBand(context, photo, settings, layout, true);
    else drawCinematicCard(context, photo, settings, layout);
  } else if (settings.preset === "immersive") {
    if (settings.filmMode) {
      const gradient = context.createLinearGradient(0, layout.bandY - layout.bandHeight * 0.65, 0, layout.bandY + layout.bandHeight);
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(0.46, "rgba(0,0,0,.26)");
      gradient.addColorStop(1, "rgba(0,0,0,.84)");
      context.fillStyle = gradient;
      context.fillRect(layout.bandX, layout.bandY - layout.bandHeight * 0.65, layout.bandWidth, layout.bandHeight * 1.65);
      drawFilmWorkflowBand(context, photo, settings, layout, true);
    } else drawImmersiveCard(context, photo, settings, layout);
  } else if (settings.preset === "sidecar") {
    if (settings.filmMode) drawFilmSidecarCard(context, photo, settings, layout);
    else drawSidecarCard(context, photo, settings, layout);
  } else if (settings.preset === "overlay") {
    const gradient = context.createLinearGradient(0, layout.bandY - layout.bandHeight * 0.35, 0, layout.bandY + layout.bandHeight);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.42, "rgba(0,0,0,.30)");
    gradient.addColorStop(1, "rgba(0,0,0,.78)");
    context.fillStyle = gradient;
    context.fillRect(0, layout.bandY - layout.bandHeight * 0.35, layout.width, layout.bandHeight * 1.35);
    context.shadowColor = "rgba(0,0,0,.35)";
    context.shadowBlur = Math.max(2, layout.bandHeight * 0.02);
    if (settings.filmMode) drawFilmWorkflowBand(context, photo, settings, layout, true);
    else drawStandardBand(context, photo, settings, layout, true);
    context.shadowBlur = 0;
  } else {
    if (settings.preset === "gallery") {
      context.fillStyle = "rgba(30,30,25,.15)";
      context.fillRect(layout.bandX, layout.bandY, layout.bandWidth, Math.max(1, layout.bandHeight * 0.004));
    }
    if (theme) drawThemeRules(context, layout, theme, settings.preset);
    if (settings.filmMode) drawFilmWorkflowBand(context, photo, settings, layout, settings.preset === "noir", theme);
    else drawStandardBand(context, photo, settings, layout, settings.preset === "noir", theme);
  }
  collectingElementBounds = null;
  italicThemeText = false;
  return { canvas, bounds };
}

function drawSelectionOverlay(context: CanvasRenderingContext2D, bounds?: ElementBounds) {
  if (!bounds) return;
  const padding = Math.max(4, context.canvas.width * 0.0035);
  const handle = Math.max(9, context.canvas.width * 0.008);
  const x = bounds.x - padding;
  const y = bounds.y - padding;
  const width = bounds.width + padding * 2;
  const height = bounds.height + padding * 2;
  context.save();
  context.strokeStyle = "#b8d126";
  context.fillStyle = "#ffffff";
  context.lineWidth = Math.max(2, context.canvas.width * 0.0015);
  context.setLineDash([context.lineWidth * 3, context.lineWidth * 2]);
  context.strokeRect(x, y, width, height);
  context.setLineDash([]);
  for (const [handleX, handleY] of [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]) {
    context.fillRect(handleX - handle / 2, handleY - handle / 2, handle, handle);
    context.strokeRect(handleX - handle / 2, handleY - handle / 2, handle, handle);
  }
  context.restore();
}

function isBmpFile(file: File) {
  return (acceptedTypes.has(file.type) && file.type.toLowerCase().includes("bmp")) || /\.bmp$/i.test(file.name);
}

function decodeBmp(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 54 || view.getUint16(0, true) !== 0x4d42) throw new Error("BMP 文件头无效或文件已损坏");
  const pixelOffset = view.getUint32(10, true);
  const dibSize = view.getUint32(14, true);
  if (dibSize < 40) throw new Error("暂不支持此旧版 BMP 格式");
  const width = view.getInt32(18, true);
  const signedHeight = view.getInt32(22, true);
  const height = Math.abs(signedHeight);
  const planes = view.getUint16(26, true);
  const bits = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  if (planes !== 1 || width <= 0 || height <= 0 || width * height > 120_000_000) throw new Error("BMP 尺寸或色彩平面无效");
  if (compression !== 0) throw new Error("暂不支持压缩型 BMP，请另存为标准 RGB BMP");
  if (![1, 4, 8, 16, 24, 32].includes(bits)) throw new Error(`暂不支持 ${bits} 位 BMP`);

  const rowStride = Math.floor((bits * width + 31) / 32) * 4;
  if (pixelOffset + rowStride * height > view.byteLength) throw new Error("BMP 像素数据不完整");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("浏览器无法建立 BMP 解码画布");
  const output = context.createImageData(width, height);
  const paletteStart = 14 + dibSize;
  const colorsUsed = bits <= 8 ? (view.getUint32(46, true) || 2 ** bits) : 0;
  if (colorsUsed && paletteStart + colorsUsed * 4 > pixelOffset) throw new Error("BMP 调色板无效");
  const topDown = signedHeight < 0;

  for (let targetY = 0; targetY < height; targetY += 1) {
    const sourceY = topDown ? targetY : height - 1 - targetY;
    const row = pixelOffset + sourceY * rowStride;
    for (let x = 0; x < width; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      if (bits <= 8) {
        const packed = view.getUint8(row + Math.floor(x * bits / 8));
        const shift = 8 - bits - (x * bits) % 8;
        const index = (packed >> shift) & (2 ** bits - 1);
        const palette = paletteStart + index * 4;
        blue = view.getUint8(palette);
        green = view.getUint8(palette + 1);
        red = view.getUint8(palette + 2);
      } else if (bits === 16) {
        const pixel = view.getUint16(row + x * 2, true);
        red = Math.round(((pixel >> 10) & 0x1f) * 255 / 31);
        green = Math.round(((pixel >> 5) & 0x1f) * 255 / 31);
        blue = Math.round((pixel & 0x1f) * 255 / 31);
      } else {
        const pixel = row + x * (bits / 8);
        blue = view.getUint8(pixel);
        green = view.getUint8(pixel + 1);
        red = view.getUint8(pixel + 2);
      }
      const target = (targetY * width + x) * 4;
      output.data[target] = red;
      output.data[target + 1] = green;
      output.data[target + 2] = blue;
      output.data[target + 3] = 255;
    }
  }
  context.putImageData(output, 0, 0);
  return canvas;
}

function loadBrowserImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => image.naturalWidth && image.naturalHeight ? resolve(image) : reject(new Error("图片尺寸无效"));
    image.onerror = () => reject(new Error("浏览器无法解码此图片"));
    image.src = url;
  });
}

async function readPhoto(file: File): Promise<PhotoItem> {
  let url = "";
  try {
    let image: CanvasImageSource;
    let width: number;
    let height: number;
    if (isBmpFile(file)) {
      const canvas = decodeBmp(await file.arrayBuffer());
      const previewBlob = await canvasToBlob(canvas, "png");
      url = URL.createObjectURL(previewBlob);
      image = canvas;
      width = canvas.width;
      height = canvas.height;
    } else {
      url = URL.createObjectURL(file);
      const browserImage = await loadBrowserImage(url);
      image = browserImage;
      width = browserImage.naturalWidth;
      height = browserImage.naturalHeight;
    }
    const [raw, gps] = await Promise.all([
      exifr.parse(file, {
        pick: [
          "Make",
          "Model",
          "LensModel",
          "FNumber",
          "ExposureTime",
          "ISO",
          "ISOSpeedRatings",
          "PhotographicSensitivity",
          "FocalLength",
          "DateTimeOriginal",
          "CreateDate",
        ],
      }).catch(() => undefined),
      exifr.gps(file).catch(() => undefined),
    ]);
    const detectedModel = clean(raw?.Model);
    const latitude = asNumber(gps?.latitude);
    const longitude = asNumber(gps?.longitude);
    const metadata: PhotoMetadata = {
      make: clean(raw?.Make),
      model: detectedModel?.toUpperCase() === "BKQ-AN90" ? "Magic 8 Pro" : detectedModel,
      lens: clean(raw?.LensModel),
      aperture: numberString(raw?.FNumber),
      exposure: exposureString(raw?.ExposureTime),
      iso: numberString(raw?.ISO ?? raw?.ISOSpeedRatings ?? raw?.PhotographicSensitivity),
      focalLength: numberString(raw?.FocalLength),
      takenAt: dateInputString(raw?.DateTimeOriginal instanceof Date ? raw.DateTimeOriginal : raw?.CreateDate),
      location: "地点",
    };
    return {
      id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      url,
      image,
      width,
      height,
      metadata,
      filmMetadata: { ...defaultFilmMetadata },
      autoMetadata: { ...metadata },
      coordinates: latitude !== undefined && longitude !== undefined ? { latitude, longitude } : undefined,
    };
  } catch (error) {
    if (url) URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, format: ExportFormat) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("图片编码失败"))),
      format === "png" ? "image/png" : "image/jpeg",
      format === "jpeg" ? 1 : undefined,
    );
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function outputName(file: File, format: ExportFormat) {
  const stem = file.name.replace(/\.[^.]+$/, "");
  return `${stem}_photon-frame.${format === "png" ? "png" : "jpg"}`;
}

function editableValueForElement(element: ElementId, photo: PhotoItem | undefined, settings: Settings): string | undefined {
  if (element === "signature") return settings.signature;
  if (element === "filmName") return settings.filmName;
  if (element === "lab") return settings.labName;
  if (element === "scanner") return settings.scannerName;
  if (!photo) return undefined;
  const fieldMap: Partial<Record<ElementId, keyof PhotoMetadata>> = {
    cameraModel: "model",
    lens: "lens",
    aperture: "aperture",
    exposure: "exposure",
    iso: "iso",
    focalLength: "focalLength",
    date: "takenAt",
    location: "location",
  };
  const field = fieldMap[element];
  const metadata = settings.filmMode ? photo.filmMetadata : photo.metadata;
  return field ? metadata[field] || "" : undefined;
}

export default function Home() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [logosReady, setLogosReady] = useState(false);
  const sharedMetadataOverridesRef = useRef<{
    standard: Partial<PhotoMetadata>;
    film: Partial<PhotoMetadata>;
  }>({ standard: {}, film: {} });
  const [settings, setSettings] = useState<Settings>({
    preset: "classic",
    bandSize: 12,
    filmBandSize: 12,
    signature: "你的名字",
    showSignature: true,
    showBrand: true,
    showModel: true,
    showDate: true,
    showLens: true,
    showAperture: true,
    showExposure: true,
    showIso: true,
    showFocalLength: true,
    showLocationByPreset: { centered: true },
    filmMode: false,
    filmCompact: false,
    filmShowSignature: false,
    filmShowBrand: true,
    filmShowModel: true,
    filmShowDate: false,
    filmShowLens: true,
    filmShowAperture: false,
    filmShowExposure: false,
    filmShowIso: true,
    filmShowFocalLength: false,
    filmBrand: "KODAK",
    filmName: "EKTAR100",
    labName: "我的冲洗店",
    scannerBrand: "NORITSU",
    scannerName: "HS-1800",
    showFilmBrand: true,
    showFilmName: true,
    showLab: true,
    showScanner: true,
    transforms: {},
    format: "png",
  });
  const [activeElement, setActiveElement] = useState<ElementId>("cameraBrand");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const elementEditorInputRef = useRef<HTMLInputElement>(null);
  const elementBoundsRef = useRef<ElementBoundsMap>({});
  const elementDragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    element: ElementId;
    mode: "move" | "resize";
    resizeCorner?: "nw" | "ne" | "sw" | "se";
    origin: ElementTransform;
  } | null>(null);
  const selected = photos.find((photo) => photo.id === selectedId) || photos[0];
  const selectedMetadata = selected ? (settings.filmMode ? selected.filmMetadata : selected.metadata) : undefined;
  const selectedBrand = selectedMetadata ? brandInfo(selectedMetadata.make, selectedMetadata.model) : undefined;
  const selectedHasExif = selected ? Object.values(selected.autoMetadata).some(Boolean) : false;
  const editableElements = settings.filmMode ? (settings.filmCompact ? compactFilmElementIds : filmElementIds) : standardElementIds;
  const activeTransform = elementTransform(settings, activeElement);
  const activeEditableValue = editableValueForElement(activeElement, selected, settings);

  const outputLayout = useMemo(() => (selected ? getLayout(selected, settings, 1) : null), [selected, settings]);

  useEffect(() => {
    void preloadOfficialLogos().then(() => setLogosReady(true));
  }, []);

  useEffect(() => {
    const toggleCompactFilm = (event: KeyboardEvent) => {
      if (!settings.filmMode || !event.shiftKey || event.key.toLowerCase() !== "f") return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.matches("input, textarea, select")) return;
      event.preventDefault();
      setSettings((current) => ({ ...current, filmCompact: !current.filmCompact }));
      if (!compactFilmElementIds.includes(activeElement)) setActiveElement("cameraBrand");
    };
    window.addEventListener("keydown", toggleCompactFilm);
    return () => window.removeEventListener("keydown", toggleCompactFilm);
  }, [settings.filmMode, activeElement]);

  useEffect(() => {
    if (!selected || !previewRef.current) return;
    const frame = requestAnimationFrame(() => {
      try {
        const rendered = renderPhoto(selected, settings, 1600, true);
        const preview = previewRef.current;
        if (!preview) return;
        preview.width = rendered.canvas.width;
        preview.height = rendered.canvas.height;
        const context = preview.getContext("2d");
        elementBoundsRef.current = rendered.bounds;
        if (context) {
          context.drawImage(rendered.canvas, 0, 0);
          drawSelectionOverlay(context, rendered.bounds[activeElement]);
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "预览生成失败");
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, settings, logosReady, activeElement]);

  async function addFiles(fileList: FileList | File[]) {
    setError("");
    const candidates = Array.from(fileList).filter((file) => acceptedTypes.has(file.type) || /\.(jpe?g|png|webp|bmp)$/i.test(file.name));
    if (!candidates.length) {
      setError("请选择 JPEG、PNG、WebP 或 BMP 图片。相机原片建议使用 JPEG，以便读取完整 EXIF。 ");
      return;
    }
    setBusy(`正在读取 ${candidates.length} 张照片…`);
    const results = await Promise.allSettled(candidates.map(readPhoto));
    const loaded = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
      .map((photo) => ({
        ...photo,
        metadata: { ...photo.metadata, ...sharedMetadataOverridesRef.current.standard },
        filmMetadata: { ...photo.filmMetadata, ...sharedMetadataOverridesRef.current.film },
      }));
    if (loaded.length) {
      setPhotos((current) => [...current, ...loaded]);
      setSelectedId((current) => current || loaded[0].id);
      for (const photo of loaded) {
        if (!photo.coordinates) continue;
        void reverseGeocodeCity(photo.coordinates.latitude, photo.coordinates.longitude).then((city) => {
          setPhotos((current) => current.map((item) => item.id === photo.id ? {
            ...item,
            metadata: { ...item.metadata, location: sharedMetadataOverridesRef.current.standard.location || city },
            filmMetadata: { ...item.filmMetadata, location: sharedMetadataOverridesRef.current.film.location || city },
            autoMetadata: { ...item.autoMetadata, location: city },
          } : item));
        });
      }
    }
    const failed = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed.length) {
      const detail = failed.length === 1 && failed[0].reason instanceof Error ? `：${failed[0].reason.message}` : "";
      setError(`${failed.length} 张照片无法读取，已跳过${detail}`);
    }
    setBusy("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void addFiles(event.target.files);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
  }

  function removePhoto(id: string) {
    const target = photos.find((photo) => photo.id === id);
    if (target) URL.revokeObjectURL(target.url);
    const remaining = photos.filter((photo) => photo.id !== id);
    setPhotos(remaining);
    if (selectedId === id) setSelectedId(remaining[0]?.id || null);
  }

  function updateSharedMetadata(field: keyof PhotoMetadata, value: string) {
    const mode = settings.filmMode ? "film" : "standard";
    sharedMetadataOverridesRef.current[mode] = {
      ...sharedMetadataOverridesRef.current[mode],
      [field]: value,
    };
    setPhotos((current) => current.map((photo) => settings.filmMode
      ? { ...photo, filmMetadata: { ...photo.filmMetadata, [field]: value } }
      : { ...photo, metadata: { ...photo.metadata, [field]: value } }));
  }

  function resetSharedMetadata() {
    const mode = settings.filmMode ? "film" : "standard";
    sharedMetadataOverridesRef.current[mode] = {};
    setPhotos((current) => current.map((photo) => settings.filmMode
      ? { ...photo, filmMetadata: { ...defaultFilmMetadata } }
      : { ...photo, metadata: { ...photo.autoMetadata } }));
  }

  function updateElementTransform(element: ElementId, patch: Partial<ElementTransform>) {
    setSettings((current) => {
      const key = currentLayoutKey(current);
      const previous = current.transforms[key]?.[element] || defaultTransform;
      return {
        ...current,
        transforms: {
          ...current.transforms,
          [key]: {
            ...current.transforms[key],
            [element]: { ...previous, ...patch },
          },
        },
      };
    });
  }

  function resetActiveElement() {
    updateElementTransform(activeElement, defaultTransform);
  }

  function resetCurrentLayout() {
    setSettings((current) => {
      const key = currentLayoutKey(current);
      const nextTransforms = { ...current.transforms };
      delete nextTransforms[key];
      return { ...current, transforms: nextTransforms };
    });
  }

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement> | ReactMouseEvent<HTMLCanvasElement>) {
    const rectangle = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rectangle.left) * (event.currentTarget.width / Math.max(1, rectangle.width)),
      y: (event.clientY - rectangle.top) * (event.currentTarget.height / Math.max(1, rectangle.height)),
    };
  }

  function elementAtPoint(point: { x: number; y: number }) {
    return [...editableElements].reverse().find((element) => {
      const bounds = elementBoundsRef.current[element];
      return bounds && point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
    });
  }

  function updateActiveElementText(value: string) {
    if (["cameraModel", "lens", "aperture", "exposure", "iso", "focalLength", "date", "location"].includes(activeElement)) {
      const fieldMap: Record<string, keyof PhotoMetadata> = { cameraModel: "model", lens: "lens", aperture: "aperture", exposure: "exposure", iso: "iso", focalLength: "focalLength", date: "takenAt", location: "location" };
      updateSharedMetadata(fieldMap[activeElement], value);
      return;
    }
    if (activeElement === "signature") setSettings((current) => ({ ...current, signature: value }));
    if (activeElement === "filmName") setSettings((current) => ({ ...current, filmName: value }));
    if (activeElement === "lab") setSettings((current) => ({ ...current, labName: value }));
    if (activeElement === "scanner") setSettings((current) => ({ ...current, scannerName: value }));
  }

  function handleElementPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!selected) return;
    const point = canvasPoint(event);
    const activeBounds = elementBoundsRef.current[activeElement];
    const handleRadius = Math.max(12, event.currentTarget.width * 0.015);
    const resizeCorner = activeBounds ? ([
      ["nw", activeBounds.x, activeBounds.y],
      ["ne", activeBounds.x + activeBounds.width, activeBounds.y],
      ["sw", activeBounds.x, activeBounds.y + activeBounds.height],
      ["se", activeBounds.x + activeBounds.width, activeBounds.y + activeBounds.height],
    ] as const).find(([, x, y]) => Math.abs(point.x - x) <= handleRadius && Math.abs(point.y - y) <= handleRadius)?.[0] : undefined;
    const element = resizeCorner ? activeElement : elementAtPoint(point);
    if (!element) return;
    event.preventDefault();
    setActiveElement(element);
    event.currentTarget.setPointerCapture(event.pointerId);
    elementDragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      element,
      mode: resizeCorner ? "resize" : "move",
      resizeCorner,
      origin: { ...elementTransform(settings, element) },
    };
  }

  function handleElementPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = elementDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const width = Math.max(1, event.currentTarget.clientWidth);
    const height = Math.max(1, event.currentTarget.clientHeight);
    if (drag.mode === "resize") {
      const horizontalDirection = drag.resizeCorner?.includes("w") ? -1 : 1;
      const verticalDirection = drag.resizeCorner?.includes("n") ? -1 : 1;
      const delta = ((event.clientX - drag.clientX) / width) * horizontalDirection + ((event.clientY - drag.clientY) / height) * verticalDirection;
      const factor = Math.max(0.25, Math.min(4, 1 + delta * 1.8));
      updateElementTransform(drag.element, {
        scale: Math.max(0.35, Math.min(3, drag.origin.scale * factor)),
        fontScale: Math.max(0.35, Math.min(3, drag.origin.fontScale * factor)),
      });
    } else {
      const x = Math.max(-0.75, Math.min(0.75, drag.origin.x + (event.clientX - drag.clientX) / width));
      const y = Math.max(-0.75, Math.min(0.75, drag.origin.y + (event.clientY - drag.clientY) / height));
      updateElementTransform(drag.element, { x, y });
    }
  }

  function handleElementPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (elementDragRef.current?.pointerId !== event.pointerId) return;
    elementDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleElementDoubleClick(event: ReactMouseEvent<HTMLCanvasElement>) {
    const element = elementAtPoint(canvasPoint(event));
    if (!element) return;
    setActiveElement(element);
    requestAnimationFrame(() => elementEditorInputRef.current?.focus());
  }

  async function exportCurrent() {
    if (!selected) return;
    setError("");
    setBusy("正在生成原尺寸图片…");
    try {
      await preloadOfficialLogos();
      const canvas = renderPhoto(selected, settings).canvas;
      const blob = await canvasToBlob(canvas, settings.format);
      downloadBlob(blob, outputName(selected.file, settings.format));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导出失败");
    } finally {
      setBusy("");
    }
  }

  async function exportBatch() {
    if (!photos.length) return;
    setError("");
    setBusy(`正在生成 1 / ${photos.length}…`);
    try {
      await preloadOfficialLogos();
      const zip = new JSZip();
      for (let index = 0; index < photos.length; index += 1) {
        const photo = photos[index];
        setBusy(`正在生成 ${index + 1} / ${photos.length}…`);
        const canvas = renderPhoto(photo, settings).canvas;
        const blob = await canvasToBlob(canvas, settings.format);
        zip.file(outputName(photo.file, settings.format), blob);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      setBusy("正在打包…");
      const archive = await zip.generateAsync({ type: "blob", compression: "STORE" });
      downloadBlob(archive, "photon-frame-exports.zip");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "批量导出失败");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand-lockup" href="#top" aria-label="Photon Frame 首页">
          <span className="brand-glyph" aria-hidden="true"><i /><b /></span>
          <span><strong>Photon Frame</strong><small>光子水印</small></span>
        </a>
        <div className="privacy-note"><span aria-hidden="true">●</span> 本地处理 · 照片不会上传</div>
        <div className="topbar-actions">
          <label className={`top-film-switch ${settings.filmMode ? "active" : ""}`} title="切换普通 / 胶片信息布局">
            <input className="visually-hidden" type="checkbox" checked={settings.filmMode} onChange={(event) => { const enabled = event.target.checked; setSettings((current) => ({ ...current, filmMode: enabled })); if (!enabled && !standardElementIds.includes(activeElement)) setActiveElement("cameraBrand"); }} />
            <i aria-hidden="true" /><span>胶片模式</span>
          </label>
          {settings.filmMode && (
            <button
              className={`top-compact-toggle ${settings.filmCompact ? "active" : ""}`}
              type="button"
              title="只显示相机与胶卷信息（快捷键 Shift+F）"
              aria-pressed={settings.filmCompact}
              onClick={() => { setSettings((current) => ({ ...current, filmCompact: !current.filmCompact })); if (!compactFilmElementIds.includes(activeElement)) setActiveElement("cameraBrand"); }}
            >
              <span aria-hidden="true">≡</span> 精简一行 <kbd>⇧F</kbd>
            </button>
          )}
          <div className="top-format" role="group" aria-label="快捷选择导出格式">
            <button type="button" className={settings.format === "png" ? "active" : ""} onClick={() => setSettings((current) => ({ ...current, format: "png" }))}>PNG</button>
            <button type="button" className={settings.format === "jpeg" ? "active" : ""} onClick={() => setSettings((current) => ({ ...current, format: "jpeg" }))}>JPG</button>
          </div>
          <button className="top-export" type="button" disabled={!selected || Boolean(busy)} onClick={() => void exportCurrent()}>{busy || "导出当前"}</button>
          <button className="top-export batch" type="button" disabled={!photos.length || Boolean(busy)} onClick={() => void exportBatch()}>批量 ZIP <span>{photos.length || 0}</span></button>
          <button className="header-action" type="button" onClick={() => fileInputRef.current?.click()}>＋ 添加照片</button>
        </div>
      </header>
      {error && <p className="global-error" role="alert">{error}</p>}

      <section className="intro" id="top">
        <div>
          <p className="eyebrow">PHOTO SIGNATURE STUDIO</p>
          <h1>让参数成为照片的<br /><em>最后一笔。</em></h1>
        </div>
        <p className="intro-copy">自动读取相机、镜头、光圈、快门、ISO、焦距与拍摄时间。原图不缩放，导出完整分辨率。</p>
      </section>

      <input ref={fileInputRef} className="visually-hidden" type="file" multiple accept="image/jpeg,image/png,image/webp,image/bmp,image/x-bmp,image/x-ms-bmp,.jpg,.jpeg,.png,.webp,.bmp" onChange={handleInput} />

      <section className="studio" aria-label="水印工作台">
        <aside className="photo-rail">
          <div className="section-heading"><span>照片</span><small>{photos.length || "0"}</small></div>
          {photos.length ? (
            <div className="photo-list">
              {photos.map((photo, index) => (
                <div className={`photo-item ${selected?.id === photo.id ? "active" : ""}`} key={photo.id}>
                  <button className="photo-select" type="button" onClick={() => setSelectedId(photo.id)} aria-label={`选择 ${photo.file.name}`}>
                    {/* Blob URLs are local previews and intentionally bypass remote image optimization. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.url} alt="" />
                    <span><b>{String(index + 1).padStart(2, "0")}</b><small>{photo.metadata.model || photo.file.name}</small></span>
                  </button>
                  <button className="photo-remove" type="button" aria-label={`移除 ${photo.file.name}`} onClick={() => removePhoto(photo.id)}>×</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="rail-empty">添加照片后，可在这里快速切换并批量导出。</p>
          )}
          <button className="rail-add" type="button" onClick={() => fileInputRef.current?.click()}>＋ 添加更多照片</button>
        </aside>

        <div
          className={`preview-stage ${isDragging ? "dragging" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false); }}
          onDrop={handleDrop}
        >
          {selected ? (
            <>
              <div className="preview-toolbar">
                <span><b>{selected.file.name}</b><small>{selected.width} × {selected.height}</small></span>
                <span className={`exif-state ${selectedHasExif ? "" : "manual"}`}><i /> {selectedHasExif ? "EXIF 已读取" : "等待手动填写"}</span>
              </div>
              <div className="canvas-wrap">
                <canvas
                  ref={previewRef}
                  className="editable-canvas"
                  aria-label={`水印预览；拖动可移动${elementLabels[activeElement]}`}
                  title={`拖动以移动：${elementLabels[activeElement]}`}
                  onPointerDown={handleElementPointerDown}
                  onPointerMove={handleElementPointerMove}
                  onPointerUp={handleElementPointerUp}
                  onPointerCancel={handleElementPointerUp}
                  onDoubleClick={handleElementDoubleClick}
                />
              </div>
              <div className="dimension-bar">
                <span>原图 <b>{selected.width} × {selected.height}</b></span>
                <span className="dimension-arrow" aria-hidden="true">→</span>
                <span>导出 <b>{outputLayout?.width} × {outputLayout?.height}</b></span>
                <span className="lossless-mark">原像素保留</span>
              </div>
            </>
          ) : (
            <button className="drop-zone" type="button" onClick={() => fileInputRef.current?.click()}>
              <span className="drop-visual" aria-hidden="true"><i /><b>＋</b></span>
              <strong>拖入你的照片</strong>
              <small>或点击选择 JPEG / PNG / WebP</small>
              <em>相机 JPEG 可读取最完整的拍摄参数</em>
            </button>
          )}
          {isDragging && <div className="drop-overlay">松开即可读取照片</div>}
        </div>

        <aside className="preset-rail" aria-label="水印样式">
          <div className="section-heading"><span>水印样式</span><small>{String(presets.findIndex((preset) => preset.id === settings.preset) + 1).padStart(2, "0")}</small></div>
          <div className="preset-grid">
            {presets.map((preset) => (
              <button
                type="button"
                key={preset.id}
                className={`preset-card ${settings.preset === preset.id ? "active" : ""}`}
                onClick={() => setSettings((current) => ({ ...current, preset: preset.id }))}
              >
                <span className={`preset-swatch ${preset.swatch}`}><i /><b /></span>
                <span><strong>{preset.name}</strong><small>{preset.note}</small></span>
                {settings.preset === preset.id && <em aria-label="已选择">✓</em>}
              </button>
            ))}
          </div>
        </aside>

        <aside className="control-panel">
          <div className="control-scroll">
            <section className="control-group style-controls" aria-label="样式与显示设置">
            <div className="section-heading"><span>内容与尺寸</span><small>02</small></div>
            <label className="field-label" htmlFor="signature">签名</label>
            <div className="text-field"><span>by</span><input id="signature" value={settings.signature} maxLength={30} disabled={settings.filmMode ? !settings.filmShowSignature : !settings.showSignature} onChange={(event) => setSettings((current) => ({ ...current, signature: event.target.value }))} /></div>

            <div className="range-heading"><label htmlFor="band-size">{settings.filmMode ? "胶片铭牌高度" : "铭牌高度"}</label><output>{(settings.filmMode ? settings.filmBandSize : settings.bandSize).toFixed(1)}%</output></div>
            <input id="band-size" className="range" type="range" min="10" max="36" step="0.1" value={settings.filmMode ? settings.filmBandSize : settings.bandSize} onChange={(event) => { const value = Number(event.target.value); setSettings((current) => current.filmMode ? { ...current, filmBandSize: value } : { ...current, bandSize: value }); }} />

            <div className="toggle-list">
              <label><span><b>显示签名</b><small>在右侧显示 by + 签名</small></span><input type="checkbox" checked={settings.filmMode ? settings.filmShowSignature : settings.showSignature} onChange={(event) => { const checked = event.target.checked; setSettings((current) => current.filmMode ? { ...current, filmShowSignature: checked } : { ...current, showSignature: checked }); }} /><i /></label>
              <label><span><b>厂商品牌</b><small>根据 EXIF 自动识别</small></span><input type="checkbox" checked={settings.filmMode ? settings.filmShowBrand : settings.showBrand} onChange={(event) => { const checked = event.target.checked; setSettings((current) => current.filmMode ? { ...current, filmShowBrand: checked } : { ...current, showBrand: checked }); }} /><i /></label>
              <label><span><b>相机型号</b><small>单独控制机型文字</small></span><input type="checkbox" checked={settings.filmMode ? settings.filmShowModel : settings.showModel} onChange={(event) => { const checked = event.target.checked; setSettings((current) => current.filmMode ? { ...current, filmShowModel: checked } : { ...current, showModel: checked }); }} /><i /></label>
              <label><span><b>焦距</b><small>胶片模式默认关闭</small></span><input type="checkbox" checked={settings.filmMode ? settings.filmShowFocalLength : settings.showFocalLength} onChange={(event) => { const checked = event.target.checked; setSettings((current) => current.filmMode ? { ...current, filmShowFocalLength: checked } : { ...current, showFocalLength: checked }); }} /><i /></label>
              <label><span><b>ISO</b><small>感光度参数</small></span><input type="checkbox" checked={settings.filmMode ? settings.filmShowIso : settings.showIso} onChange={(event) => { const checked = event.target.checked; setSettings((current) => current.filmMode ? { ...current, filmShowIso: checked } : { ...current, showIso: checked }); }} /><i /></label>
              <label><span><b>光圈</b><small>胶片模式默认关闭</small></span><input type="checkbox" checked={settings.filmMode ? settings.filmShowAperture : settings.showAperture} onChange={(event) => { const checked = event.target.checked; setSettings((current) => current.filmMode ? { ...current, filmShowAperture: checked } : { ...current, showAperture: checked }); }} /><i /></label>
              <label><span><b>快门</b><small>胶片模式默认关闭</small></span><input type="checkbox" checked={settings.filmMode ? settings.filmShowExposure : settings.showExposure} onChange={(event) => { const checked = event.target.checked; setSettings((current) => current.filmMode ? { ...current, filmShowExposure: checked } : { ...current, showExposure: checked }); }} /><i /></label>
              <label><span><b>拍摄日期</b><small>胶片模式默认关闭</small></span><input type="checkbox" checked={settings.filmMode ? settings.filmShowDate : settings.showDate} onChange={(event) => { const checked = event.target.checked; setSettings((current) => current.filmMode ? { ...current, filmShowDate: checked } : { ...current, showDate: checked }); }} /><i /></label>
              <label><span><b>拍摄地点</b><small>GPS 自动识别，也可手动填写</small></span><input type="checkbox" checked={locationVisible(settings)} onChange={(event) => { const checked = event.target.checked; setSettings((current) => ({ ...current, showLocationByPreset: { ...current.showLocationByPreset, [current.preset]: checked } })); }} /><i /></label>
              <label><span><b>镜头信息</b><small>镜头型号与规格</small></span><input type="checkbox" checked={settings.filmMode ? settings.filmShowLens : settings.showLens} onChange={(event) => { const checked = event.target.checked; setSettings((current) => current.filmMode ? { ...current, filmShowLens: checked } : { ...current, showLens: checked }); }} /><i /></label>
            </div>

            {settings.filmMode && (
              <div className="film-settings">
                <div className="metadata-editor-head"><span><b>胶片工作流</b><small>每一项都可单独隐藏并自由排版</small></span></div>
                <div className="toggle-list compact">
                  <label><span><b>胶卷厂商 Logo</b></span><input type="checkbox" checked={settings.showFilmBrand} onChange={(event) => setSettings((current) => ({ ...current, showFilmBrand: event.target.checked }))} /><i /></label>
                  <label><span><b>胶卷名称</b></span><input type="checkbox" checked={settings.showFilmName} onChange={(event) => setSettings((current) => ({ ...current, showFilmName: event.target.checked }))} /><i /></label>
                  <label><span><b>冲洗店名称</b></span><input type="checkbox" disabled={settings.filmCompact} checked={settings.showLab} onChange={(event) => setSettings((current) => ({ ...current, showLab: event.target.checked }))} /><i /></label>
                  <label><span><b>扫描仪 Logo 与名称</b></span><input type="checkbox" disabled={settings.filmCompact} checked={settings.showScanner} onChange={(event) => setSettings((current) => ({ ...current, showScanner: event.target.checked }))} /><i /></label>
                </div>
                <div className="film-form-grid">
                  <label className="metadata-field"><span>胶卷厂商</span><select value={settings.filmBrand} onChange={(event) => setSettings((current) => ({ ...current, filmBrand: event.target.value }))}>{filmBrands.map((brand) => <option key={brand.value} value={brand.value}>{brand.label}</option>)}</select></label>
                  <label className="metadata-field"><span>胶卷名称</span><input value={settings.filmName} placeholder="例如 PORTRA 400" onChange={(event) => setSettings((current) => ({ ...current, filmName: event.target.value }))} /></label>
                  <label className="metadata-field"><span>冲洗店名称</span><input disabled={settings.filmCompact} value={settings.labName} placeholder="完全自定义" onChange={(event) => setSettings((current) => ({ ...current, labName: event.target.value }))} /></label>
                  <label className="metadata-field"><span>扫描仪厂商</span><select disabled={settings.filmCompact} value={settings.scannerBrand} onChange={(event) => setSettings((current) => ({ ...current, scannerBrand: event.target.value }))}>{scannerBrands.map((brand) => <option key={brand.value} value={brand.value}>{brand.label}</option>)}</select></label>
                  <label className="metadata-field full"><span>扫描仪型号</span><input disabled={settings.filmCompact} value={settings.scannerName} placeholder="例如 HS-1800 / SP-3000" onChange={(event) => setSettings((current) => ({ ...current, scannerName: event.target.value }))} /></label>
                </div>
              </div>
            )}
            </section>

            {selected && (
              <section className="control-group metadata-controls" aria-label="批量照片参数">
              <div className="metadata-editor">
                <div className="metadata-editor-head">
                  <span><b>批量照片参数</b><small>修改后同步应用到全部 {photos.length} 张照片及后续新增照片</small></span>
                  <button type="button" onClick={resetSharedMetadata}>{settings.filmMode ? "恢复胶片默认值" : "恢复自动识别"}</button>
                </div>

                <div className="brand-editor">
                  <div className={`brand-logo-preview ${selectedBrand?.monochrome ? "monochrome" : ""}`}>
                    {selectedBrand?.asset ? (
                      // Official local brand assets intentionally use a plain image element.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`brands/${selectedBrand.asset}`} alt={`${selectedBrand.label} 官方 Logo`} />
                    ) : <span>{selectedBrand?.label || "CAMERA"}</span>}
                  </div>
                  <label>
                    <span>厂商选择</span>
                    <select
                      value={brands.some((brand) => brand.value === selectedBrand?.value) ? selectedBrand?.value : "__custom__"}
                      onChange={(event) => updateSharedMetadata("make", event.target.value === "__custom__" ? "" : event.target.value)}
                    >
                      {brands.map((brand) => <option key={brand.value} value={brand.value}>{brand.label}</option>)}
                      <option value="__custom__">其他 / 自定义</option>
                    </select>
                  </label>
                </div>

                <label className="metadata-field full">
                  <span>厂商名称</span>
                  <input value={selectedMetadata?.make || ""} placeholder="例如 Canon" onChange={(event) => updateSharedMetadata("make", event.target.value)} />
                </label>
                <label className="metadata-field full">
                  <span>相机型号</span>
                  <input value={selectedMetadata?.model || ""} placeholder="例如 Canon EOS 700D" onChange={(event) => updateSharedMetadata("model", event.target.value)} />
                </label>
                <label className="metadata-field full">
                  <span>镜头信息</span>
                  <input value={selectedMetadata?.lens || ""} placeholder="例如 EF-S18-135mm f/3.5-5.6 IS STM" onChange={(event) => updateSharedMetadata("lens", event.target.value)} />
                </label>
                <div className="metadata-grid">
                  <label className="metadata-field"><span>光圈</span><input value={selectedMetadata?.aperture || ""} placeholder="5.6" onChange={(event) => updateSharedMetadata("aperture", event.target.value)} /></label>
                  <label className="metadata-field"><span>快门</span><input value={selectedMetadata?.exposure || ""} placeholder="1/125" onChange={(event) => updateSharedMetadata("exposure", event.target.value)} /></label>
                  <label className="metadata-field"><span>ISO</span><input value={selectedMetadata?.iso || ""} placeholder="100" onChange={(event) => updateSharedMetadata("iso", event.target.value)} /></label>
                  <label className="metadata-field"><span>焦距 (mm)</span><input value={selectedMetadata?.focalLength || ""} placeholder="59" onChange={(event) => updateSharedMetadata("focalLength", event.target.value)} /></label>
                </div>
                <label className="metadata-field full">
                  <span>拍摄日期与时间</span>
                  <input type="datetime-local" value={selectedMetadata?.takenAt || ""} onChange={(event) => updateSharedMetadata("takenAt", event.target.value)} />
                </label>
                <label className="metadata-field full">
                  <span>拍摄地点</span>
                  <input value={selectedMetadata?.location || ""} placeholder="地点 / 城市名称" onChange={(event) => updateSharedMetadata("location", event.target.value)} />
                </label>
                <p className="trademark-note">有 GPS 时会把坐标发送给 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> 识别城市，照片本身不会上传；结果可以随时手动修改。</p>
                <p className="trademark-note">Logo 来自厂商官网，商标权归各厂商所有；没有内置图标的品牌会显示厂商名称。</p>
              </div>
              </section>
            )}

            <section className="control-group layout-controls" aria-label="元素布局与导出设置">
            <div className="section-heading sub"><span>元素位置与大小</span><small>03</small></div>
            <div className="element-editor">
              <label className="metadata-field full"><span>当前编辑元素</span><select value={activeElement} onChange={(event) => setActiveElement(event.target.value as ElementId)}>{editableElements.map((element) => <option key={element} value={element}>{elementLabels[element]}</option>)}</select></label>
              {activeEditableValue !== undefined && <label className="metadata-field full"><span>直接编辑内容</span><input ref={elementEditorInputRef} type={activeElement === "date" ? "datetime-local" : "text"} value={activeEditableValue} onChange={(event) => updateActiveElementText(event.target.value)} /></label>}
              <p>像 PPT 一样直接点击预览中的元素：拖动边框内部可移动，拖动右下角手柄可整体缩放，双击文字可立即编辑。下方滑杆用于精确调整。</p>
              <div className="element-range"><label htmlFor="element-x">水平位置</label><output>{Math.round(activeTransform.x * 100)}%</output><input id="element-x" type="range" min="-60" max="60" value={Math.round(activeTransform.x * 100)} onChange={(event) => updateElementTransform(activeElement, { x: Number(event.target.value) / 100 })} /></div>
              <div className="element-range"><label htmlFor="element-y">垂直位置</label><output>{Math.round(activeTransform.y * 100)}%</output><input id="element-y" type="range" min="-60" max="60" value={Math.round(activeTransform.y * 100)} onChange={(event) => updateElementTransform(activeElement, { y: Number(event.target.value) / 100 })} /></div>
              <div className="element-range"><label htmlFor="element-scale">元素大小</label><output>{Math.round(activeTransform.scale * 100)}%</output><input id="element-scale" type="range" min="35" max="250" value={Math.round(activeTransform.scale * 100)} onChange={(event) => updateElementTransform(activeElement, { scale: Number(event.target.value) / 100 })} /></div>
              <div className="element-range"><label htmlFor="element-font">字体大小</label><output>{Math.round(activeTransform.fontScale * 100)}%</output><input id="element-font" type="range" min="35" max="250" value={Math.round(activeTransform.fontScale * 100)} onChange={(event) => updateElementTransform(activeElement, { fontScale: Number(event.target.value) / 100 })} /></div>
              <div className="element-actions"><button type="button" onClick={resetActiveElement}>重置当前元素</button><button type="button" onClick={resetCurrentLayout}>重置当前预设布局</button></div>
            </div>

            <div className="section-heading sub"><span>导出格式</span><small>04</small></div>
            <div className="format-tabs" role="group" aria-label="导出格式">
              <button type="button" className={settings.format === "png" ? "active" : ""} onClick={() => setSettings((current) => ({ ...current, format: "png" }))}>PNG <small>无损</small></button>
              <button type="button" className={settings.format === "jpeg" ? "active" : ""} onClick={() => setSettings((current) => ({ ...current, format: "jpeg" }))}>JPEG <small>100%</small></button>
            </div>
            </section>
          </div>

        </aside>
      </section>

      <footer><span>PHOTON FRAME · 2026</span><p>你的照片，只在你的浏览器里完成。</p><a href="#top">回到顶部 ↑</a></footer>
    </main>
  );
}
