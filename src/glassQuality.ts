/**
 * Liquid Glass quality policy.
 * Full is the default visual intent. Only measurable device capabilities,
 * accessibility preferences or unsupported WebView features reduce cost.
 * No user preferences or device identifiers are persisted.
 */
import { platform } from "./api";

export type GlassQuality = "full" | "low";

type MemoryNavigator = Navigator & { deviceMemory?: number };

const media = [
  "(prefers-reduced-transparency: reduce)",
  "(prefers-contrast: more)",
  "(forced-colors: active)",
] as const;

export function resolveGlassQuality(options: {
  supportsBlur: boolean;
  reduceTransparency: boolean;
  highContrast: boolean;
  forcedColors: boolean;
  memoryGB?: number;
  logicalCores?: number;
}): GlassQuality {
  if (!options.supportsBlur || options.reduceTransparency || options.highContrast || options.forcedColors) return "low";
  // Small shared-memory WebViews are particularly sensitive to simultaneous
  // video decoding + multi-layer backdrop compositing.
  if (options.memoryGB !== undefined && options.memoryGB <= 2) return "low";
  if (options.logicalCores !== undefined && options.logicalCores <= 2) return "low";
  return "full";
}

export function installGlassQuality(): () => void {
  const root = document.documentElement;
  root.dataset.glassPlatform = platform;
  const queries = media.map(query => window.matchMedia(query));
  const supportsBlur = typeof CSS !== "undefined" && (
    CSS.supports("backdrop-filter", "blur(1px)") ||
    CSS.supports("-webkit-backdrop-filter", "blur(1px)")
  );
  const update = () => {
    const nav = navigator as MemoryNavigator;
    root.dataset.glassQuality = resolveGlassQuality({
      supportsBlur,
      reduceTransparency: queries[0].matches,
      highContrast: queries[1].matches,
      forcedColors: queries[2].matches,
      memoryGB: nav.deviceMemory,
      logicalCores: nav.hardwareConcurrency,
    });
  };
  update();
  for (const query of queries) query.addEventListener("change", update);
  return () => {
    for (const query of queries) query.removeEventListener("change", update);
  };
}
