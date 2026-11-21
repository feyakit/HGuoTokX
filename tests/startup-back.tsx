import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import StartupGate from "../src/app/startup/LaunchAnimation";
import { addPluginListener } from "@tauri-apps/api/core";
import { runBack } from "../src/shared/lib/back";
import "../src/index.css";

// 上游 4dd7844 探针：启动动画期间 App 已经挂载（3.0.7 起），返回键必须只属于动画。
// 真实 Tauri 会把 back-button 广播给所有注册的监听，所以这里也保留全部监听并逐个回调，
// 「只存最后一个监听」的夹具正是当年漏掉这个 bug 的原因。
const fixture = {
  backHandlers: [] as { id: number; onmessage: (e: unknown) => void }[],
  exits: 0,
  runs: 0,
  idSeed: 0,
};
Object.assign(window, {
  isTauri: true,
  startupBackFixture: fixture,
  pressBack() {
    for (const channel of [...fixture.backHandlers]) channel.onmessage({});
  },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return ++fixture.idSeed; },
    unregisterCallback() {},
    invoke(command: string, args: Record<string, unknown> = {}) {
      if (command === "app_boot") return Promise.resolve({ strict_security: true, base: "https://fixture.invalid", user: null });
      if (command === "debug_log" || command === "playback_log_write") return Promise.resolve();
      if (command === "playback_log_status") return Promise.resolve({ enabled: false, path: null, error: null });
      if (command === "plugin:app|register_listener" && args.event === "back-button") {
        const handler = args.handler as { id: number; onmessage: (e: unknown) => void };
        fixture.backHandlers.push(handler);
        return 1;
      }
      if (command === "plugin:app|remove_listener" && args.event === "back-button") {
        const index = fixture.backHandlers.findIndex(item => item.id === args.channelId);
        if (index !== -1) fixture.backHandlers.splice(index, 1);
        return null;
      }
      if (command === "plugin:app|exit") { fixture.exits += 1; return null; }
      return null;
    },
  },
});

/** 模仿真实 App 的返回处理：先给浮层/栈（runBack），没人消费才退应用。 */
function AppLike() {
  useEffect(() => {
    let disposed = false;
    let handle: { unregister: () => Promise<void> } | null = null;
    void addPluginListener("app", "back-button", () => {
      fixture.runs += 1;
      if (runBack()) return;
      void (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => unknown } })
        .__TAURI_INTERNALS__.invoke("plugin:app|exit", { code: 0 });
    }).then(h => { if (disposed) void h.unregister(); else handle = h; });
    return () => { disposed = true; void handle?.unregister(); };
  }, []);
  return <div data-app-mounted style={{ padding: 20 }}>主界面已挂载</div>;
}

createRoot(document.querySelector("#root")!).render(
  <StartupGate>
    <AppLike />
  </StartupGate>,
);
