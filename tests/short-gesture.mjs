/**
 * 刷剧页手势判定的回归用例。
 *
 * 这里刻意不用 Playwright：这些阈值和判定是纯函数，node 直接跑就能覆盖，
 * 不需要浏览器、不需要真机，CI 里也不会因为环境问题假红。
 * 运行：pnpm test:short-gesture
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOST_LOCK_PULL, TAP_MS, decideAxis, dampEdgeDrag, isDoubleTap, resolvePage, shouldLockBoost, stepValue,
} from "../src/components/short/gestures.ts";

const phone = { boxLeft: 0, boxWidth: 390, boxHeight: 844 };
const landscape = { boxLeft: 0, boxWidth: 844, boxHeight: 390 };

test("位移小于阈值不判定方向", () => {
  assert.equal(decideAxis({ dx: 3, dy: 4, startX: 200, ...phone }), "");
  assert.equal(decideAxis({ dx: 0, dy: 0, startX: 200, ...phone }), "");
});

test("竖屏：竖滑翻页、横滑切 tab，边缘不会误判成亮度音量", () => {
  assert.equal(decideAxis({ dx: 6, dy: 120, startX: 20, ...phone }), "y");
  assert.equal(decideAxis({ dx: 120, dy: 8, startX: 20, ...phone }), "x");
  assert.equal(decideAxis({ dx: 8, dy: 130, startX: 4, ...phone }), "y");
});

test("横屏：左右边缘的竖滑是亮度音量，中间仍然是翻页", () => {
  assert.equal(decideAxis({ dx: 6, dy: 120, startX: 30, ...landscape }), "side");
  assert.equal(decideAxis({ dx: 6, dy: 120, startX: 800, ...landscape }), "side");
  assert.equal(decideAxis({ dx: 6, dy: 120, startX: 420, ...landscape }), "y");
});

test("到第一条/最后一条继续外拉时被阻尼且不会超出上限", () => {
  assert.equal(dampEdgeDrag(120, 800, false, false), 120);
  const damped = dampEdgeDrag(1000, 800, true, false);
  assert.ok(damped < 1000, "到边后要明显比手指走得少");
  assert.ok(Math.abs(damped) <= 800 * 0.12 + 1e-6, "最多露出 12% 屏高");
  assert.ok(dampEdgeDrag(-1000, 800, false, true) < 0, "反方向也要保持符号");
});

test("翻页判定：距离、速度、边界", () => {
  const far = resolvePage({ dy: -200, velocity: 0, height: 800, index: 2, total: 5 });
  assert.deepEqual(far, { page: true, dir: 1, can: true });

  const short = resolvePage({ dy: -30, velocity: 0, height: 800, index: 2, total: 5 });
  assert.equal(short.page, false, "位移不够时不该翻页");

  const fling = resolvePage({ dy: -40, velocity: -0.8, height: 800, index: 2, total: 5 });
  assert.equal(fling.page, true, "快速甩动即使位移小也算翻页");

  const atTop = resolvePage({ dy: 300, velocity: 0.9, height: 800, index: 0, total: 5 });
  assert.deepEqual(atTop, { page: true, dir: -1, can: false }, "第一条继续往回拉，没有上一条可去");

  const atEnd = resolvePage({ dy: -300, velocity: 0, height: 800, index: 4, total: 5 });
  assert.equal(atEnd.can, false);
});

test("长按锁定倍速不受侧滑改写起点影响（回归）", () => {
  const baseline = 500;
  // 侧滑调音量时组件会把拖动起点改写成当前 y，锁定判定必须仍用按下时的基准点。
  assert.equal(shouldLockBoost({ boost: true, locked: false, baselineY: baseline, currentY: baseline - BOOST_LOCK_PULL - 1 }), true);
  assert.equal(shouldLockBoost({ boost: true, locked: false, baselineY: baseline, currentY: baseline - 10 }), false);
  assert.equal(shouldLockBoost({ boost: false, locked: false, baselineY: baseline, currentY: 0 }), false, "没长按就不锁");
  assert.equal(shouldLockBoost({ boost: true, locked: true, baselineY: baseline, currentY: 0 }), false, "已经锁了不重复");
});

test("侧滑数值步进：方向由调用方给定、结果夹在范围内", () => {
  // 音量：向上拖动（pull 为正）变大。
  assert.ok(stepValue({ value: 0.5, delta: 0.125, max: 1 }) > 0.5);
  assert.ok(stepValue({ value: 0.5, delta: -0.125, max: 1 }) < 0.5);
  assert.equal(stepValue({ value: 0.98, delta: 1, max: 0.72 }), 0.72, "亮度上限");
  assert.equal(stepValue({ value: 0.02, delta: -1, max: 1 }), 0, "不能变成负数");
  // 亮度是暗度：上滑要变亮，所以传 -pull，暗度必须下降。
  const veilBefore = 0.5;
  const veilAfterUpDrag = stepValue({ value: veilBefore, delta: -0.125, max: 0.72 });
  assert.ok(veilAfterUpDrag < veilBefore, "上滑变亮");
});

test("单击与双击的区分", () => {
  const first = { at: 1000, x: 100, y: 200 };
  assert.equal(isDoubleTap(first, 1000 + TAP_MS - 1, 104, 204), true);
  assert.equal(isDoubleTap(first, 1000 + TAP_MS + 1, 100, 200), false, "超时算两次单击");
  assert.equal(isDoubleTap(first, 1050, 100, 300), false, "位移太大不算双击");
  assert.equal(isDoubleTap({ at: 0, x: 0, y: 0 }, 1030, 0, 0), false, "第一下不能算双击");
});
