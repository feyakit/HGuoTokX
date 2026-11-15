/**
 * Runtime Liquid Glass policy for Tauri WebViews.
 *
 * Auto uses full glass on capable devices. Explicit "full" may override the
 * hardware heuristic, but NEVER unsupported blur or OS accessibility settings.
 * Settings are local to this installation; no hardware identifiers are stored.
 */
export type GlassPlatform = "android" | "ios" | "windows" | "macos" | "linux";
export type GlassQuality = "full" | "low";
export type GlassPreference = "auto" | "full" | "low";

type MemoryNavigator = Navigator & { deviceMemory?: number };
const STORAGE_KEY = "hguox_glass_preference_v1";
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
    // Storage may be disabled in private or embedded WebViews.
    return "auto";
  }
}

export function setGlassPreference(preference: GlassPreference): void {
  try {
    if (preference === "auto") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Continue using safe defaults without crashing settings.
  }
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
  // Auto degrades on small WebViews where video decoding competes with
  // multi-layer backdrop compositing.
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
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      update();
      window.dispatchEvent(new Event(GLASS_PREFERENCE_EVENT));
    }
  };
  update();
  // WebKitGTK and older Apple WebViews also support legacy listeners.
  for (const query of queries) {
    if (typeof query.addEventListener === "function") query.addEventListener("change", update);
    else query.addListener(update);
  }
  window.addEventListener(GLASS_PREFERENCE_EVENT, update);
  window.addEventListener("storage", onStorage);
  return () => {
    for (const query of queries) {
      if (typeof query.removeEventListener === "function") query.removeEventListener("change", update);
      else query.removeListener(update);
    }
    window.removeEventListener(GLASS_PREFERENCE_EVENT, update);
    window.removeEventListener("storage", onStorage);
  };
}
