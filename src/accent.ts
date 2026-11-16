/** 封面取色。32×57 的直方图在主线程就够，不必再开 Worker。 */

export type RGB = { r: number; g: number; b: number };
export type HSL = { h: number; s: number; l: number };

export type AccentScheme = {
  accent: string;
  second: string;
  deep: string;
  tag: string;
  source: "image" | "fallback";
};

export const ACCENT_BG = "#0E0F13";
export const FALLBACK_SCHEME: AccentScheme = {
  accent: "#7977FF",
  second: "#C877FF",
  deep: "#100F2E",
  tag: "#262647",
  source: "fallback",
};

const CACHE_KEY = "hghubx_accent_cache_v1";
const CACHE_MAX = 300;
const memory = new Map<string, AccentScheme>();

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

function channel(v: number) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(rgb: RGB) {
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrast(a: RGB, b: RGB) {
  const L1 = luminance(a), L2 = luminance(b);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

export function toHex({ r, g, b }: RGB) {
  return `#${[r, g, b].map(n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function parseHex(hex: string): RGB {
  const n = hex.replace("#", "");
  return { r: parseInt(n.slice(0, 2), 16), g: parseInt(n.slice(2, 4), 16), b: parseInt(n.slice(4, 6), 16) };
}

function mix(base: RGB, tint: RGB, amount: number): RGB {
  return {
    r: Math.round(base.r * (1 - amount) + tint.r * amount),
    g: Math.round(base.g * (1 - amount) + tint.g * amount),
    b: Math.round(base.b * (1 - amount) + tint.b * amount),
  };
}

function hueDelta(a: number, b: number) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** 把强调色抬到能压住深底的亮度，图形色用更低的对比门槛。 */
export function clampAccent(hsl: HSL, minContrast: number): RGB {
  const bg = parseHex(ACCENT_BG);
  let { h, s, l } = hsl;
  s = clamp(s, 0.45, 0.8);
  l = clamp(l, 0.58, 0.72);
  let rgb = hslToRgb(h, s, l);
  let guard = 0;
  while (contrast(rgb, bg) < minContrast && l < 0.86 && guard < 8) {
    l = Math.min(0.86, l + 0.04);
    rgb = hslToRgb(h, s, l);
    guard += 1;
  }
  return rgb;
}

type Bucket = { h: number; s: number; l: number; weight: number; count: number };

/** 从 RGBA 像素里取出一套能直接上屏的颜色。像素太灰或太少时回退品牌紫。 */
export function schemeFromPixels(data: Uint8ClampedArray): AccentScheme {
  const buckets: Bucket[] = Array.from({ length: 36 }, () => ({ h: 0, s: 0, l: 0, weight: 0, count: 0 }));
  const pixels = data.length / 4;
  let valid = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 200) continue;
    const hsl = rgbToHsl({ r: data[i], g: data[i + 1], b: data[i + 2] });
    if (hsl.l < 0.12 || hsl.l > 0.92 || hsl.s < 0.18) continue;
    const weight = hsl.s * (1 - Math.abs(hsl.l - 0.5) * 1.2);
    if (weight <= 0) continue;
    const index = Math.min(35, Math.floor(hsl.h / 10));
    const bucket = buckets[index];
    bucket.h += hsl.h * weight;
    bucket.s += hsl.s * weight;
    bucket.l += hsl.l * weight;
    bucket.weight += weight;
    bucket.count += 1;
    valid += 1;
  }
  if (pixels === 0 || valid / pixels < 0.08) return FALLBACK_SCHEME;
  const ranked = buckets.filter(b => b.weight > 0).sort((a, b) => b.weight - a.weight);
  if (!ranked.length) return FALLBACK_SCHEME;
  const primary = ranked[0];
  const main: HSL = { h: primary.h / primary.weight, s: primary.s / primary.weight, l: primary.l / primary.weight };
  const accent = clampAccent(main, 4.5);
  const secondBucket = ranked.find(b => hueDelta(b.h / b.weight, main.h) >= 40);
  const secondHsl: HSL = secondBucket
    ? { h: secondBucket.h / secondBucket.weight, s: secondBucket.s / secondBucket.weight, l: secondBucket.l / secondBucket.weight }
    : { h: main.h + 35, s: main.s, l: main.l };
  const second = clampAccent(secondHsl, 3);
  const deep = hslToRgb(main.h, clamp(main.s, 0.35, 0.7), 0.12);
  const tag = mix(parseHex(ACCENT_BG), accent, 0.22);
  return { accent: toHex(accent), second: toHex(second), deep: toHex(deep), tag: toHex(tag), source: "image" };
}

export function readAccentCache(id: string): AccentScheme | null {
  const hit = memory.get(id);
  if (hit) return hit;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const rows = JSON.parse(raw) as { id: string; scheme: AccentScheme }[];
    const found = rows.find(row => row.id === id);
    if (!found) return null;
    memory.set(id, found.scheme);
    return found.scheme;
  } catch {
    return null;
  }
}

export function writeAccentCache(id: string, scheme: AccentScheme) {
  memory.set(id, scheme);
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const rows = (raw ? JSON.parse(raw) : []) as { id: string; scheme: AccentScheme }[];
    const next = [{ id, scheme }, ...rows.filter(row => row.id !== id)].slice(0, CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch { /* 隐私模式写不进缓存也不影响本次取色 */ }
}

/** 固定 3 个槽位轮换：还在窗口里的条目留在原槽，避免 video 被卸载重建。 */
export function assignSlots(previous: string[], wanted: string[]): string[] {
  const next = previous.map(key => wanted.includes(key) ? key : "");
  const used = new Set(next.filter(Boolean));
  for (const key of wanted) {
    if (!key || used.has(key)) continue;
    const free = next.findIndex(slot => !slot);
    if (free >= 0) {
      next[free] = key;
      used.add(key);
    }
  }
  return next;
}
