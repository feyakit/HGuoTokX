/**
 * 返回 / 退出动画（与进入动画对称）。
 *
 * 三处：
 * 1. 页面返回（详情→列表、设置→我的、搜索→首页…）：优先 `document.startViewTransition`
 *    （小米九 WebView 139 / 云机 125 都支持），拿不到就退回「双层 CSS 交叉」：
 *    当前页下移 8px + 淡出 150ms，下层页从 scale(.985)/.96 回到正常 180ms。
 * 2. 退出播放器：视频层 FLIP 反向 —— 拿不到封面 rect 时退化为缩小 + 淡出 200ms；
 *    控件层先 120ms 淡出，避免控件漂浮。
 * 3. 退出全屏：由 `fsTransition.playExit` 负责（与进入对称），这里不重复。
 *
 * 所有动画都不改布局、结束后不留 inline style；`prefers-reduced-motion` 或低端机
 * （`html[data-fx="low"]`）时长归零，直接切。
 */

import { flushSync } from "react-dom";

const OUT_MS = 150;
const UNDER_MS = 180;
const PLAYER_OUT_MS = 200;
const CONTROLS_OUT_MS = 120;

/** 低端机 / 减少动效：动画一律跳过 */
export function skipMotion(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return true;
  } catch { /* ignore */ }
  return document.documentElement.dataset.fx === "low";
}

type ViewTransitionLike = { finished: Promise<void>; ready?: Promise<void> };

function startViewTransition(update: () => void): ViewTransitionLike | null {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => ViewTransitionLike };
  if (typeof doc.startViewTransition !== "function") return null;
  try {
    return doc.startViewTransition(update);
  } catch {
    return null;
  }
}

/** 最上层页面元素（栈页统一挂 a-page-in） */
export function topPage(): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(".a-page-in");
  return nodes.length ? nodes[nodes.length - 1] : null;
}

/**
 * 页面返回：执行 `commit`（真正出栈），并给它配一段反向动画。
 * 返回 Promise 只是为了测试能等动画结束；调用方不需要 await。
 */
export function popWithTransition(commit: () => void, isPlayer = false): Promise<void> {
  if (skipMotion()) { commit(); return Promise.resolve(); }

  const top = topPage();
  if (isPlayer && top) {
    /* 退出播放器：控件先淡出，再整层缩小淡出（拿不到封面 rect 的退化路径） */
    return playerExit(top, commit);
  }

  const vt = startViewTransition(() => {
    /* React 的 state 更新必须在回调里同步落地，否则 View Transition 截不到新帧 */
    try { flushSync(commit); } catch { commit(); }
  });
  if (vt) {
    return vt.finished.catch(() => {});
  }

  /* 退化：双层 CSS 交叉（不依赖 View Transition） */
  const under = (() => {
    const nodes = document.querySelectorAll<HTMLElement>(".a-page-in");
    return nodes.length > 1 ? nodes[nodes.length - 2] : null;
  })();
  if (top) {
    top.classList.remove("a-page-in");
    top.classList.add("a-page-out");
  }
  if (under) under.classList.add("a-page-under");
  return new Promise<void>((resolve) => {
    window.setTimeout(() => {
      commit();
      if (under) under.classList.remove("a-page-under");
      resolve();
    }, OUT_MS);
  });
}

function playerExit(root: HTMLElement, commit: () => void): Promise<void> {
  const controls = root.querySelectorAll<HTMLElement>(".hg-cinema-top, .hg-cinema-bottom, .hg-player-controls");
  controls.forEach((node) => {
    try {
      node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CONTROLS_OUT_MS, easing: "cubic-bezier(.4,0,1,1)", fill: "none" });
    } catch { /* ignore */ }
  });
  let anim: Animation | null = null;
  try {
    anim = root.animate(
      [
        { transform: "scale(1)", opacity: 1, borderRadius: "0px" },
        { transform: "scale(.92)", opacity: 0, borderRadius: "14px" },
      ],
      { duration: PLAYER_OUT_MS, easing: "cubic-bezier(.4,0,.2,1)", fill: "none" },
    );
  } catch { /* ignore */ }
  return new Promise<void>((resolve) => {
    window.setTimeout(() => {
      commit();
      anim?.cancel();
      resolve();
    }, PLAYER_OUT_MS);
  });
}

export const PAGE_MOTION = { OUT_MS, UNDER_MS, PLAYER_OUT_MS, CONTROLS_OUT_MS };
