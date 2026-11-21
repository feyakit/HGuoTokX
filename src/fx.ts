/**
 * 低端机降级：只保留点击反馈，关掉页面转场 / 大面积动画。
 *
 * 判定很保守（硬核线程数 ≤ 4 或内存 ≤ 2GB 才降级），宁可多给一点动画，
 * 也不要把正常机器误判成低端机。
 */
export function installFxLevel(): void {
  if (typeof document === "undefined") return;
  const cores = navigator.hardwareConcurrency || 8;
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  if (cores <= 4 || memory <= 2) document.documentElement.dataset.fx = "low";
}
