/**
 * 下拉刷新（移动端）。挂在滚动容器上，只在 scrollTop=0 且纵向下拉时接管手势。
 *
 * 口径（按需求定，别改）：
 *  - 阈值 64px：拖过 64px 松手才触发刷新，没到就弹回；
 *  - 指示器 60px 圆：拖动时按进度旋转 0→270°，刷新中持续自转；
 *  - 松手后 300ms 内必须有反馈：立刻切到「正在更新…」，结果（成功/失败）用 toast；
 *    如果网络比 300ms 还慢，指示器保持「正在更新…」，不会静默卡住。
 *  - 刷新一律走 force=true（绕过 api 读缓存），否则"刷新了还是旧列表"。
 *
 * 冲突处理：
 *  - 横向手势（|dx| > |dy|）直接放弃，交给 useTabSwipe / 横滑货架；
 *  - 从输入框/文本域起手不接管（避免抢走选字）；
 *  - 低端机 / prefers-reduced-motion 不做回弹动画，直接归位。
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export const PULL = {
  /** 触发刷新的下拉距离 */
  threshold: 64,
  /** 指示器直径（刷新中固定在 60px） */
  indicator: 60,
  /** 跟手阻尼：手指位移 × 0.5，最大 96px */
  damp: 0.5,
  max: 96,
  /** 松手后指示器最短停留时间，保证用户看得见反馈 */
  minFeedbackMs: 300,
} as const;

function motionOff() {
  if (typeof document === "undefined") return true;
  if (document.documentElement.dataset.fx === "low") return true;
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

type Options = {
  ref: RefObject<HTMLElement | null>;
  /** 刷新动作：resolve 即成功，reject 即失败（页面自己 toast 也行，这里统一给 onDone） */
  onRefresh: () => Promise<unknown>;
  enabled?: boolean;
  /** 结果回调：true=成功，false=失败 */
  onDone?: (ok: boolean) => void;
};

export function usePullToRefresh({ ref, onRefresh, enabled = true, onDone }: Options) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const runRef = useRef(onRefresh);
  runRef.current = onRefresh;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const setPullBoth = useCallback((value: number) => {
    pullRef.current = value;
    setPull(value);
  }, []);

  const fire = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setPullBoth(PULL.indicator);
    const started = Date.now();
    let ok = true;
    try {
      await runRef.current();
    } catch {
      ok = false;
    }
    /* 规格：刷新完成后列表回到顶部（失败不动，保留用户当前位置与旧数据） */
    if (ok) {
      try { ref.current?.scrollTo({ top: 0, behavior: motionOff() ? "auto" : "smooth" }); } catch { /* ignore */ }
    }
    const wait = Math.max(0, PULL.minFeedbackMs - (Date.now() - started));
    window.setTimeout(() => {
      refreshingRef.current = false;
      setRefreshing(false);
      setPullBoth(0);
    }, wait);
    try { doneRef.current?.(ok); } catch { /* 回调异常不影响手势状态 */ }
  }, [ref, setPullBoth]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let startX = 0;
    let startY = 0;
    let armed = false;
    let axis: "none" | "y" | "x" = "none";

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || refreshingRef.current) { armed = false; return; }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, [contenteditable=\"true\"], [role=\"dialog\"]")) { armed = false; return; }
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      axis = "none";
      armed = el.scrollTop <= 0;
    };

    const onMove = (event: TouchEvent) => {
      if (!armed || refreshingRef.current || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;
      if (axis === "none") {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        axis = Math.abs(dy) > Math.abs(dx) * 1.15 ? "y" : "x";
        if (axis === "x") { armed = false; return; }
      }
      if (dy <= 0 || el.scrollTop > 0) {
        if (pullRef.current !== 0) setPullBoth(0);
        return;
      }
      if (event.cancelable) event.preventDefault();
      setPullBoth(Math.min(PULL.max, dy * PULL.damp));
    };

    const onEnd = () => {
      if (!armed) { if (pullRef.current) setPullBoth(0); return; }
      armed = false;
      const dist = pullRef.current;
      if (dist >= PULL.threshold) void fire();
      else if (dist !== 0) setPullBoth(0);
    };

    const onCancel = () => {
      armed = false;
      if (!refreshingRef.current) setPullBoth(0);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, [ref, enabled, fire, setPullBoth]);

  return {
    pull,
    refreshing,
    /** 进度 0..1（给指示器旋转用） */
    progress: Math.min(1, pull / PULL.threshold),
    /** 手动触发（桌面端 / 无触摸设备也能用，比如右键菜单外的刷新按钮） */
    trigger: fire,
  };
}

/** 下拉指示器：放在滚动容器里的第一个子元素，靠 height 把内容顶下去（不叠在内容上）。 */
export function PullIndicator({ pull, refreshing, progress, label = "下拉刷新" }: {
  pull: number; refreshing: boolean; progress: number; label?: string;
}) {
  const still = motionOff();
  const height = refreshing ? PULL.indicator : pull;
  if (!height && !refreshing) return null;
  const reached = progress >= 1;
  return (
    <div className="hg-pull" style={{ height, transition: still ? "none" : "height 180ms cubic-bezier(.2,.8,.2,1)" }} aria-live="polite">
      <span
        className={`hg-pull-spin${refreshing ? " is-on" : ""}`}
        style={refreshing || still ? undefined : { transform: `rotate(${progress * 270}deg)`, opacity: 0.35 + progress * 0.65 }}
        aria-hidden="true"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" focusable="false">
          <path d="M12 4v13" />
          <path d="M6.5 12.5 12 18l5.5-5.5" />
        </svg>
      </span>
      <span className="hg-pull-text">{refreshing ? "正在更新…" : reached ? "松开立即更新" : label}</span>
    </div>
  );
}
