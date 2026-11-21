import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "../src/shared/model/store";
import { FavoritesPage } from "../src/features/account/Profile";
import "../src/index.css";

// 上游 3622227 回归探针：收藏列表「从详情页返回」要静默重校验可见卡片，
// 但同一批 id 在「一次停留」里只重拉一次（否则重渲染会把服务器打满）。
const fixture = {
  calls: [] as number[],
  seq: 0,
};
Object.assign(window, {
  isTauri: true,
  favoritesFixture: fixture,
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return 0; },
    unregisterCallback() {},
    invoke(command: string, args: Record<string, unknown> = {}) {
      if (command === "app_boot") return Promise.resolve({ strict_security: true, base: "https://fixture.invalid", user: null });
      if (command === "debug_log" || command === "playback_log_write") return Promise.resolve();
      if (command === "playback_log_status") return Promise.resolve({ enabled: false, path: null, error: null });
      if (command === "api_video") {
        const id = Number(args.id);
        fixture.calls.push(id);
        return Promise.resolve({
          id, title: `收藏卡 ${id}`, cover: "", tags: [], score: 8.5, total_ep: 24,
          // 每次请求都换一个热值，用来证明返回列表拿的是新数据
          hot: ++fixture.seq,
        });
      }
      return Promise.resolve(null);
    },
  },
});

function Harness() {
  const [active, setActive] = useState(true);
  Object.assign(window, { favoritesSetActive: setActive });
  return <FavoritesPage onBack={() => {}} wide={false} initialTab="video" active={active} />;
}

createRoot(document.querySelector("#root")!).render(
  <AppProvider>
    <Harness />
  </AppProvider>,
);
