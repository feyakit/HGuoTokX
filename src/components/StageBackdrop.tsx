import { useEffect, useRef, useState } from "react";

/**
 * 不满屏视频背后的「沉浸背景」。
 *
 * 做法参照音乐类 App：不拿大图做高斯模糊（那在 Chrome 87 / 老 WebView 上很贵），
 * 而是先把封面缩成 64px 宽的小图，再用 background-size: cover 铺满屏幕——
 * 双线性放大天然就是柔和模糊，开销几乎为零，最多再补一层 12px 的 blur。
 * 小图结果按封面地址缓存，切集不会重算。
 */

const SMALL_MAX = 80;
const small = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

function remember(url: string, data: string) {
  if (small.size >= SMALL_MAX) {
    const oldest = small.keys().next().value;
    if (oldest) small.delete(oldest);
  }
  small.set(url, data);
}

/** 缩到 64×114：竖图比例足够铺满任何屏幕，缩小后放大反而更糊。 */
function shrink(url: string): Promise<string> {
  const hit = small.get(url);
  if (hit) return Promise.resolve(hit);
  const running = pending.get(url);
  if (running) return running;
  const task = new Promise<string>((resolve, reject) => {
    const image = new Image();
    /* 本地图片协议是同源的；加 crossOrigin 只是避免远端封面污染画布 */
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const width = 64;
        const height = 114;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas");
        ctx.drawImage(image, 0, 0, width, height);
        const data = canvas.toDataURL("image/jpeg", 0.72);
        remember(url, data);
        resolve(data);
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error("image"));
    image.src = url;
  }).finally(() => { pending.delete(url); });
  pending.set(url, task);
  return task;
}

/** 返回可直接铺满屏幕的小图；缩图失败时退回原图（多花一点模糊开销，但不留黑底）。 */
export function useSoftCover(url: string): string {
  const [value, setValue] = useState(() => (url ? small.get(url) || "" : ""));
  useEffect(() => {
    if (!url) { setValue(""); return; }
    const cached = small.get(url);
    if (cached) { setValue(cached); return; }
    setValue("");
    let cancelled = false;
    shrink(url).then(data => { if (!cancelled) setValue(data); })
      .catch(() => { if (!cancelled) setValue(url); });
    return () => { cancelled = true; };
  }, [url]);
  return value;
}

/**
 * 两层叠着做交叉淡入淡出：换剧时旧图 0.5s 淡出、新图淡入，中间不会闪黑；
 * 同一部剧换集封面地址不变，这一层连重渲染都不会发生。
 */
export default function StageBackdrop({ src }: { src: string }) {
  const soft = useSoftCover(src);
  const [previous, setPrevious] = useState("");
  const last = useRef("");

  useEffect(() => {
    if (!soft || soft === last.current) return;
    const outgoing = last.current;
    last.current = soft;
    if (outgoing) setPrevious(outgoing);
    const timer = window.setTimeout(() => setPrevious(""), 520);
    return () => window.clearTimeout(timer);
  }, [soft]);

  return (
    <>
      {previous && <div key={`out:${previous}`} className="hg-stage-cover is-out" style={{ backgroundImage: `url("${previous}")` }} />}
      {soft && <div key={soft} className="hg-stage-cover" style={{ backgroundImage: `url("${soft}")` }} />}
    </>
  );
}
