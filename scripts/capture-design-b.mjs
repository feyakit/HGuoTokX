// 用本地夹具把 B 方案各页截下来。不访问上游。
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = "/opt/cursor/artifacts";
await mkdir(out, { recursive: true });
const titles = ["闪婚厚爱", "凤临天下", "重生之女王", "山海引"];
const covers = [
  ["#0f262e", "#54b5d4", "#c45aa0"],
  ["#2e120f", "#d25f56", "#d2a756"],
  ["#101828", "#8ea4d4", "#f2f2f4"],
  ["#10241c", "#5e9a78", "#d2c48c"],
].map(([bg, glow, spot]) => `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="360" height="640"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${bg}"/><stop offset="1" stop-color="${glow}"/></linearGradient></defs><rect width="360" height="640" fill="url(#g)"/><circle cx="230" cy="210" r="70" fill="${spot}"/></svg>`);

let vite, browser;
try {
  vite = await createServer({ root, server: { host: "127.0.0.1", port: 0 } });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || "/usr/bin/google-chrome" });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  });
  await page.addInitScript(list => {
    localStorage.setItem("hghubx_usage_agreement", JSON.stringify({ version: "2026-11-15-v1", accepted: true, acceptedAt: "2026-11-15T00:00:00.000Z" }));
    localStorage.setItem("hghubx_theme", "dark");
    localStorage.setItem("hghubx_app_v1", JSON.stringify({
      likes: [1], favs: [1, 2], history: [{ id: 1, ep: 12, t: 42, dur: 118, at: 1 }, { id: 2, ep: 30, t: 10, dur: 90, at: 2 }],
      follows: [], searchHist: [],
    }));
    const cards = list.map((title, i) => ({
      id: i + 1, title, cover: `https://fixture.invalid/poster/${i}`, tags: i % 2 ? ["古装", "权谋"] : ["都市", "甜宠"],
      score: 8.6, episode_count: 80, total_episodes: 80, hot: 128000, like_count: 128000, collect_count: 32000,
      comment_count: 10, is_finished: false, is_original: 0, description: "界面预览",
      counts: { like: 128000, collect: 32000, hot: 128000, comment: 10 },
    }));
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(cb) { return 1; },
      unregisterCallback() {},
      invoke(cmd, args = {}) {
        const page = { items: cards, pagination: { page: 1, pages: 1, size: 20, total: cards.length } };
        if (cmd === "app_boot") return Promise.resolve({ user: null, logged_in: false, base: "https://fixture.invalid", strict_security: true });
        if (cmd === "playback_log_status") return Promise.resolve({ enabled: false, path: null, error: null });
        if (cmd === "line_auto") return Promise.resolve({ base: "https://fixture.invalid", previous: "https://fixture.invalid", switched: false, pick: { tier: "main", ms: 1, reason: "fixture", candidates: [] } });
        if (cmd === "debug_log" || cmd === "set_text_interaction") return Promise.resolve();
        if (cmd === "api_feed" || cmd === "api_category" || cmd === "api_original_videos" || cmd === "api_search") return Promise.resolve(page);
        if (cmd === "api_rank") return Promise.resolve({ type: "hot", items: cards.map((card, index) => ({ ...card, rank: index + 1, video_id: card.id, metric_value: card.hot, metric_label: "热度" })) });
        if (cmd === "api_search_hot") return Promise.resolve({ items: cards.map(card => ({ video_id: card.id, title: card.title, plays: "12.8万" })) });
        if (cmd === "api_tags") return Promise.resolve({ categories: [{ name: "题材", tags: [{ id: 1, name: "都市", slug: "city" }] }] });
        if (cmd === "api_video") {
          const card = cards[(args.id - 1) % cards.length];
          return Promise.resolve({ ...card, episodes: Array.from({ length: 80 }, (_, n) => ({ ep_num: n + 1, title: "", duration: 90, status: 1 })) });
        }
        if (cmd === "api_play") return Promise.resolve({ id: args.id, ep_num: args.ep, duration: 90, title: "", video_url: "https://fixture.invalid/none.m3u8" });
        return Promise.resolve(null);
      },
    };
  }, titles);
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    if (url.includes("/img")) {
      const index = Number(new URL(url).searchParams.get("u")?.match(/poster\/(\d)/)?.[1] || 0);
      return route.fulfill({ body: covers[index % covers.length], contentType: "image/svg+xml", headers: { "Access-Control-Allow-Origin": "*" } });
    }
    return route.abort();
  });
  await page.goto(origin);
  const watch = page.getByRole("button", { name: /看全集|继续看第/ }).first();
  await watch.waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/01-feed.png` });
  await watch.click();
  await page.getByRole("button", { name: "选集 全80集 ›", exact: true }).first().waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/02-series.png` });
  await page.getByRole("button", { name: "选集 全80集 ›", exact: true }).first().click();
  await page.getByRole("dialog", { name: "选集" }).waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/03-episodes.png` });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "剧场", exact: true }).click();
  await page.getByRole("heading", { name: "剧场", exact: true }).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/04-theater.png` });
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "追剧", exact: true }).click();
  await page.getByRole("heading", { name: "追剧", exact: true }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/05-follow.png` });
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "我的", exact: true }).click();
  await page.getByRole("button", { name: "检查更新", exact: true }).waitFor();
  await page.screenshot({ path: `${out}/06-me.png` });
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: "刷剧", exact: true }).click();
  const stage = page.locator("[data-short-feed]");
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/07-hold.png` });
  await page.mouse.up();
  console.log("captured", out);
} finally {
  await browser?.close();
  await vite?.close();
}
