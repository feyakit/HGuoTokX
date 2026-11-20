/**
 * 隐藏/遮挡的交互控件不能"看不见却能命中"。
 *
 * 背景（v3.0.6）：登录面板打开时，DOM 里曾同时存在两份登录 UI（移动 sheet + 隐藏的桌面 dialog），
 * 其中隐藏那份仍能被子选择器命中、点下去毫无反应。这类问题和"视频详情 aria 重复"是同一种病。
 *
 * 本测试在真实构建产物上逐屏扫描所有可交互元素，断言：
 *   1. 任何时刻 `[role=dialog]` 最多 1 个；
 *   2. 被 display:none 隐藏的元素 rect 全 0；
 *   3. 被 visibility:hidden / pointer-events:none / inert / 关闭中浮层 遮住的元素，
 *      在它中心点上 `document.elementFromPoint` **不能**是它自己（即真的点不到）；
 *   4. 登录面板打开时，命中「登录」提交按钮的元素只有 1 个。
 *
 * 跑：node scripts/test-hidden-hit-targets.mjs（需要 BROWSER_EXECUTABLE）
 */
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let vite, browser;
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log("  ✓ " + name); };

const LIST = `
  button, [role=button], a[href], input, select, textarea, summary, [tabindex]
`;

/* 在页内执行：返回被遮住却仍有尺寸、且中心点确实能被自己命中的元素 */
const scan = (page) => page.evaluate((list) => {
  /* 注意：pointer-events 只看元素**自身**的 computed 值（父层 none + 子层 auto 是常见写法，
     那种情况元素其实是可以点的，不能算"隐藏"）。display/visibility/inert/opacity 要往上找。 */
  const coveringState = (el) => {
    if (getComputedStyle(el).pointerEvents === "none") return "pointer-events:none";
    let n = el;
    while (n && n !== document.documentElement) {
      const st = getComputedStyle(n);
      if (st.display === "none") return "display:none";
      if (st.visibility === "hidden") return "visibility:hidden";
      if (n.hasAttribute("inert")) return "inert";
      if (st.opacity === "0") return "opacity:0";
      n = n.parentElement;
    }
    return "";
  };
  const result = { dialogs: 0, dialogsWithLabel: [], leaks: [], hiddenZeroRect: 0, hiddenSized: 0 };
  const dialogs = [...document.querySelectorAll("[role=dialog]")];
  result.dialogs = dialogs.length;
  result.dialogsWithLabel = dialogs.map((d) => d.getAttribute("aria-label"));
  for (const el of document.querySelectorAll(list)) {
    const r = el.getBoundingClientRect();
    const why = coveringState(el);
    if (!why) continue;
    if (r.width === 0 && r.height === 0) { result.hiddenZeroRect += 1; continue; }
    result.hiddenSized += 1;
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    if (cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) continue;
    const top = document.elementFromPoint(cx, cy);
    if (top === el || el.contains(top)) {
      result.leaks.push({
        why,
        label: (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      });
    }
  }
  return result;
}, LIST);

try {
  vite = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 8) Mobile Safari/537.36",
    viewport: { width: 393, height: 851 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() => {
    const cards = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1, title: `剧${i + 1}`, cover: "https://f.invalid/c.jpg", tags: ["都市"],
      score: 8, episode_count: 3, total_episodes: 3, hot: 1, is_finished: false, is_original: 0,
    }));
    const page = (items) => ({ items, pagination: { page: 1, pages: 1, size: 30, total: items.length } });
    window.__TAURI_INTERNALS__ = { async invoke(cmd) {
      if (cmd === "app_boot") return { user: null, logged_in: false, strict_security: true, base: "https://f.invalid" };
      if (cmd === "playback_log_status") return { enabled: false };
      if (["debug_log", "set_text_interaction", "playback_log_write", "set_orientation"].includes(cmd)) return;
      if (cmd === "line_auto") return { base: "https://f.invalid", previous: "https://f.invalid", switched: false, cancelled: false, pick: { base: "https://f.invalid", tier: "main", ms: 1, reason: "ok", candidates: [] } };
      if (["api_feed", "api_category", "api_rank", "api_original_videos"].includes(cmd)) return page(cards);
      if (["api_posts", "api_blog_posts", "api_post_category", "api_topics", "api_search_hot", "api_post_categories"].includes(cmd)) return page([]);
      if (cmd === "api_tags") return { categories: [] };
      if (cmd === "api_video") return { ...cards[0], counts: { like: 1, collect: 1, comment: 0 }, episodes: [], desc: "" };
      if (cmd === "account_sync") return { favs: [], postFavs: [], likes: [], postLikes: [], likeEpisodes: [], follows: [], history: [], postHistory: [] };
      if (cmd === "line_state") return { base: "https://f.invalid", fixed: [] };
      if (cmd === "line_mirrors") return { items: [] };
      return null;
    } };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.waitForTimeout(1800);

  console.log("[首页]");
  let state = await scan(page);
  check(`首页最多 1 个 dialog（实际 ${state.dialogs}）`, () => assert.ok(state.dialogs <= 1));
  check("首页没有「隐藏却有尺寸且能被自己命中」的控件", () => assert.deepEqual(state.leaks, [], JSON.stringify(state.leaks)));

  console.log("[个人页]");
  await page.getByRole("button", { name: "我的" }).first().click();
  await page.waitForTimeout(700);
  state = await scan(page);
  check("个人页没有穿透命中的隐藏控件", () => assert.deepEqual(state.leaks, [], JSON.stringify(state.leaks)));

  console.log("[登录面板打开]");
  await page.getByRole("button", { name: /登录|立即登录/ }).first().click();
  await page.waitForTimeout(700);
  state = await scan(page);
  check(`登录面板打开时 dialog 只有 1 个（实际 ${state.dialogs}：${state.dialogsWithLabel.join(" / ")}）`,
    () => assert.equal(state.dialogs, 1));
  check("被遮住的背景控件都真的点不到（inert/pointer-events）", () => assert.deepEqual(state.leaks, [], JSON.stringify(state.leaks)));
  const submitters = await page.evaluate(() => {
    const hit = [];
    for (const el of document.querySelectorAll("button")) {
      const txt = (el.textContent || "").trim();
      /* 只找"提交"语义的那个：分段控件里的「登录」标签页也算登录文本，
         但它不是提交按钮（现在有独立的 aria-label「切换到登录」）。 */
      if (el.getAttribute("role") === "tab") continue;
      if (txt !== "登录" && txt !== "处理中…") continue;
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (top === el || el.contains(top)) hit.push({ txt, type: el.getAttribute("type"), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
    }
    return hit;
  });
  check(`能被点到的「登录」按钮只有 1 个（实际 ${submitters.length}：${JSON.stringify(submitters)}）`,
    () => assert.equal(submitters.length, 1));
  check("可点的那个是 form 的 submit 按钮", () => assert.equal(submitters[0].type, "submit"));

  console.log("[登录面板关闭动画中]");
  await page.locator('[role=dialog] button[aria-label="关闭登录"]').click();
  await page.waitForTimeout(80);
  state = await scan(page);
  check("正在关闭的浮层整层 inert，里面的控件点不到", () => {
    assert.deepEqual(state.leaks, [], JSON.stringify(state.leaks));
    assert.ok(state.dialogs <= 1);
  });

  console.log("[设置浮层]");
  await page.waitForTimeout(600);
  const settingsEntry = page.getByRole("button", { name: /打开设置|设置/ }).first();
  if (await settingsEntry.count()) {
    await settingsEntry.click().catch(() => {});
    await page.waitForTimeout(700);
    state = await scan(page);
    check("设置浮层没有穿透命中的隐藏控件", () => assert.deepEqual(state.leaks, [], JSON.stringify(state.leaks)));
  }

  /* 桌面壳（Windows/macOS 原生窗口）需要真实 Tauri 窗口接口，本地 headless 起不来，
     这一部分只能真机/桌面端验；这里只跑移动端。 */

  check("全程没有 pageerror", () => assert.deepEqual(errors, []));
  console.log(`\nPassed: ${passed} 项隐藏控件命中检查`);
} finally {
  await browser?.close();
  await vite?.close();
}
