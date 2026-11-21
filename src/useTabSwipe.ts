/**
 * 首页「推荐 / 上新 / 热榜」左右手势切页（跟手 pager）。
 *
 * 方向判定**复用** playerGestures 的 lockAxis（10px 死区 + 1.4 倍比例 + 定下即锁死），
 * 不再另写一套阈值，避免两处手感不一致。
 *
 * 冲突优先级（从高到低）：
 *   1. 落在可横滑容器里的手势（榜单/Top10/吃瓜/筛选行）→ 直接放行，不接管
 *   2. Hero 轮播区 → 归轮播
 *   3. 已锁定为纵轴 → 永远不切页
 *   4. 横轴 + 过了阈值 → 切页
 */
import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { lockAxis, type Axis } from "./playerGestures";

export const TAB_SWIPE = {
  /** 松手时位移超过视口宽的比例就切页 */
  commitRatio: 0.25,
  /** 或者速度超过这个值（px/s）也切 */
  velocity: 500,
  /** 首/末 tab 继续滑的阻尼 */
  edgeRubber: 0.25,
  /** 阻尼后的最大可视位移（px） */
  edgeMax: 60,
  /** 回弹时长 */
  reboundMs: 200,
  /** 切页出/入动画时长 */
  slideOutMs: 180,
  slideInMs: 160,
  ease: "cubic-bezier(.2,.8,.2,1)",
} as const;

/** 这些容器自己有横滑，不能被首页切页抢走 */
export const SWIPE_BLOCKERS = [
  "[data-hscroll]",
  ".hg-inline-sorts",
  ".hg-rail",
  ".hg-spotlight",
  ".hg-spotlight-shell",
  ".hg-hero",
  "input",
  "textarea",
  '[role="dialog"]',
].join(", ");

type Options = {
  /** tab 顺序（key 数组） */
  order: readonly string[];
  current: string;
  onSelect: (key: string) => void;
  /** 只在首页 feed tab 且没有栈页时启用 */
  enabled: boolean;
  containerRef: RefObject<HTMLElement | null>;
};

function motionOff(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.dataset.fx === "low") return true;
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

export function useTabSwipe({ order, current, onSelect, enabled, containerRef }: Options) {
  const drag = useRef<{ x: number; y: number; t: number; dx: number; axis: Axis; blocked: boolean } | null>(null);

  const index = Math.max(0, order.indexOf(current));

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.pointerType === "mouse") return;
    const target = event.target instanceof Element ? event.target : null;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      t: Date.now(),
      dx: 0,
      axis: "none",
      blocked: !!target?.closest(SWIPE_BLOCKERS),
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    const el = containerRef.current;
    if (!state || state.blocked || !enabled || !el) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    state.axis = lockAxis(state.axis, dx, dy);
    if (state.axis !== "x") return;
    /* 首/末 tab 继续同方向滑：阻尼，最多 edgeMax px，绝不切页 */
    const next = dx < 0 ? index + 1 : index - 1;
    const atEdge = next < 0 || next >= order.length;
    state.dx = atEdge
      ? Math.sign(dx) * Math.min(Math.abs(dx) * TAB_SWIPE.edgeRubber, TAB_SWIPE.edgeMax)
      : dx;
    el.style.transform = `translate3d(${state.dx}px, 0, 0)`;
    el.style.transition = "none";
  };

  const settle = (event?: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const state = drag.current;
    const el = containerRef.current;
    drag.current = null;
    if (!state || !el) return;
    if (state.blocked || state.axis !== "x" || !enabled) {
      el.style.transform = "";
      el.style.transition = "";
      return;
    }
    const width = el.clientWidth || window.innerWidth || 1;
    const dt = Math.max(1, Date.now() - state.t);
    const velocity = (state.dx / dt) * 1000;
    const next = state.dx < 0 ? index + 1 : index - 1;
    const atEdge = next < 0 || next >= order.length;
    const commit = !cancelled && !atEdge
      && (Math.abs(state.dx) > width * TAB_SWIPE.commitRatio || Math.abs(velocity) > TAB_SWIPE.velocity);

    if (!commit) {
      el.style.transition = `transform ${TAB_SWIPE.reboundMs}ms ${TAB_SWIPE.ease}`;
      el.style.transform = "translate3d(0, 0, 0)";
      window.setTimeout(() => { el.style.transform = ""; el.style.transition = ""; }, TAB_SWIPE.reboundMs + 40);
      return;
    }

    if (motionOff()) {
      el.style.transform = "";
      el.style.transition = "";
      onSelect(order[next]);
      return;
    }

    const dir = state.dx < 0 ? -1 : 1; // -1 = 往左滑（下一页）
    /* 先切页再动画：不依赖 onfinish（真机上 WAAPI 的回调偶尔会被下一帧的卸载吞掉，
       表现为「滑了但过一会儿才切」）。内容只有一屏，切换后从另一侧滑入即可。 */
    el.style.transform = "";
    el.style.transition = "";
    onSelect(order[next]);
    el.animate(
      [
        { transform: `translate3d(${-dir * 44}px, 0, 0)`, opacity: 0.5 },
        { transform: "none", opacity: 1 },
      ],
      { duration: TAB_SWIPE.slideInMs, easing: TAB_SWIPE.ease },
    );
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => settle(event),
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => settle(event, true),
    /** 需要在容器上加 touch-action: pan-y，横向手势才归我们、纵向仍归页面滚动 */
    touchAction: enabled ? ("pan-y" as const) : undefined,
  };
}
