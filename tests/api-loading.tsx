import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Home from "../src/features/feed/Home";
import Category from "../src/features/category/Category";
import { AppProvider } from "../src/shared/model/store";
import "../src/index.css";

type Request = { cmd: string; args: Record<string, unknown>; resolve: (value: unknown) => void; reject: (error: string) => void };
const pending: Request[] = [];
const fixture = {
  history: [] as { cmd: string; args: Record<string, unknown> }[],
  debug: [] as string[],
  ready: false,
  setActive: (_active: boolean) => {},
  /* 首页现在并发两条 api_feed（信息流 + 「最新上架」横滑），用例不能再假设「只有一条挂起」。 */
  pendingCount(cmd: string, key = "") { return pending.filter(r => r.cmd === cmd && (!key || r.args.cate === key)).length; },
  /* 分类页激活时两种 api_feed 混在一起：二级 chips 用 size=30 拉 3 页、网格首页 size=24，
     所以按 size 区分，别用「第几个请求」这种顺序假设。 */
  pendingCountBySize(cmd: string, size: number) { return pending.filter(r => r.cmd === cmd && r.args.size === size).length; },
  completeBySize(cmd: string, size: number, result: "404" | "503" | "empty" | "item") {
    const index = pending.findIndex(r => r.cmd === cmd && r.args.size === size);
    if (index < 0) throw new Error(`No pending request: ${cmd} size=${size}`);
    const request = pending.splice(index, 1)[0];
    if (result === "404" || result === "503") { request.reject(`HTTP ${result} Gateway: <html><h1>nginx error</h1></html>`); return; }
    request.resolve({ items: result === "empty" ? [] : [{ id: 992, title: `已加载${cmd}`, cover: "https://fixture.invalid/poster/992.jpg", tags: [], score: 0, hot: 0,
      episode_count: 1, total_episodes: 1, is_finished: true, is_original: 0, like_count: 0, comment_count: 0, collect_count: 0 }],
      pagination: { page: 1, pages: 1, size, total: result === "empty" ? 0 : 1 } });
  },
  complete(cmd: string, key: string, result: "404" | "503" | "empty" | "item") {
    const index = pending.findIndex(r => r.cmd === cmd && (!key || r.args.cate === key));
    if (index < 0) throw new Error(`No pending request: ${cmd}/${key}`);
    const request = pending.splice(index, 1)[0];
    if (result === "404" || result === "503") {
      request.reject(`HTTP ${result} Gateway: <html><h1>nginx error</h1></html>`);
      return;
    }
    request.resolve({
      items: result === "empty" ? [] : [{
        id: 991, title: `已加载${key || cmd}`, cover: "https://fixture.invalid/poster/991.jpg", tags: [], score: 0, hot: 0,
        episode_count: 1, total_episodes: 1, is_finished: true, is_original: 0,
        like_count: 0, comment_count: 0, collect_count: 0,
      }],
      pagination: { page: 1, pages: 1, size: 8, total: result === "empty" ? 0 : 1 },
    });
  },
};

// Preserve the real api.call error formatting and React pages; replace only Tauri IPC.
Object.assign(window, {
  apiLoadingFixture: fixture,
  __TAURI_INTERNALS__: { invoke(cmd: string, args: Record<string, unknown> = {}) {
    if (cmd === "app_boot") return Promise.resolve({ user: null, logged_in: false, base: "https://fixture.invalid" });
    if (cmd === "debug_log") { fixture.debug.push(String(args.msg)); return Promise.resolve(); }
    if (!["api_feed", "api_category", "api_original_videos", "api_post_category"].includes(cmd)) return Promise.reject(`Unexpected IPC: ${cmd}`);
    fixture.history.push({ cmd, args });
    return new Promise((resolve, reject) => pending.push({ cmd, args, resolve, reject }));
  } },
});

function Fixture() {
  const [active, setActive] = useState(false);
  fixture.setActive = setActive;
  fixture.ready = true;
  const home = new URLSearchParams(location.search).get("page") === "home";
  return <AppProvider>
    <div style={{ position: "relative", width: 900, height: 1000 }}>
      {home ? <Home active bottomInset={0} /> : <Category wide active={active} />}
    </div>
  </AppProvider>;
}
createRoot(document.querySelector("#root")!).render(<React.StrictMode><Fixture /></React.StrictMode>);
