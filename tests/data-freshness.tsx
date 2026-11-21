/**
 * 数据实时性用例（真 React 页面 + 真 api.call，只 mock Tauri IPC）。
 *
 * 目的：把「数据不实时」的链路变成可复现的数字——
 *  1. 进页 → 首次请求 cmd/args → 是否命中内存缓存（调用次数）；
 *  2. 下拉刷新（首页/吃瓜/分类/榜单四处）→ 是否用同一组参数真的重新出网（绕过读缓存）；
 *  3. 吃瓜切 tab → 请求参数变化 + 首条内容变化；
 *  4. 详情/搜索/历史三处「不做下拉」→ 手势不接管，静默刷新照常；
 *  5. api 层命中缓存时是否同时补一次后台请求（SWR 真生效）。
 *
 * 版本号 `version` 每 bump 一次，fixture 返回的 id/标题就变一批，
 * 页面显示 "feed v2" 就证明它真的换成了第 2 批数据，而不是复用旧的。
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Home from "../src/pages/Home";
import Category from "../src/pages/Category";
import { PostsPage } from "../src/pages/Posts";
import Search, { RankPage } from "../src/pages/Search";
import SeriesDetail from "../src/pages/SeriesDetail";
import { HistoryPage } from "../src/pages/Profile";
import { AppProvider } from "../src/store";
import { api, clearApiReadCache } from "../src/api";
import { ToastHost } from "../src/components/ui";
import "../src/index.css";

type Call = { cmd: string; args: Record<string, unknown>; at: number };
const calls: Call[] = [];
let version = 1;

type Video = Record<string, unknown>;
const video = (id: number, title: string): Video => ({
  id, title, cover: "https://fixture.invalid/poster.jpg", tags: ["都市"], score: 8.2, hot: 1000,
  episode_count: 10, total_episodes: 10, is_finished: 1, is_original: 0, is_hot: 0,
  like_count: 0, comment_count: 0, collect_count: 0, description: "",
  episodes: [{ ep_num: 1, title: "第1集" }, { ep_num: 2, title: "第2集" }],
  counts: { like: 1, comment: 2, collect: 3 },
});
const post = (id: number, title: string): Record<string, unknown> => ({
  id, title, cover: "https://fixture.invalid/post.jpg", desc: "", tags: ["黑料吃瓜"],
  author: { id: 7, name: "作者", avatar: "" }, counts: { like: 1, comment: 2, collect: 3 },
  hot: 10, publish_time: "2026-11-21 09:00:00",
});
const page = (items: unknown[], size: number, pages = 1, pageNo = 1) => ({
  items, pagination: { page: pageNo, pages, size, total: items.length },
});

const invoke = (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
  if (cmd === "app_boot") return Promise.resolve({ user: null, logged_in: false, base: "https://fixture.invalid" });
  if (cmd === "debug_log") return Promise.resolve();
  calls.push({ cmd, args, at: Date.now() });
  const v = version;
  switch (cmd) {
    case "api_feed":
      return Promise.resolve(page([video(1000 + v, `feed v${v}`), video(1001 + v, `feed-b v${v}`)], Number(args.size ?? 20), 3, Number(args.page ?? 1)));
    case "api_original_videos":
      return Promise.resolve(page([video(1100 + v, `orig v${v}`)], 10));
    case "api_rank":
      return Promise.resolve({ type: args.kind, items: [{
        video_id: 1200 + v, title: `rank ${String(args.kind)} v${v}`, cover: "https://fixture.invalid/r.jpg",
        score: 8.6, episode_count: 12, is_finished: 1, metric_value: 900, metric_label: "热度", rank: 1, tags: ["都市"],
      }] });
    case "api_topics":
      return Promise.resolve({ items: [] });
    case "api_blog_posts":
      return Promise.resolve(page([post(2000 + v, `blog v${v} cate=${args.cate ?? "all"}`)], 20, 2, Number(args.page ?? 1)));
    case "api_posts":
      return Promise.resolve(page([post(2100 + v, `posts v${v} sort=${args.sort ?? "null"}`)], 20, 2, Number(args.page ?? 1)));
    case "api_post_category":
      return Promise.resolve(page([post(2200 + v, `route ${String(args.route)} v${v}`)], 20, 2, Number(args.page ?? 1)));
    case "api_post":
      return Promise.resolve({ ...post(Number(args.id), `detail ${String(args.id)}`), content: "正文" });
    case "api_video":
      return Promise.resolve(video(Number(args.id), `video ${String(args.id)} v${v}`));
    case "api_related":
      return Promise.resolve({ items: [video(1300 + v, `rel v${v}`)] });
    case "api_search":
      return Promise.resolve({ items: [video(1400 + v, `search v${v}`)], pagination: { page: 1, pages: 1, size: 20, total: 1 }, keyword: String(args.q ?? "") });
    case "api_search_hot":
      return Promise.resolve({ items: [{ video_id: 1500 + v, title: `hot v${v}`, plays: "1.2万" }] });
    case "api_post_categories":
      return Promise.resolve({ items: [] });
    case "api_tags":
      return Promise.resolve({ categories: [] });
    default:
      return Promise.reject(`Unexpected IPC: ${cmd}`);
  }
};

const fixture = {
  calls,
  ready: false,
  setActive: (_active: boolean) => {},
  version: () => version,
  bump() { version += 1; return version; },
  resetCalls() { calls.length = 0; },
  /* api 层单测入口：直接走真 api.call（缓存命中 / force 绕过） */
  apiFeed: (force = false) => api.feed(1, 21, undefined, force),
  clearCache: () => clearApiReadCache(),
};

Object.assign(window, { dfFixture: fixture, __TAURI_INTERNALS__: { invoke } });

const frame = (children: React.ReactNode) => (
  <div style={{ position: "relative", width: 420, height: 900 }}>{children}</div>
);

function Fixture() {
  const [active, setActive] = useState(true);
  fixture.setActive = setActive;
  fixture.ready = true;
  const which = new URLSearchParams(location.search).get("page") || "home";
  const body = which === "api" ? <div id="api-only" />
    : which === "category" ? frame(<Category wide={false} active={active} />)
      : which === "posts" ? frame(<PostsPage embedded active={active} />)
        : which === "rank" ? frame(<RankPage wide={false} onBack={() => {}} />)
          : which === "detail" ? frame(<SeriesDetail id={7} onBack={() => {}} />)
            : which === "search" ? frame(<Search active wide={false} onBack={() => {}} />)
              : which === "history" ? frame(<HistoryPage wide={false} onBack={() => {}} />)
                : frame(<Home active={active} bottomInset={0} />);
  return <AppProvider>{body}<ToastHost /></AppProvider>;
}

createRoot(document.querySelector("#root")!).render(<Fixture />);
