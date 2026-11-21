import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider, useStore } from "../src/shared/model/store";
import "../src/index.css";

// 探针：真实 AppProvider + 假 IPC，专门盯住「切线后登录态由 boot 裁决」这条契约
// （上游 12f1968 + 589b0fb）。bootDelay 让「先 setUser(null) 再等 boot」的旧写法
// 在若干帧里暴露出来；旧代码 hg:line-changed 会立刻 setUser(null)，真机上一眼能看到闪断。
const MAIN = "https://main.fixture.invalid";
const MIRROR = "https://mirror-one.fixture.invalid";
const fixture = {
  base: MAIN,
  loggedIn: true,
  userId: 17,
  bootDelay: 0,
  boots: 0,
  seen: [] as (number | null)[],
};
Object.assign(window, {
  isTauri: true,
  lineSessionFixture: fixture,
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return 0; },
    unregisterCallback() {},
    async invoke(command: string, _args: Record<string, unknown> = {}) {
      if (command === "app_boot") {
        fixture.boots += 1;
        if (fixture.bootDelay) await new Promise(resolve => setTimeout(resolve, fixture.bootDelay));
        return {
          strict_security: true,
          base: fixture.base,
          user: fixture.loggedIn ? { id: fixture.userId, username: "fixture-user", nickname: "夹具用户" } : null,
        };
      }
      if (command === "debug_log" || command === "playback_log_write") return;
      if (command === "playback_log_status") return { enabled: false, path: null, error: null };
      return null;
    },
  },
});

function Probe() {
  const store = useStore();
  useEffect(() => {
    fixture.seen.push(store.user ? store.user.id : null);
    Object.assign(window, { lineSessionSnapshot: { user: store.user, lineEpoch: store.lineEpoch, ready: store.strictSecurityReady } });
  }, [store]);
  return null;
}

createRoot(document.querySelector("#root")!).render(
  <AppProvider>
    <Probe />
  </AppProvider>,
);
