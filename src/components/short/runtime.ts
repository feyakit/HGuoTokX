import { invoke } from "@tauri-apps/api/core";

export type NetProfile = { name: "wifi" | "cellular" | "save"; buffer: number; preloadNext: boolean; prefetchAhead: boolean };

type Connection = { saveData?: boolean; effectiveType?: string; type?: string };

/** 读不到网络类型时按 Wi-Fi 处理：预加载比黑屏划过去代价更小。 */
export function networkProfile(): NetProfile {
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  if (connection?.saveData) return { name: "save", buffer: 10, preloadNext: false, prefetchAhead: false };
  const cellular = connection?.type === "cellular" || connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g" || connection?.effectiveType === "3g";
  if (cellular) return { name: "cellular", buffer: 15, preloadNext: true, prefetchAhead: false };
  return { name: "wifi", buffer: 30, preloadNext: true, prefetchAhead: true };
}

export function haptic(kind: "tick" | "hold" | "like" | "edge") {
  const pattern = kind === "edge" ? [10, 40, 10] : kind === "hold" ? 25 : kind === "like" ? 16 : 10;
  try { navigator.vibrate?.(pattern); } catch { /* 浏览器拒绝振动时静默 */ }
  const duration = Array.isArray(pattern) ? pattern[0] : pattern;
  void invoke("plugin:haptics|vibrate", { duration }).catch(() => {});
}

export function mediaKey(id: number, ep: number) {
  return `${id}:${ep}`;
}
