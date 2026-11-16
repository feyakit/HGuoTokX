/**
 * 刷剧页的手势判定，抽成纯函数：
 * 一是这些阈值散在 600 多行的组件里没人敢改，二是纯函数能在没有浏览器、没有真机的
 * 环境里跑回归（见 tests/short-gesture.mjs）。
 */

export type DragAxis = "" | "x" | "y" | "side";

/** 拖动超过这个距离才判定方向，避免轻微抖动被判成滑动。 */
export const AXIS_SLOP = 10;
/** 竖向与横向的比值门槛：竖滑要比横滑明显才当翻页。 */
const AXIS_RATIO = 1.2;
/** 翻页的距离阈值（占一屏高度）。 */
const PAGE_RATIO = 0.18;
/** 甩动速度阈值（像素/毫秒）。 */
const PAGE_VELOCITY = 0.5;
/** 顶部/底部继续外拉时的阻尼系数与最大露出。 */
const EDGE_DAMP = 0.35;
const EDGE_MAX_RATIO = 0.12;
/** 长按进入 2x 后，再下拉这么多像素锁定。 */
export const BOOST_LOCK_PULL = 64;
/** 双击判定窗口与位移容差。 */
export const TAP_MS = 260;
const TAP_SLOP = 36;

export type AxisInput = {
  dx: number;
  dy: number;
  startX: number;
  boxLeft: number;
  boxWidth: number;
  boxHeight: number;
};

/**
 * 横屏时左右两侧边缘的竖向拖动用来调亮度/音量，中间竖向拖动仍然是翻页。
 * 竖屏下不存在 side 手势。
 */
export function decideAxis({ dx, dy, startX, boxLeft, boxWidth, boxHeight }: AxisInput): DragAxis {
  if (Math.hypot(dx, dy) <= AXIS_SLOP) return "";
  const vertical = Math.abs(dy) > Math.abs(dx) * AXIS_RATIO;
  const landscape = boxWidth > boxHeight;
  const localX = startX - boxLeft;
  const onSide = localX < boxWidth * 0.4 || localX > boxWidth * 0.6;
  if (landscape && vertical && onSide) return "side";
  return vertical ? "y" : "x";
}

/** 第一条/最后一条还要往外拖时做阻尼，让「到边了」手感上有反馈而不是硬停。 */
export function dampEdgeDrag(dy: number, height: number, atStart: boolean, atEnd: boolean): number {
  if (!(atStart || atEnd)) return dy;
  const limit = Math.max(1, height) * EDGE_MAX_RATIO;
  return Math.max(-limit, Math.min(limit, dy * EDGE_DAMP));
}

export type PageInput = { dy: number; velocity: number; height: number; index: number; total: number };
export type PageResult = { page: boolean; dir: 1 | -1; can: boolean };

/** 松手后要不要翻页、翻哪个方向、这条方向上还有没有内容。 */
export function resolvePage({ dy, velocity, height, index, total }: PageInput): PageResult {
  const dir: 1 | -1 = dy < 0 ? 1 : -1;
  const page = Math.abs(dy) > Math.max(1, height) * PAGE_RATIO || Math.abs(velocity) > PAGE_VELOCITY;
  const can = (dir === 1 && index < total - 1) || (dir === -1 && index > 0);
  return { page, dir, can };
}

/**
 * 长按进入 2x 之后，继续下拉多少才锁定。
 * 基准点必须是按下时记录的那个 y —— 侧滑调亮度会改写拖动起点，用改写后的值算会误锁。
 */
export function shouldLockBoost({ boost, locked, baselineY, currentY }: {
  boost: boolean; locked: boolean; baselineY: number; currentY: number;
}): boolean {
  if (!boost || locked) return false;
  return baselineY - currentY > BOOST_LOCK_PULL;
}

/**
 * 侧滑手势的数值步进：delta 已经换算成数值单位（向上拖动为正），结果夹在 [0, max]。
 * 亮度用的是「暗度」（遮罩 opacity），所以传 -delta —— 上滑变亮、下滑变暗；
 * 音量传 +delta —— 上滑变大。两个方向都由调用方显式给出，避免符号写反。
 */
export function stepValue({ value, delta, max }: { value: number; delta: number; max: number }): number {
  return Math.min(max, Math.max(0, value + delta));
}

/** 单击/双击之后到底该做什么：没暂停就暂停，暂停中就恢复，双击一律是点赞。 */
export type TapOutcome = "pause" | "resume" | "like";
export function resolveTap({ paused, doubleTap }: { paused: boolean; doubleTap: boolean }): TapOutcome {
  if (doubleTap) return "like";
  return paused ? "resume" : "pause";
}
export function isDoubleTap(prev: { at: number; x: number; y: number }, now: number, x: number, y: number): boolean {
  if (!prev.at) return false;
  return now - prev.at < TAP_MS && Math.hypot(x - prev.x, y - prev.y) < TAP_SLOP;
}
