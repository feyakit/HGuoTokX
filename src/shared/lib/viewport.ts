/**
 * 视口尺寸的唯一来源（CSS 变量）。
 *
 * 为什么需要：iOS WKWebView 在原生全屏/旋转过程中，`100vw / 100dvh` 这类**单位**
 * 有时仍按旋转前的竖屏视口解析（真机现象：系统已横过来 852×393，全屏层却还是 393 宽，
 * 画面只占左边 46%），而 `window.innerWidth/innerHeight` 是准的。
 * 所以把真实像素写进 `--vp-w / --vp-h`，全屏层用变量定位，不再依赖 vw/vh 单位。
 *
 * 更新时机：resize / orientationchange / visualViewport.resize，外加一次 rAF 兜底
 * （iOS 旋转完成与 resize 事件之间有一小段延迟）。
 */
const W = "--vp-w";
const H = "--vp-h";

export function applyViewportVars(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const w = Math.round(window.innerWidth || root.clientWidth || 0);
  const h = Math.round(window.innerHeight || root.clientHeight || 0);
  if (w > 0) root.style.setProperty(W, `${w}px`);
  if (h > 0) root.style.setProperty(H, `${h}px`);
}

let installed = false;

export function installViewportVars(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  applyViewportVars();
  const refresh = () => {
    applyViewportVars();
    requestAnimationFrame(applyViewportVars);
  };
  window.addEventListener("resize", refresh, { passive: true });
  window.addEventListener("orientationchange", refresh, { passive: true });
  window.visualViewport?.addEventListener("resize", refresh, { passive: true });
}
