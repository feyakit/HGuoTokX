// 按 docs/redesign/feature-inventory.json 点手机端新入口。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const steps = JSON.parse(readFileSync(new URL("../docs/redesign/feature-inventory.json", import.meta.url), "utf8"));
const titles = ["城市与晚风", "重逢在夏日以后"];
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
    localStorage.setItem("hghubx_app_v1", JSON.stringify({ likes: [], favs: [1], history: [], follows: [], searchHist: [] }));
    const cards = list.map((title, i) => ({
      id: i + 1, title, cover: `https://fixture.invalid/poster/${i}`, tags: ["都市"], score: 8,
      episode_count: 12, total_episodes: 12, hot: 10, like_count: 10, collect_count: 10, comment_count: 1,
      is_finished: false, is_original: 0, description: title, counts: { like: 10, collect: 10, hot: 10, comment: 1 },
      author: { id: 1, name: "示例" },
    }));
    const pageData = { items: cards, pagination: { page: 1, pages: 1, size: 20, total: cards.length } };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback() { return 1; }, unregisterCallback() {},
      invoke(cmd, args = {}) {
        if (cmd === "app_boot") return Promise.resolve({ user: null, logged_in: false, base: "https://fixture.invalid", strict_security: true });
        if (cmd === "playback_log_status") return Promise.resolve({ enabled: false, path: null, error: null });
        if (cmd === "line_auto" || cmd === "line_state") return Promise.resolve({ base: "https://fixture.invalid", previous: "https://fixture.invalid", switched: false, pick: { tier: "main", ms: 1, reason: "fixture", candidates: [] } });
        if (cmd === "debug_log" || cmd === "set_text_interaction") return Promise.resolve();
        if (cmd === "api_feed" || cmd === "api_category" || cmd === "api_search" || cmd === "api_posts") return Promise.resolve(pageData);
        if (cmd === "api_rank") return Promise.resolve({ type: "hot", items: cards.map((card, index) => ({ ...card, rank: index + 1, video_id: card.id, metric_value: 10, metric_label: "热度" })) });
        if (cmd === "api_search_hot") return Promise.resolve({ items: cards.map(card => ({ video_id: card.id, title: card.title, plays: "1万" })) });
        if (cmd === "api_tags") return Promise.resolve({ categories: [{ name: "题材", tags: [{ id: 1, name: "都市", slug: "city" }] }] });
        if (cmd === "api_topics") return Promise.resolve({ items: [{ id: 1, title: "本周精选", slug: "weekly", cover: cards[0].cover, intro: "", video_count: 1 }], pagination: pageData.pagination });
        if (cmd === "api_video") return Promise.resolve({ ...cards[0], episodes: [{ ep_num: 1, title: "", duration: 90, status: 1 }] });
        if (cmd === "api_play") return Promise.resolve({ id: args.id, ep_num: args.ep, duration: 90, title: "", video_url: "" });
        if (cmd === "check_update") return Promise.resolve({ has_update: false, current: "3.1.0", url: "" });
        return Promise.resolve(null);
      },
    };
  }, titles);
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    if (url.includes("/img")) return route.fulfill({ contentType: "image/svg+xml", headers: { "Access-Control-Allow-Origin": "*" }, body: "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'/>" });
    return route.abort();
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "看全集", exact: false }).first().waitFor({ timeout: 15000 });
  const nav = page.getByRole("navigation", { name: "主导航" });
  for (const step of steps) {
    if (step.nav) await nav.getByRole("button", { name: step.nav, exact: true }).click();
    if (step.click) await page.getByRole("button", { name: step.click, exact: false }).first().click();
    if (step.clickRole) await page.getByRole(step.clickRole[0], { name: step.clickRole[1], exact: true }).first().click();
    if (step.see) await page.getByText(step.see, { exact: false }).first().waitFor();
    if (step.seeRole) await page.getByRole(step.seeRole[0], { name: step.seeRole[1], exact: true }).first().waitFor();
    if (step.heading) await page.getByRole("heading", { name: step.heading, exact: true }).waitFor();
    if (step.close) await page.getByRole("button", { name: step.close, exact: true }).click();
    if (step.back) await page.getByRole("button", { name: "返回", exact: true }).click();
    console.log("ok", step.id);
  }
  assert.equal(steps.length >= 15, true);
  console.log(JSON.stringify({ passed: true, steps: steps.length }));
} finally {
  await browser?.close();
  await vite?.close();
}
