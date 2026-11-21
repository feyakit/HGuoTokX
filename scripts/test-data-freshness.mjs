// 数据实时性验收：真 React 页面 + 真 api.call，只 mock Tauri IPC（本地 chromium = CDP 驱动）。
// 断言口径：请求次数（是否真的出网）、请求参数是否与首次一致（绕过的是读缓存，不改 URL）、
// 页面上的数据版本（v1 → v2 是否换新）、toast 反馈、不该有下拉的页面手势不接管。
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "test-results", "data-freshness", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const report = { transport: "local chromium (CDP) + mocked Tauri IPC", passed: [], failed: [], data: {} };
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

let vite, browser, page;
const calls = () => page.evaluate(() => window.dfFixture.calls);
const of = (rows, cmd, match = {}) => rows.filter(r => r.cmd === cmd && Object.entries(match).every(([k, v]) => JSON.stringify(r.args[k]) === JSON.stringify(v)));
const bump = () => page.evaluate(() => window.dfFixture.bump());
const setActive = async (on) => {
  await page.evaluate(v => window.dfFixture.setActive(v), on);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
};
const tick = async (ms = 400) => { await page.clock.fastForward(ms); await page.evaluate(() => new Promise(r => requestAnimationFrame(r))); };

/* 下拉刷新：在滚动容器上派发真实 Touch 事件（dy=140 × 0.5 阻尼 = 70px > 64px 阈值） */
async function pull(dx = 0) {
  await page.evaluate((sideways) => {
    const el = document.querySelector("#root .scroll-y");
    if (!el) throw new Error("no scroll container");
    el.scrollTop = 0;
    const touch = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
    const send = (type, x, y) => {
      const t = touch(x, y);
      const empty = type === "touchend" || type === "touchcancel";
      el.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: empty ? [] : [t], targetTouches: empty ? [] : [t], changedTouches: [t],
      }));
    };
    send("touchstart", 120, 200);
    send("touchmove", 120 + sideways / 2, 250);
    send("touchmove", 120 + sideways, 340);
    send("touchend", 120 + sideways, 340);
  }, dx);
  await tick(600);
}

const hasPullUi = () => page.evaluate(() => !!document.querySelector(".hg-pull, .hg-pull-spin"));

async function step(name, fn) {
  try { await fn(); report.passed.push(name); }
  catch (e) { report.failed.push({ name, error: e.message }); throw e; }
}

try {
  vite = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, userAgent: MOBILE_UA, hasTouch: true });
  page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.clock.install({ time: new Date("2026-11-21T10:00:00+08:00") });
  await page.route("**/*", route => {
    const url = route.request().url();
    if (new URL(url).host === new URL(origin).host || url.startsWith("http://hg.localhost") || url.startsWith("http://127.0.0.1:17650")) return route.continue();
    return route.abort();
  });

  /* ───────────── ① 首页三 tab ───────────── */
  await page.goto(`${origin}tests/data-freshness.html?page=home`);
  await page.waitForFunction(() => window.dfFixture.ready);
  await page.waitForFunction(() => window.dfFixture.calls.some(c => c.cmd === "api_feed"));

  await step("首页进页：首屏只发 1 次 api_feed(page=1,size=21)，显示 v1", async () => {
    const feeds = of(await calls(), "api_feed", { page: 1, size: 21 });
    report.data.homeFirst = feeds.map(f => f.args);
    assert.equal(feeds.length, 1, `api_feed page1 应只发 1 次，实际 ${feeds.length}`);
    await page.getByText("feed v1", { exact: true }).first().waitFor();
  });

  await step("首页 30s 内切回：不发请求（用现成数据）", async () => {
    await setActive(false); await tick(300); await setActive(true); await tick(300);
    const feeds = of(await calls(), "api_feed", { page: 1, size: 21 });
    report.data.homeRevisitUnder30s = feeds.length;
    assert.equal(feeds.length, 1, `30s 内重进不该重新请求，实际 ${feeds.length}`);
  });

  await step("首页 31s 后切回：force 重拉（带 refresh=true），列表原地换成 v2", async () => {
    await bump();
    await page.clock.fastForward(31_000);
    await setActive(false); await tick(300); await setActive(true); await tick(600);
    const feeds = of(await calls(), "api_feed", { page: 1, size: 21 });
    report.data.homeRevisitAfter31s = feeds.map(f => f.args);
    assert.equal(feeds.length, 2, `31s 后重进应补 1 次真实请求，实际 ${feeds.length}`);
    assert.deepEqual(feeds[1].args, feeds[0].args, "重拉必须是同一组参数（绕过的是读缓存，不是改 URL）");
    await page.getByText("feed v2", { exact: true }).first().waitFor({ timeout: 5000 });
  });

  await step("首页下拉刷新：带 refresh=true 再发 1 次 → v3 + toast「已同步官网」", async () => {
    await bump();
    await pull();
    const feeds = of(await calls(), "api_feed", { page: 1, size: 21 });
    report.data.homePullRefresh = feeds.map(f => f.args);
    assert.equal(feeds.length, 3, `下拉刷新应再发 1 次，实际 ${feeds.length}`);
    assert.deepEqual(feeds[2].args, feeds[0].args, "下拉刷新用同一组参数重新出网（绕过读缓存）");
    await page.getByText("feed v3", { exact: true }).first().waitFor({ timeout: 5000 });
    await page.getByText("已同步官网", { exact: true }).first().waitFor({ timeout: 3000 });
  });

  await step("首页下拉不误触左右滑切页（斜向 60/140 竖向优先）", async () => {
    const before = await page.locator('[role="tab"][aria-selected="true"]').first().innerText();
    await bump();
    await pull(60);
    const after = await page.locator('[role="tab"][aria-selected="true"]').first().innerText();
    const feeds = of(await calls(), "api_feed", { page: 1, size: 21 });
    report.data.homeDiagonalPull = { before, after, calls: feeds.length };
    assert.equal(before, after, `下拉不应切换首页分栏（${before} → ${after}）`);
    assert.equal(feeds.length, 4, "斜向下拉仍应触发刷新");
  });

  await step("首页切到「上新」：只刷当前 tab（api_feed sort=new）", async () => {
    await page.getByRole("tab", { name: "上新", exact: true }).click();
    await page.waitForFunction(() => window.dfFixture.calls.some(c => c.cmd === "api_feed" && c.args.sort === "new"));
    const rows = of(await calls(), "api_feed", { sort: "new", page: 1 });
    report.data.homeNewTab = rows.map(r => r.args);
    assert(rows.length >= 1, "上新 tab 必须发 api_feed(sort=new)");
  });

  /* ───────────── ③ 分类 ───────────── */
  await page.goto(`${origin}tests/data-freshness.html?page=category`);
  await page.waitForFunction(() => window.dfFixture.ready);
  await page.waitForFunction(() => window.dfFixture.calls.some(c => c.cmd === "api_feed" && c.args.size === 24));

  await step("分类进页 1 次 api_feed(size=24)；30s 内重进不重拉", async () => {
    const before = of(await calls(), "api_feed", { size: 24 }).length;
    await setActive(false); await tick(300); await setActive(true); await tick(300);
    const after = of(await calls(), "api_feed", { size: 24 }).length;
    report.data.categoryRevisitUnder30s = { before, after };
    assert.equal(before, 1, `分类首屏应 1 次请求，实际 ${before}`);
    assert.equal(after, before, "30s 内重进不该重拉");
  });

  await step("分类下拉刷新：带 refresh=true 再发 1 次", async () => {
    await bump();
    await pull();
    const rows = of(await calls(), "api_feed", { size: 24 });
    report.data.categoryPull = rows.map(r => r.args);
    assert.equal(rows.length, 2, `下拉应再发 1 次，实际 ${rows.length}`);
    assert.deepEqual(rows[1].args, rows[0].args, "下拉刷新用同一组参数重新出网");
  });

  /* ───────────── ④ 吃瓜 ───────────── */
  await page.goto(`${origin}tests/data-freshness.html?page=posts`);
  await page.waitForFunction(() => window.dfFixture.ready);
  await page.waitForFunction(() => window.dfFixture.calls.some(c => c.cmd === "api_blog_posts"));

  await step("吃瓜进页：api_blog_posts(cate=null,page=1)，显示 v1", async () => {
    const rows = of(await calls(), "api_blog_posts", { cate: null, page: 1 });
    report.data.postsFirst = rows.map(r => r.args);
    assert.equal(rows.length, 1, `吃瓜首屏应 1 次请求，实际 ${rows.length}`);
    await page.getByText("blog v1 cate=all", { exact: true }).first().waitFor();
  });

  await step("吃瓜切「最热」：请求换成 api_posts(sort=trending)，首条内容变化", async () => {
    await page.getByRole("tab", { name: "最热", exact: true }).click();
    await page.waitForFunction(() => window.dfFixture.calls.some(c => c.cmd === "api_posts"));
    const rows = of(await calls(), "api_posts", { sort: "trending", page: 1 });
    report.data.postsTrending = rows.map(r => r.args);
    assert(rows.length >= 1, "切「最热」必须发 api_posts(sort=trending)");
    await page.getByText("posts v1 sort=trending", { exact: true }).first().waitFor();
  });

  await step("吃瓜切「黑料吃瓜」（最热下走分类接口 route=remen-chigua）", async () => {
    await page.getByRole("tab", { name: "黑料吃瓜", exact: true }).click();
    await page.waitForFunction(() => window.dfFixture.calls.some(c => c.cmd === "api_post_category" && c.args.route === "remen-chigua"));
    const rows = of(await calls(), "api_post_category", { route: "remen-chigua" });
    report.data.postsGossipTrending = rows.map(r => r.args);
    assert(rows.length >= 1, "黑料+最热必须发 api_post_category(remen-chigua)");
  });

  await step("吃瓜切回「最新」：请求换成 api_blog_posts(cate=gossip)", async () => {
    await page.getByRole("tab", { name: "最新", exact: true }).click();
    await page.waitForFunction(() => window.dfFixture.calls.some(c => c.cmd === "api_blog_posts" && c.args.cate === "gossip"));
    const rows = of(await calls(), "api_blog_posts", { cate: "gossip", page: 1 });
    report.data.postsGossipLatest = rows.map(r => r.args);
    assert(rows.length >= 1, "黑料+最新必须发 api_blog_posts(cate=gossip)");
    await page.getByText("blog v1 cate=gossip", { exact: true }).first().waitFor();
  });

  await step("吃瓜下拉刷新：带 refresh=true 再发 1 次", async () => {
    await bump();
    await pull();
    const rows = of(await calls(), "api_blog_posts", { cate: "gossip", page: 1 });
    report.data.postsPull = rows.map(r => r.args);
    assert.equal(rows.length, 2, `吃瓜下拉应再发 1 次，实际 ${rows.length}`);
    assert.deepEqual(rows[1].args, rows[0].args, "吃瓜下拉用同一组参数重新出网");
  });

  await step("吃瓜 5s 内返回再进：复用现成列表", async () => {
    const before = (await calls()).length;
    await setActive(false); await tick(300); await setActive(true); await tick(300);
    report.data.postsRevisitUnder5s = { before, after: (await calls()).length };
    assert.equal((await calls()).length, before, "5s 内返回再进不该重新请求");
  });

  await step("吃瓜回前台（>30s）：visibilitychange 触发静默请求", async () => {
    await page.clock.fastForward(31_000);
    const before = of(await calls(), "api_blog_posts", { cate: "gossip", page: 1 }).length;
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await tick(600);
    const after = of(await calls(), "api_blog_posts", { cate: "gossip", page: 1 }).length;
    report.data.postsForeground = { before, after };
    assert.equal(after, before + 1, "回前台 30s 后应有 1 次静默请求");
  });

  /* ───────────── ④ 榜单 ───────────── */
  await page.goto(`${origin}tests/data-freshness.html?page=rank`);
  await page.waitForFunction(() => window.dfFixture.ready);
  await page.waitForFunction(() => window.dfFixture.calls.some(c => c.cmd === "api_rank"));

  await step("榜单下拉刷新：带 refresh=true 重拉当前榜单，首条换成 v2", async () => {
    const before = of(await calls(), "api_rank", { kind: "hot" }).length;
    await bump();
    await pull();
    const rows = of(await calls(), "api_rank", { kind: "hot" });
    report.data.rankPull = rows.map(r => r.args);
    assert.equal(rows.length, before + 1, "榜单下拉必须再发 1 次");
    await page.getByText("rank hot v2", { exact: true }).first().waitFor({ timeout: 5000 });
  });

  await step("榜单刷新按钮：同参数再发 1 次（旧代码点刷新也吃 60s 缓存）", async () => {
    const before = of(await calls(), "api_rank", { kind: "hot" }).length;
    await page.getByRole("button", { name: "刷新榜单", exact: true }).click();
    await tick(600);
    const after = of(await calls(), "api_rank", { kind: "hot" }).length;
    report.data.rankButton = { before, after };
    assert.equal(after, before + 1, "刷新按钮必须真的出网");
  });

  /* ───────────── ⑤ 详情页：不做下拉，改静默刷新 ───────────── */
  await page.goto(`${origin}tests/data-freshness.html?page=detail`);
  await page.waitForFunction(() => window.dfFixture.ready);
  await page.waitForFunction(() => window.dfFixture.calls.some(c => c.cmd === "api_video"));

  await step("详情页进页 SWR：api_video 带 refresh=true（绕过 5min 缓存与磁盘缓存）", async () => {
    const rows = of(await calls(), "api_video", { id: 7 });
    report.data.detailEntry = rows.map(r => r.args);
    assert(rows.length >= 1, "详情页必须请求 api_video");
    assert.equal(rows.length, 2, "进页必须同时有 SWR 那一次真实刷新（缓存先上屏 + 强制刷新）");
  });

  await step("详情页没有下拉刷新（手势不接管）", async () => {
    assert.equal(await hasPullUi(), false, "详情页不应出现下拉指示器");
    const before = (await calls()).length;
    await pull();
    report.data.detailPull = { before, after: (await calls()).length };
    assert.equal((await calls()).length, before, "详情页下拉不应触发任何请求");
  });

  await step("详情页回前台：静默重拉详情（带 refresh=true）", async () => {
    const before = of(await calls(), "api_video", { id: 7 }).length;
    await page.clock.fastForward(31_000);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await tick(600);
    const rows = of(await calls(), "api_video", { id: 7 });
    report.data.detailForeground = { before, after: rows.length };
    assert(rows.length > before, "详情页回前台必须静默重拉");
  });

  /* ───────────── ⑥ 搜索结果页：不做下拉，超 60s 聚焦重搜 ───────────── */
  await page.goto(`${origin}tests/data-freshness.html?page=search`);
  await page.waitForFunction(() => window.dfFixture.ready);

  await step("搜索页没有下拉刷新（手势不接管）", async () => {
    assert.equal(await hasPullUi(), false, "搜索页不应出现下拉指示器");
    const before = (await calls()).length;
    await pull();
    assert.equal((await calls()).length, before, "搜索页下拉不应触发任何请求");
  });

  await step("搜索结果超 60s 后重新聚焦：自动重搜，输入内容与焦点保留", async () => {
    const input = page.getByRole("textbox").first();
    await input.fill("都市");
    await input.press("Enter");
    await page.waitForFunction(() => window.dfFixture.calls.some(c => c.cmd === "api_search"));
    await tick(400);
    const before = of(await calls(), "api_search", { q: "都市" }).length;
    await page.clock.fastForward(61_000);
    await input.click();
    await tick(600);
    const after = of(await calls(), "api_search", { q: "都市" }).length;
    const value = await input.inputValue();
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    report.data.searchRefocus = { before, after, value, focused };
    assert(after > before, "超 60s 重新聚焦应自动重搜");
    assert.equal(value, "都市", "刷新必须保留输入内容");
    assert(/搜索/.test(focused), "刷新必须保留焦点");
  });

  /* ───────────── ⑦ 观看历史页：不做下拉 ───────────── */
  await page.goto(`${origin}tests/data-freshness.html?page=history`);
  await page.waitForFunction(() => window.dfFixture.ready);
  await step("观看历史页没有下拉刷新（手势不接管）", async () => {
    assert.equal(await hasPullUi(), false, "历史页不应出现下拉指示器");
    const before = (await calls()).length;
    await pull();
    report.data.historyPull = { before, after: (await calls()).length };
    assert.equal((await calls()).length, before, "历史页下拉不应触发任何请求");
  });

  /* ───────────── api 层：缓存命中 + force ───────────── */
  await page.goto(`${origin}tests/data-freshness.html?page=api`);
  await page.waitForFunction(() => window.dfFixture.ready);

  await step("api 层：首次 1 次出网；15s 内命中缓存但补一次后台请求；force 立即出网", async () => {
    const count = async () => (await calls()).filter(c => c.cmd === "api_feed").length;
    await page.evaluate(() => window.dfFixture.clearCache());
    await page.evaluate(() => window.dfFixture.resetCalls());
    await page.evaluate(() => window.dfFixture.apiFeed());
    await tick(200);
    const first = await count();
    /* 3s 内重复命中不补请求（防同一屏多次渲染打一串请求），过了 3s 才补 */
    await page.clock.fastForward(4_000);
    await page.evaluate(() => window.dfFixture.apiFeed());   // 命中缓存 → 先给旧值
    await tick(200);
    const afterHit = await count();
    await page.evaluate(() => window.dfFixture.apiFeed(true)); // force → 必须立刻出网
    await tick(200);
    const afterForce = await count();
    report.data.apiLayer = { first, afterHit, afterForce };
    assert.equal(first, 1, "首次应 1 次出网");
    assert.equal(afterHit, 2, "命中缓存时必须同时补一次后台请求（SWR 真生效；3s 内不重复补）");
    assert.equal(afterForce, 3, "force 必须绕过缓存直接出网");

  });

  assert.deepEqual(errors, [], `页面报错：${errors.join(" | ")}`);
} catch (error) {
  report.error = error?.stack || String(error);
} finally {
  try { await page?.screenshot({ path: join(output, "final.png"), fullPage: false }); } catch { /* ignore */ }
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  await browser?.close();
  await vite?.close();
}

if (report.failed.length || report.error) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(`[data-freshness] 通过 ${report.passed.length} 项`);
console.log(JSON.stringify(report.data, null, 2));
console.log(`Artifacts: ${output}`);
