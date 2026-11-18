import { Button } from "./ios/controls";
import { useEffect, useRef } from "react";
import { ILockF } from "../icons";

/**
 * 锁定态：屏蔽误触，但必须**始终能解锁**（P1-3：锁定后只能用返回键逃出是 P0 级）。
 * 三重解锁路径：
 *   ① 点右侧解锁钮（主路径）
 *   ② 双击屏幕任意位置
 *   ③ 长按屏幕任意位置 600ms
 * 屏蔽层自己吞掉 pointer 事件，所以解锁判定必须写在屏蔽层上，不能靠下层的视频手势。
 */
export default function PlaybackLock({ active, onUnlock }: { active: boolean; onUnlock: () => void }) {
  const timer = useRef<number | undefined>(undefined);
  const lastTap = useRef(0);
  const down = useRef<{ x: number; y: number; t: number; id: number } | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const block = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true'], [data-playback-unlock], [role='dialog']")) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if ([" ", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "f", "t", "m", "l", "s", "c", "e"].includes(key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, [active]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const cancelHold = () => window.clearTimeout(timer.current);

  return <div data-playback-lock-shield className="absolute inset-0 z-50" style={{ touchAction: "none" }}
    onPointerDown={e => {
      e.stopPropagation();
      /* 解锁钮自己的 pointerdown 已经 stopPropagation，走到这里说明点的是空白处 */
      down.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
      cancelHold();
      timer.current = window.setTimeout(() => { down.current = null; onUnlock(); }, 600) as unknown as number;
    }}
    onPointerUp={e => {
      e.stopPropagation();
      cancelHold();
      const d = down.current;
      down.current = null;
      if (!d || d.id !== e.pointerId) return;
      /* 位移太大算拖动，不当成点击 */
      if (Math.abs(e.clientX - d.x) > 14 || Math.abs(e.clientY - d.y) > 14) return;
      const now = Date.now();
      if (now - lastTap.current < 320) { lastTap.current = 0; onUnlock(); return; }
      lastTap.current = now;
    }}
    onPointerCancel={() => { cancelHold(); down.current = null; }}
    onPointerLeave={() => { cancelHold(); down.current = null; }}
    onClick={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
    <Button type="button" data-playback-unlock aria-label="解锁播放控制" title="解锁播放控制（也可以双击/长按屏幕）" aria-pressed
      onClick={onUnlock}
      className="playback-unlock absolute right-3 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full flex items-center justify-center">
      <ILockF size={22} />
    </Button>
    <span className="playback-unlock-hint absolute left-1/2 -translate-x-1/2 bottom-[18%] text-[12px] text-white/70">
      双击或长按屏幕解锁
    </span>
  </div>;
}
