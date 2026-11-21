import { useEffect, useState, type CSSProperties } from "react";
import { FALLBACK_SCHEME, readAccentCache, schemeFromPixels, writeAccentCache, type AccentScheme } from "./accent";
import { EXTRA_STORAGE_KEYS } from "../storage/storage";

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

export function ambientStyle(scheme: AccentScheme): CSSProperties {
  return {
    ["--ambient" as string]: scheme.accent,
    ["--accent" as string]: scheme.accent,
    ["--accent-2" as string]: scheme.second,
    ["--deep" as string]: scheme.deep,
    ["--tag" as string]: scheme.tag,
  };
}

/** 先读缓存。取色失败才退回品牌紫，慢一点的封面不再被 150ms 超时盖成紫色。 */
export function useAccent(id: number | string | null | undefined, url?: string): AccentScheme {
  const [scheme, setScheme] = useState<AccentScheme>(() => (id != null && readAccentCache(String(id))) || FALLBACK_SCHEME);
  useEffect(() => {
    if (id == null || !url) { setScheme(FALLBACK_SCHEME); return; }
    const key = String(id);
    const cached = readAccentCache(key);
    if (cached) {
      setScheme(cached);
      publishAccent(id, url, cached);
      return;
    }
    let cancel = false;
    extractAccent(url).then(next => {
      if (cancel) return;
      writeAccentCache(key, next);
      publishAccent(id, url, next);
      setScheme(next);
    }).catch(error => {
      if (cancel) return;
      console.warn("[accent] fallback", key, error instanceof Error ? error.message : error);
      publishAccent(id, url, FALLBACK_SCHEME);
      setScheme(FALLBACK_SCHEME);
    });
    return () => { cancel = true; };
  }, [id, url]);
  return scheme;
}
