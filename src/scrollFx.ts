/**
 * 滚动期动效闸门（iOS 专项）。
 *
 * 为什么需要：iOS 的 WKWebView 在长列表滚动时，如果页面里同时跑着大量无限动画
 * （我们的封面 shimmer 是 `1.4s linear infinite`）和入场动画，合成层会被频繁重建，
 * 表现就是「整页闪一下白/亮」。滚动期间把非必要动画关掉，停手 150ms 再恢复，
 * 视觉上看不出差别，但滚动帧率与稳定性明显不同。
 *
 * 只加一个 `html.is-scrolling` 类，不做任何布局改动；Android 上同样安全。
 */

const IDLE_MS = 150;
let timer: number | undefined;

/** 在滚动容器的 scroll / touchmove 里调用（高频，内部做了节流） */
export function markScrolling(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root.classList.contains("is-scrolling")) root.classList.add("is-scrolling");
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    root.classList.remove("is-scrolling");
    timer = undefined;
  }, IDLE_MS);
}
