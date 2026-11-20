/**
 * 播放器手势判定的**纯函数层**。
 *
 * 为什么单独抽出来：真机手势没法在 CI 里跑，所以把「死区 / 方向锁 / seek 量纲 /
 * 边缘返回 / 双击窗口 / 换集门槛 / 旋转冷却」这些纯算术拿出来单测
 * （见 scripts/test-player-gestures.mjs），组件里只负责把输入喂进来、把动作画出来。
 *
 * 坐标约定：所有函数吃掉的都是**舞台坐标**（已经过 stageXY 换算），
 * 竖屏 / 伪横屏（rotated）/ 真横屏（vpLandscape）三条路径共用同一套换算，
 * 任何地方都不许再自己除一次宽高。
 */

export const GESTURE = {
  /** 起手死区：位移没超过这个值之前不定方向（px） */
  deadZone: 10,
  /** 点击容差：总位移 < 6px 且时长 < 300ms 才算「单击」；
      6px ≤ 位移 < deadZone 的微动属于**无动作**（不 tap、不 seek、不换集） */
  tapSlop: 6,
  /** 单击的最长按压时长（ms） */
  tapMs: 300,
  /** 定方向比例：|dx| >= |dy|*1.4 判横，|dy| >= |dx|*1.4 判竖 */
  axisRatio: 1.4,
  /** 左缘返回区宽度（px，从舞台左边缘算） */
  edgeBack: 24,
  /** 左缘右滑生效距离（px）——超过才真的退一层，避免误触 */
  edgeBackCommit: 72,
  /** 双击窗口（ms） */
  doubleTapMs: 280,
  /** 双击 seek 步长（秒） */
  doubleTapSeek: 10,
  /** 短滑不 seek 的最小位移（px） */
  minSeekPx: 20,
  /** 换集提交门槛：拖过屏高的 40% 才切 */
  episodeSwitch: 0.4,
  /** 换集预览门槛：拖过屏高的 70% 才露预览 */
  episodePreview: 0.7,
  /** 松手吸附到整 5 秒 */
  snapSeconds: 5,
  /** 方向切换动画期间禁手势（ms） */
  rotateLockMs: 300,
  /** seek 提示气泡停留（ms） */
  seekBubbleMs: 800,
} as const;

export type Axis = "none" | "x" | "y";

export type GestureAction =
  | { kind: "none" }
  | { kind: "tap"; x: number }
  | { kind: "double-tap"; seconds: number }
  | { kind: "edge-back" }
  | { kind: "seek"; seconds: number }
  | { kind: "episode"; dir: 1 | -1; commit: boolean; preview: boolean };

/**
 * 方向锁：超过死区后按 1.4 倍比例定轴，**定下即锁死**（同一手势内不再改判）。
 * 两个比例都不满足（斜着 45°）时继续等，返回 "none"。
 */
export function lockAxis(prev: Axis, dx: number, dy: number): Axis {
  if (prev !== "none") return prev;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax <= GESTURE.deadZone && ay <= GESTURE.deadZone) return "none";
  if (ax >= ay * GESTURE.axisRatio) return "x";
  if (ay >= ax * GESTURE.axisRatio) return "y";
  return "none";
}

/**
 * 横向拖动 100px 对应多少秒：按片长自适应。
 * <=60s → 15s，60–600s → 30s，>600s → 60s。未知片长按 30s 处理。
 */
export function seekSecondsPer100px(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 30;
  if (total <= 60) return 15;
  if (total <= 600) return 30;
  return 60;
}

/** 横向位移换算成秒（带方向：右为正） */
export function seekDeltaSeconds(dx: number, total: number): number {
  return (dx / 100) * seekSecondsPer100px(total);
}

/** 短滑（<20px）不触发 seek */
export function canSeek(dx: number): boolean {
  return Math.abs(dx) >= GESTURE.minSeekPx;
}

/** 松手吸附到整 5 秒，并夹在 [0, total] */
export function snapSeek(seconds: number, total: number): number {
  const step = GESTURE.snapSeconds;
  const snapped = Math.round(seconds / step) * step;
  const upper = Number.isFinite(total) && total > 0 ? total : snapped;
  return Math.max(0, Math.min(upper, snapped));
}

/** 双击：左半屏 −10s，右半屏 +10s */
export function doubleTapSeek(x: number, stageWidth: number): number {
  const half = (Number.isFinite(stageWidth) ? stageWidth : 0) / 2;
  return x < half ? -GESTURE.doubleTapSeek : GESTURE.doubleTapSeek;
}

/** 是否从左缘返回区起手（按舞台内坐标，非屏幕坐标） */
export function isEdgeBackStart(localX: number): boolean {
  return localX <= GESTURE.edgeBack;
}

/**
 * 单击判定。总位移（欧氏距离）与时长一起看：
 *   · 位移 < tapSlop(6px) 且时长 < tapMs(300ms) → "tap"
 *   · 其余一律 "none" —— 特别是 6–10px 的微动：过不了死区（不会 seek/换集），
 *     但也不该被当成单击（以前 6–8px 的抖动会把视频暂停，手感很怪）。
 */
export function tapVerdict(dx: number, dy: number, dt: number): "tap" | "none" {
  if (dt > GESTURE.tapMs) return "none";
  return Math.hypot(dx, dy) < GESTURE.tapSlop ? "tap" : "none";
}

/** 双击是否成立：与上次点击间隔在窗口内 */
export function isDoubleTap(lastTapAt: number, now: number): boolean {
  return lastTapAt > 0 && now - lastTapAt <= GESTURE.doubleTapMs;
}

/** 方向切换动画期间（orientationchange 后 300ms）禁一切手势 */
export function rotationLocked(changedAt: number, now: number): boolean {
  if (!changedAt) return false;
  return now - changedAt < GESTURE.rotateLockMs;
}

/**
 * 上下滑换集：dy<0（上滑）= 下一集，dy>0（下滑）= 上一集。
 * commit 门槛 30% 屏高，preview 门槛 60% 屏高（露出封面/集数预览）。
 */
export function episodeIntent(
  dy: number,
  stageHeight: number,
): { dir: 1 | -1; commit: boolean; preview: boolean } {
  const dir: 1 | -1 = dy <= 0 ? 1 : -1;
  const height = Number.isFinite(stageHeight) && stageHeight > 0 ? stageHeight : 0;
  const ratio = height ? Math.abs(dy) / height : 0;
  return {
    dir,
    commit: ratio >= GESTURE.episodeSwitch,
    preview: ratio >= GESTURE.episodePreview,
  };
}

/**
 * 一次手势的总判定（给组件用，也方便单测整条链路）。
 * 输入都是舞台坐标；previousAxis 用于锁方向。
 */
export function judgeGesture(input: {
  dx: number;
  dy: number;
  dt: number;
  startX: number;
  stageWidth: number;
  stageHeight: number;
  total: number;
  axis?: Axis;
  held?: boolean;
}): { axis: Axis; action: GestureAction } {
  const axis = input.axis && input.axis !== "none"
    ? input.axis
    : input.held
      ? "none"
      : lockAxis("none", input.dx, input.dy);
  if (axis === "none") return { axis, action: { kind: "none" } };

  if (axis === "x") {
    if (isEdgeBackStart(input.startX) && input.dx > 0) {
      return {
        axis,
        action: input.dx >= GESTURE.edgeBackCommit ? { kind: "edge-back" } : { kind: "none" },
      };
    }
    if (!canSeek(input.dx)) return { axis, action: { kind: "none" } };
    return { axis, action: { kind: "seek", seconds: seekDeltaSeconds(input.dx, input.total) } };
  }

  const ep = episodeIntent(input.dy, input.stageHeight);
  return { axis, action: { kind: "episode", dir: ep.dir, commit: ep.commit, preview: ep.preview } };
}
