import { useEffect, useState } from "react";

/**
 * 条件渲染的"淡出再说再见"。
 *
 * 问题：控件层/浮层都是 `{clean && <Bar/>}` 这种条件渲染，状态一变就整块消失，
 * 看起来是"硬切"。这个 hook 在 show 变 false 后再留 120ms 给淡出动画，
 * 到时间才真正卸载（和 DialogFrame 的做法一致）。
 *
 * 用法：
 *   const bar = useFadeMount(show);
 *   {bar.mounted && <div className={`... ${bar.cls}`}>…</div>}
 * cls 是 "hg-fade-in" / "hg-fade-out"，动画时长与曲线在 index.css 里统一定义。
 */
export function useFadeMount(show: boolean, leaveMs = 120): { mounted: boolean; cls: string } {
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) { setMounted(true); return undefined; }
    const timer = window.setTimeout(() => setMounted(false), leaveMs);
    return () => window.clearTimeout(timer);
  }, [show, leaveMs]);
  if (!mounted) return { mounted: false, cls: "" };
  return { mounted: true, cls: show ? "hg-fade-in" : "hg-fade-out" };
}
