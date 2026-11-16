import { useEffect, useState } from "react";
import { FALLBACK_SCHEME, readAccentCache, schemeFromPixels, writeAccentCache, type AccentScheme } from "./accent";

export function extractAccent(url: string): Promise<AccentScheme> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 57;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) { reject(new Error("canvas")); return; }
        ctx.drawImage(image, 0, 0, 32, 57);
        resolve(schemeFromPixels(ctx.getImageData(0, 0, 32, 57).data));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error("image"));
    image.src = url;
  });
}

/** 先读缓存，150ms 内取不到就先用品牌紫，晚到的结果再补上。 */
export function useAccent(id: number | string | null | undefined, url?: string): AccentScheme {
  const [scheme, setScheme] = useState<AccentScheme>(() => (id != null && readAccentCache(String(id))) || FALLBACK_SCHEME);
  useEffect(() => {
    if (id == null || !url) { setScheme(FALLBACK_SCHEME); return; }
    const key = String(id);
    const cached = readAccentCache(key);
    if (cached) { setScheme(cached); return; }
    let cancel = false;
    const timer = window.setTimeout(() => { if (!cancel) setScheme(FALLBACK_SCHEME); }, 150);
    extractAccent(url).then(next => {
      if (cancel) return;
      window.clearTimeout(timer);
      writeAccentCache(key, next);
      setScheme(next);
    }).catch(() => { if (!cancel) setScheme(FALLBACK_SCHEME); });
    return () => { cancel = true; window.clearTimeout(timer); };
  }, [id, url]);
  return scheme;
}
