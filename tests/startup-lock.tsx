import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import StartupGate from "../src/app/startup/LaunchAnimation";
import "../src/index.css";

// 上游 0a66791 探针：启动锁 + 两阶段挂载。
// 真实 index.html 会在 <html> 上带 data-hg-launching 并把底色钉住；这里照做一遍，
// 然后检查：① 动画还在时 App 已经挂上（3.0.7 起的并行挂载不能被这次改动弄丢）；
// ② 动画结束时启动锁被摘掉（否则浅色主题永远被 !important 的深色底钉着）。
document.documentElement.setAttribute("data-hg-launching", "1");

type LockFixture = { childAt?: number; overlayAtChildMount?: boolean };
const lockFixture: LockFixture = {};
Object.assign(window, {
  isTauri: true,
  startupLockFixture: lockFixture,
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return 0; },
    unregisterCallback() {},
    invoke() { return Promise.resolve(null); },
  },
});

function Child() {
  useEffect(() => {
    lockFixture.childAt = performance.now();
    lockFixture.overlayAtChildMount = !!document.querySelector(".hg-launch");
  }, []);
  return <div data-app-mounted>主界面</div>;
}

createRoot(document.querySelector("#root")!).render(
  <StartupGate>
    <Child />
  </StartupGate>,
);
