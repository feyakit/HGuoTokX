/**
 * 背景基调：**纯黑（抖音式）**。
 *
 * 用户定了「直接和抖音一样黑的吧」（2026-11-20）：大面积背景不再跟着封面取色，
 * 所以 `useAccent()` 现在固定返回 `BLACK_SCHEME`（source = "fallback"）。
 *
 * **取色能力保留**（`accent.ts` 里的 `schemeFromPixels` / 读写缓存、本文件的
 * `extractAccent` / `sample` / `loadImage` 一行没删）：将来要做「动态取色」开关时
 * 直接把它们接回来即可。因此这些导出在 linter 里可能显示为未使用，属于有意保留。
 *
 * 强调色（按钮/进度条/选中态）仍是品牌紫 —— 抖音也是黑底 + 少量品牌色，
 * 只把**大面积背景**变黑，不是把所有颜色都压掉。
 */
import { useEffect, useState, type CSSProperties } from "react";
import { FALLBACK_SCHEME, readAccentCache, schemeFromPixels, writeAccentCache, type AccentScheme } from "./accent";
import { EXTRA_STORAGE_KEYS } from "./storage";

const AMBIENT_KEY = EXTRA_STORAGE_KEYS.lastAccent;

type AccentDebug = AccentScheme & { id?: string | number; url?: string };

function sample(source: CanvasImageSource, width: number, height: number): AccentScheme {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 57;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(source, 0, 0, width, height, 0, 0, 32, 57);
  return schemeFromPixels(ctx.getImageData(0, 0, 32, 57).data);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image"));
    image.src = url;
  });
}

/**
 * 先把封面拉成 blob 再画到 canvas。
 * 直接画跨域 <img>（hg.localhost / 远程封面）会污染画布，getImageData 抛错后只能退回品牌紫，
 * 页面上看起来就像没取到色。blob 是同源的，不受 CORS 污染。
 */
async function extractFromBlob(url: string): Promise<AccentScheme> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`http ${response.status}`);
  const blob = await response.blob();
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(blob);
    try { return sample(bitmap, bitmap.width, bitmap.height); }
    finally { bitmap.close(); }
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(objectUrl);
    return sample(image, image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function extractAccent(url: string): Promise<AccentScheme> {
  try {
    return await extractFromBlob(url);
  } catch (error) {
    console.warn("[accent] blob 取色失败，改走图片", error instanceof Error ? error.message : error);
    const image = await loadImage(url);
    return sample(image, image.naturalWidth, image.naturalHeight);
  }
}

function publishAccent(id: string | number, url: string, scheme: AccentScheme) {
  const detail: AccentDebug = { ...scheme, id, url };
  (window as unknown as { __HGUOX_ACCENT__?: AccentDebug }).__HGUOX_ACCENT__ = detail;
  document.documentElement.dataset.accent = scheme.accent;
  document.documentElement.dataset.accentSource = scheme.source;
  console.info("[accent]", scheme.source, scheme.accent, String(id), url.slice(0, 96));
  if (scheme.source !== "image") return;
  try { localStorage.setItem(AMBIENT_KEY, JSON.stringify(scheme)); } catch { /* 隐私模式不挡本次上色 */ }
  window.dispatchEvent(new CustomEvent("hg:accent", { detail: scheme }));
}

export function readAmbient(): AccentScheme {
  try {
    const raw = localStorage.getItem(AMBIENT_KEY);
    if (!raw) return FALLBACK_SCHEME;
    const parsed = JSON.parse(raw) as AccentScheme;
    if (!parsed?.accent || parsed.source !== "image") return FALLBACK_SCHEME;
    return parsed;
  } catch {
    return FALLBACK_SCHEME;
  }
}

/** 纯黑背景方案：背景黑，强调色保留品牌紫（控件、进度条、选中态照旧看得见）。 */
export const BLACK_SCHEME: AccentScheme = {
  accent: "#7C5CFF",
  second: "#3B82F6",
  deep: "#000000",
  tag: "#1C1C1E",
  source: "fallback",
  luma: 0,
};

/** 剧场 / 追剧 / 我的跟最近一次成功取色，没有封面时也不是一块纯黑。 */
export function useAmbient(): AccentScheme {
  const [scheme, setScheme] = useState<AccentScheme>(readAmbient);
  useEffect(() => {
    const onAccent = (event: Event) => setScheme((event as CustomEvent<AccentScheme>).detail);
    window.addEventListener("hg:accent", onAccent);
    return () => window.removeEventListener("hg:accent", onAccent);
  }, []);
  return scheme;
}

/**
 * 氛围底样式：**只输出纯黑背景 + 品牌强调色**。
 * `--ambient` 交给纯黑（原来的径向渐变就是拿它上色的），`--accent*` 仍给按钮/进度条。
 */
export function ambientStyle(scheme: AccentScheme): CSSProperties {
  return {
    ["--ambient" as string]: "#000000",
    ["--accent" as string]: scheme.accent,
    ["--accent-2" as string]: scheme.second,
    ["--deep" as string]: "#000000",
    ["--tag" as string]: scheme.tag,
    background: "#000000",
  };
}

/** 先读缓存。取色失败才退回品牌紫，慢一点的封面不再被 150ms 超时盖成紫色。 */
export function useAccent(id: number | string | null | undefined, url?: string): AccentScheme {
  /* 背景固定纯黑：不再读缓存、不再采样封面（id/url 只保留给调用点签名兼容，
     将来做开关时把下面这段换回取色逻辑即可）。 */
  useEffect(() => {
    if (id == null) return;
    publishAccent(id, url ?? "", BLACK_SCHEME);
  }, [id, url]);
  return BLACK_SCHEME;
}
