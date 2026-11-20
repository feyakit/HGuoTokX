/**
 * 全屏进出的 FLIP 过渡（Web Animations API，不写 inline style，不挡点击）。
 *
 * 为什么要 FLIP：`fs` 一开，播放器从「页面里的一块」变成 `position:fixed; inset:0`，
 * 纯 CSS 切换是硬跳。这里记录切换前的 rect，切换后反算 scale + translate，
 * 用 WAAPI 从旧几何补间到新几何。
 *
 * 与系统旋转的关系：移动端进全屏会请求系统转屏（iOS UIWindowScene / 安卓
 * setRequestedOrientation），旋转本身由系统做，**不叠加缩放**（否则旋转和缩放打架，
 * 还会出现画面错位）。这种情况只做一次淡入。
 *
 * 降级：prefers-reduced-motion、或 `html[data-fx="low"]`（低端机）直接切。
 */
const DURATION = 280;
const EASING = "cubic-bezier(.2,.8,.2,1)";
const RADIUS = "14px";

function motionAllowed(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.dataset.fx === "low") return false;
  try {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

type Rect = { left: number; top: number; width: number; height: number };

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** 从「旧几何」补间到元素当前几何（放大进全屏用） */
export function playEnter(el: HTMLElement | null, from: Rect | null, scale: boolean): void {
  if (!el || !from || !from.width || !from.height) return;
  if (!motionAllowed()) return;
  const to = rectOf(el);
  if (!to.width || !to.height) return;
  if (!scale) {
    /* 会触发系统旋转：只淡入，别缩放（画面位置由系统旋转负责） */
    el.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 160, easing: EASING });
    return;
  }
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: RADIUS, boxShadow: "0 18px 50px rgba(0,0,0,.55)" },
      { transform: "none", borderRadius: "0px", boxShadow: "0 0 0 rgba(0,0,0,0)" },
    ],
    { duration: DURATION, easing: EASING, fill: "none" },
  );
}

/** 退出全屏：从满屏几何缩回元素当前（页面内）几何 */
export function playExit(el: HTMLElement | null, from: Rect | null, scale: boolean): void {
  if (!el || !from || !from.width || !from.height) return;
  if (!motionAllowed()) return;
  const to = rectOf(el);
  if (!to.width || !to.height) return;
  if (!scale) {
    el.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 120 }); // 无位移可做，保持静默
    return;
  }
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: "0px" },
      { transform: "none", borderRadius: RADIUS },
    ],
    { duration: 220, easing: "cubic-bezier(.4,0,.2,1)", fill: "none" },
  );
}

/** 点击处的 transform-origin（百分比），没有点击坐标时用中心 */
export function originFromPoint(el: HTMLElement | null, x?: number, y?: number): string {
  if (!el || x == null || y == null) return "50% 50%";
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return "50% 50%";
  const px = Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100));
  const py = Math.min(100, Math.max(0, ((y - r.top) / r.height) * 100));
  return `${px.toFixed(1)}% ${py.toFixed(1)}%`;
}
