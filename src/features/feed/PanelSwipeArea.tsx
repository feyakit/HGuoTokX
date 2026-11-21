import { useEffect, useRef, type ReactNode } from "react";

/** 左右滑切页的位移门槛（px）与「轴向判定」比例：横向必须明显大于纵向才算切页。 */
const TAB_SWIPE_DISTANCE = 56;
/** 顶部下拉关闭的门槛（px）。 */
const CLOSE_SWIPE_DISTANCE = 72;
const AXIS_RATIO = 1.35;

/**
 * 抽屉（详情 / 选集）的手势层：左右滑切页、内容在顶部时下拉关闭。
 *
 * 只负责判定与回调，不画任何东西，也不改里面元素的尺寸与位置——它就是把子节点套一层
 * 带监听的 div（className 由调用方给，沿用原来的 flex-1 min-h-0）。
 *
 * 三条避让（必须保留，否则会抢走内容自己的滚动）：
 * 1. 起手落在横向轮播里（overflow-x:auto 且内容超宽）→ 不接管，让轮播自己滑；
 * 2. 起手落在纵向滚动容器里 → 只允许「已经在顶部」才把下拉当关闭；
 * 3. 输入框/文本域/下拉，以及带 data-panel-swipe-ignore 的元素 → 完全不接管。
 *
 * 触摸用原生监听（Pointer Events 在浏览器接管原生滚动后会被 cancel），鼠标/触控笔走 Pointer。
 */
export function PanelSwipeArea<P extends string>({ panel, pages, onChange, onClose, className = "", children }: {
  panel: P;
  /** 允许左右切换的页签顺序（左滑去下一页，右滑回上一页） */
  pages: readonly P[];
  onChange: (panel: P) => void;
  /** 顶部下拉时调用（通常是 setPanel(null)） */
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number; atTop: boolean; lastX: number; lastY: number } | null>(null);
  const pointerStart = useRef<{ x: number; y: number; pointerId: number; atTop: boolean } | null>(null);

  const findScroller = (target: Element, boundary: HTMLElement, axis: "x" | "y"): HTMLElement | null => {
    let node: Element | null = target;
    while (node && node !== boundary.parentElement) {
      if (node instanceof HTMLElement) {
        const style = getComputedStyle(node);
        const overflow = axis === "x" ? style.overflowX : style.overflowY;
        if (overflow === "auto" || overflow === "scroll") {
          const overflows = axis === "x" ? node.scrollWidth > node.clientWidth + 1 : node.scrollHeight > node.clientHeight + 1;
          if (overflows) return node;
        }
      }
      node = node.parentElement;
    }
    return null;
  };

  const startInfo = (target: Element, area: HTMLElement) => {
    if (target.closest("input, textarea, select, [data-panel-swipe-ignore]")) return null;
    if (findScroller(target, area, "x")) return null;
    const scroller = findScroller(target, area, "y");
    return { atTop: !scroller || scroller.scrollTop <= 1 };
  };

  const commit = (x: number, y: number, endX: number, endY: number, atTop: boolean) => {
    const dx = endX - x;
    const dy = endY - y;
    if (Math.abs(dx) >= TAB_SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * AXIS_RATIO) {
      const index = pages.indexOf(panel);
      if (index < 0) return;
      const next = pages[dx < 0 ? index + 1 : index - 1];
      if (next) onChange(next);
      return;
    }
    if (atTop && dy >= CLOSE_SWIPE_DISTANCE && dy > Math.abs(dx) * AXIS_RATIO) onClose();
  };

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const begin = (event: TouchEvent) => {
      if (event.touches.length !== 1) { touchStart.current = null; return; }
      const touch = event.touches[0];
      const info = startInfo(event.target as Element, area);
      if (!info) { touchStart.current = null; return; }
      touchStart.current = { x: touch.clientX, y: touch.clientY, atTop: info.atTop, lastX: touch.clientX, lastY: touch.clientY };
    };
    const move = (event: TouchEvent) => {
      const gesture = touchStart.current;
      if (!gesture || event.touches.length !== 1) return;
      const touch = event.touches[0];
      gesture.lastX = touch.clientX;
      gesture.lastY = touch.clientY;
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      /* 只有「顶部继续往下拉」才吃掉默认行为（否则会把内容自己的上推滚动也挡掉） */
      if (gesture.atTop && dy > 8 && dy > Math.abs(dx) * AXIS_RATIO) event.preventDefault();
    };
    const finish = (event: TouchEvent) => {
      const gesture = touchStart.current;
      touchStart.current = null;
      if (!gesture) return;
      const touch = event.changedTouches[0];
      commit(gesture.x, gesture.y, touch?.clientX ?? gesture.lastX, touch?.clientY ?? gesture.lastY, gesture.atTop);
    };
    area.addEventListener("touchstart", begin, { passive: true });
    area.addEventListener("touchmove", move, { passive: false });
    area.addEventListener("touchend", finish, { passive: true });
    area.addEventListener("touchcancel", finish, { passive: true });
    return () => {
      area.removeEventListener("touchstart", begin);
      area.removeEventListener("touchmove", move);
      area.removeEventListener("touchend", finish);
      area.removeEventListener("touchcancel", finish);
    };
  }, [panel, pages, onChange, onClose]);

  return <div
    ref={areaRef}
    className={className}
    onPointerDown={event => {
      /* 触摸交给上面的原生监听：Pointer Events 会在浏览器接管滚动时被取消 */
      if (event.pointerType === "touch" || !event.isPrimary || event.button !== 0) return;
      const info = startInfo(event.target as Element, event.currentTarget);
      if (!info) return;
      pointerStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, atTop: info.atTop };
    }}
    onPointerUp={event => {
      const gesture = pointerStart.current;
      pointerStart.current = null;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      commit(gesture.x, gesture.y, event.clientX, event.clientY, gesture.atTop);
    }}
    onPointerCancel={() => { pointerStart.current = null; }}
  >{children}</div>;
}
