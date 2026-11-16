/**
 * 设计分支的毛玻璃分级。视频上方不叠实时模糊，只让底栏和面板在低配机上改纯色。
 * 偏好存在本机，不记录硬件标识。
 */
import { EXTRA_STORAGE_KEYS } from "./storage";

export type GlassPlatform = "android" | "ios" | "windows" | "macos" | "linux";
export type GlassQuality = "full" | "low";
export type GlassPreference = "auto" | "full" | "low";

type MemoryNavigator = Navigator & { deviceMemory?: number };
const STORAGE_KEY = EXTRA_STORAGE_KEYS.glassPreference;
export const GLASS_PREFERENCE_EVENT = "hguox:glass-preference";
export const GLASS_QUALITY_EVENT = "hguox:glass-quality";

const media = [
  "(prefers-reduced-transparency: reduce)",
  "(prefers-contrast: more)",
  "(forced-colors: active)",
] as const;

export function getGlassPreference(): GlassPreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "full" || saved === "low" ? saved : "auto";
  } catch {
    return "auto";
  }
}

export function setGlassPreference(preference: GlassPreference): void {
  try {
    if (preference === "auto") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch { /* 继续用安全默认值 */ }
  window.dispatchEvent(new Event(GLASS_PREFERENCE_EVENT));
}

export function resolveGlassQuality(options: {
  supportsBlur: boolean;
  reduceTransparency: boolean;
  highContrast: boolean;
  forcedColors: boolean;
  memoryGB?: number;
  logicalCores?: number;
  preference?: GlassPreference;
}): GlassQuality {
  if (!options.supportsBlur || options.reduceTransparency || options.highContrast || options.forcedColors) return "low";
  if (options.preference === "low") return "low";
  if (options.preference === "full") return "full";
  if (options.memoryGB !== undefined && options.memoryGB <= 2) return "low";
  if (options.logicalCores !== undefined && options.logicalCores <= 2) return "low";
  return "full";
}

export function installGlassQuality(platform: GlassPlatform): () => void {
  const root = document.documentElement;
  root.dataset.glassPlatform = platform;
  const queries = media.map(query => window.matchMedia(query));
  const supportsBlur = typeof CSS !== "undefined" && (
    CSS.supports("backdrop-filter", "blur(1px)") ||
    CSS.supports("-webkit-backdrop-filter", "blur(1px)")
  );
  const update = () => {
    const nav = navigator as MemoryNavigator;
    const next = resolveGlassQuality({
      supportsBlur,
      reduceTransparency: queries[0].matches,
      highContrast: queries[1].matches,
      forcedColors: queries[2].matches,
      memoryGB: nav.deviceMemory,
      logicalCores: nav.hardwareConcurrency,
      preference: getGlassPreference(),
    });
    if (root.dataset.glassQuality !== next) {
      root.dataset.glassQuality = next;
      window.dispatchEvent(new Event(GLASS_QUALITY_EVENT));
    }
  };
  update();
  for (const query of queries) {
    if (typeof query.addEventListener === "function") query.addEventListener("change", update);
    else query.addListener(update);
  }
  window.addEventListener(GLASS_PREFERENCE_EVENT, update);
  return () => {
    for (const query of queries) {
      if (typeof query.removeEventListener === "function") query.removeEventListener("change", update);
      else query.removeListener(update);
    }
    window.removeEventListener(GLASS_PREFERENCE_EVENT, update);
  };
}
