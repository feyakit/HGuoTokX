import { useEffect, useRef } from "react";

/** 长按进入多选（上游 #168 / 6abfada）：550ms 触发；位移超过 10px 视为滚动或拖动，取消。 */
const LONG_PRESS_MS = 550;
const MOVE_TOLERANCE = 10;

/**
 * 长按识别。返回的 `longPressProps` 挂在任意可点元素上（button / div 都行），
 * `consumeSuppressedClick()` 必须在 onClick 里先调一次：长按抬手后浏览器仍会补一个 click，
 * 不吞掉就会「刚选中又打开」。电脑右键（contextmenu）走同一入口，`preventDefault` 掉系统菜单。
 *
 * 参数只声明真正用到的几个字段而不是 React.PointerEvent<E>：这样同一份 props 既能给
 * <button> 也能给 <div>，不需要为每种宿主元素各造一个泛型实例。
 */
type PressEvent = { pointerType?: string; button?: number; clientX: number; clientY: number };
type Preventable = { preventDefault: () => void };
export type LongPressProps = {
  onPointerDown?: (event: PressEvent) => void;
  onPointerMove?: (event: PressEvent) => void;
  onPointerUp?: () => void;
  onPointerCancel?: () => void;
  onContextMenu?: (event: Preventable) => void;
  onDragStart?: (event: Preventable) => void;
};

/** 抑制标记的封顶存活时间：长按后若浏览器一直没补 click（例如手势被系统接管），
 *  800ms 后自动失效——否则「抑制状态」会洩到下一次毫不相关的点击上。 */
const SUPPRESS_TTL_MS = 800;

export function useLongPress(onLongPress?: () => void) {
  const timer = useRef<number | undefined>(undefined);
  const suppressTimer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const suppressed = useRef(false);

  const clear = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    start.current = null;
  };
  const clearSuppression = () => {
    window.clearTimeout(suppressTimer.current);
    suppressTimer.current = undefined;
    suppressed.current = false;
  };
  useEffect(() => () => { clear(); clearSuppression(); }, []);

  /* 长按抬手后浏览器会补一个 click：抑制标记只能由「那次 click 自己」消费（consumeSuppressedClick），
     或用封顶时间兜底。**不能**在 pointerup 里定时清掉——click 比 setTimeout 晚到几毫秒，
     清了就等于没抑制：收藏多选会「刚选中又被取消」、标签长按会连带打开内容。 */
  const armSuppression = () => {
    suppressed.current = true;
    window.clearTimeout(suppressTimer.current);
    suppressTimer.current = window.setTimeout(() => {
      suppressed.current = false;
      suppressTimer.current = undefined;
    }, SUPPRESS_TTL_MS);
  };
  const fire = () => {
    clear();
    armSuppression();
    onLongPress?.();
  };

  const longPressProps: LongPressProps = !onLongPress ? {} : {
    onPointerDown: event => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      clearSuppression();
      clear();
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(fire, LONG_PRESS_MS);
    },
    onPointerMove: event => {
      const origin = start.current;
      if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > MOVE_TOLERANCE) clear();
    },
    /* 只清「按住计时」，不动抑制标记：余波 click 还在路上。 */
    onPointerUp: () => clear(),
    onPointerCancel: () => { clear(); clearSuppression(); },
    onContextMenu: event => {
      event.preventDefault();
      if (!suppressed.current) fire();
    },
    onDragStart: event => event.preventDefault(),
  };

  /** true = 这次 click 是长按的余波，调用方应直接返回。消费即失效（不用定时器抢先清）。 */
  const consumeSuppressedClick = () => {
    if (!suppressed.current) return false;
    clearSuppression();
    return true;
  };

  return { longPressProps, consumeSuppressedClick };
}
