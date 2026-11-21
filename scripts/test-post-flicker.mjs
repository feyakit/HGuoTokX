import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

// 上游 issue #165 回归：吃瓜详情的线路/代理事件不得清空已显示内容。
//   契约 1：hg:line-changed / hg:proxy-changed 后正文与滚动位置保留、不出现整页 Loader、
//           播放器不重建、播放不中断；后台确实重新请求了 api_post 与 api_post_playback。
//   契约 1b：后台刷新失败也不打断阅读。
//   契约 2：换帖子 id 仍然整页重置（清空重置只属于换帖子/换账号）。
//   契约 1c（上游 45c8e00 + 1abc5c7）：更新阅读进度、线路事件都不得重建正文已加载的配图。
// 真实 PostDetail + AppProvider + Player，mock Tauri IPC，不访问上游网络。
//
// 与上游脚本的差异：playwright 自带 Chromium 不含 H.264 专有解码器，hls.js 会报
// bufferAddCodecError，无法起播；这里改用 ffmpeg 生成的 VP9 WebM，走 Player 的 native
// 传输（本地媒体协议 /seg 直连），只验证「播放器不被重建 / 播放不中断 / 内容不闪」，
// 不覆盖 HLS 分段调度本身（那部分由 test:playback 覆盖）。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "test-results", "post-flicker", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const report = { environment: "Real PostDetail/AppProvider/Player in Chromium; mocked Tauri IPC; local VP9 fixture; not native verification", passed: [], external: [] };
let vite, browser, page;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const mediaDir = await mkdtemp(join(tmpdir(), "hguox-post-flicker-"));
execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "60", "-c:v", "libvpx-vp9", "-b:v", "400k", "-g", "30", "-an", "-f", "webm", join(mediaDir, "clip.webm")], { timeout: 60000, stdio: "pipe" });
const clip = await readFile(join(mediaDir, "clip.webm"));

try {
  vite = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const raw = route.request().url();
    const url = new URL(raw);
    if (url.origin === new URL(origin).origin) return route.continue();
    // 本地媒体协议（LOCAL）上的 /seg 与 /img 由夹具接管；其它外部地址一律记下来并掐掉。
    if (url.pathname === "/seg") return route.fulfill({
      status: 200,
      contentType: "video/webm",
      headers: { "Access-Control-Allow-Origin": "*", "Accept-Ranges": "none" },
      body: clip,
    });
    if (url.pathname === "/img") return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="teal"/></svg>',
    });
    report.external.push(raw);
    return route.abort();
  });
  await page.goto(`${origin}tests/post-flicker.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.postFlickerFixture && document.querySelector("[data-post-scroll] h1"));
  await page.waitForFunction(() => document.querySelector("video") && document.querySelector("video").currentTime > 1 && !document.querySelector("video").paused, null, { timeout: 30000 });

  const state = () => page.evaluate(() => {
    const sc = document.querySelector("[data-post-scroll]");
    const v = document.querySelector("video");
    return {
      title: sc?.querySelector("h1")?.textContent || null,
      article: !!document.querySelector(".article-body"),
      scrollTop: sc ? Math.round(sc.scrollTop) : -1,
      fullLoader: !!sc && !sc.querySelector("h1") && !!sc.querySelector(".spinner"),
      playerSpinner: !!document.querySelector(".post-player .spinner"),
      video: v ? { time: v.currentTime, paused: v.paused, rs: v.readyState } : null,
    };
  });
  const events = () => page.evaluate(() => window.postFlickerFixture.events);
  const history = () => page.evaluate(() => window.postFlickerFixture.history);
  const mark = () => page.evaluate(() => window.postFlickerFixture.events.length);

  // 滚到正文中部，模拟阅读位置。阅读进度更新不能用相同 HTML 重建已加载的配图。
  const progress = page.getByRole("progressbar", { name: "阅读进度" });
  const progressBefore = await progress.getAttribute("aria-valuenow");
  await page.waitForFunction(() => document.querySelector(".article-body img")?.naturalWidth > 0);
  await page.locator(".article-body img").evaluate(img => { window.__postImage = img; });
  await page.evaluate(() => { const sc = document.querySelector("[data-post-scroll]"); sc.scrollTop = Math.round((sc.scrollHeight - sc.clientHeight) * 0.5); });
  await page.waitForFunction(before => document.querySelector('[aria-label="阅读进度"]').getAttribute("aria-valuenow") !== before, progressBefore);
  assert(await page.locator(".article-body img").evaluate(img => img === window.__postImage), "更新阅读进度不得重建正文图片");
  report.passed.push("reading-progress-keeps-image");
  const before = await state();
  assert(before.article && before.scrollTop > 100, `前置：应处于正文中部 ${JSON.stringify(before)}`);
  await page.evaluate(() => { window.__postVideo = document.querySelector("video"); });

  // ---- 契约 1：两种线路事件各来一次，内容/位置/播放器必须原样 ----
  for (const eventName of ["hg:line-changed", "hg:proxy-changed"]) {
    const at = await mark();
    const histBefore = (await history()).length;
    await page.evaluate(name => window.dispatchEvent(new Event(name)), eventName);
    // 后台刷新必须真的发生（两个事件都至少重解析一次播放地址）。
    await page.waitForFunction(n => window.postFlickerFixture.history.length >= n + 1, histBefore, { timeout: 10000 });
    await sleep(700); // 覆盖旧代码「清空→重拉→重建」的完整窗口
    const after = await state();
    const fresh = (await events()).slice(at);
    assert.equal(after.title, before.title, `${eventName} 后标题必须保留`);
    assert(after.article, `${eventName} 后正文必须保留`);
    assert(await page.locator(".article-body img").evaluate(img => img === window.__postImage), `${eventName} 后相同正文不得重建图片`);
    assert(Math.abs(after.scrollTop - before.scrollTop) <= 2, `${eventName} 后滚动位置必须保留：${before.scrollTop} → ${after.scrollTop}`);
    assert(!after.fullLoader, `${eventName} 后不得出现整页 Loader`);
    assert(!fresh.some(e => e.type === "page.del" || e.type === "player.del"), `${eventName} 不得卸载页面/播放器：${JSON.stringify(fresh)}`);
    assert(!fresh.some(e => e.type === "spinner.add"), `${eventName} 不得出现任何转圈：${JSON.stringify(fresh)}`);
    const same = await page.evaluate(() => document.querySelector("video") === window.__postVideo);
    assert(same, `${eventName} 后必须是同一个 video 元素`);
    // 适配点：上游代理切换不重连媒体，所以能断言「时间只增」；我们的播放器在
    // hg:proxy-changed 上主动重连（useProxyPlaybackRecovery 按 proxy_changed 重试并
    // 回到原位置），旧连接已经不可用，重连是刻意的。这里按事件分开断言：
    //   hg:line-changed：地址没变，播放只能继续向前；
    //   hg:proxy-changed：允许重连导致时间回退，但必须仍在播、已恢复解码。
    if (eventName === "hg:line-changed") {
      assert(after.video && !after.video.paused && after.video.time > before.video.time, `${eventName} 后播放必须继续：${JSON.stringify(after.video)}`);
    } else {
      assert(after.video && !after.video.paused && after.video.rs >= 2, `${eventName} 后必须自动恢复播放：${JSON.stringify(after.video)}`);
    }
    const cmds = (await history()).slice(histBefore).map(h => h.cmd);
    // 适配点：上游要求两个接口都重拉；我们的读缓存只在 hg:line-changed 时清空
    // （api.ts: clearApiReadCache），代理切换不清数据缓存，所以 api_post 可能命中缓存。
    // 播放地址永不缓存，任何线路/代理变化都必须重新解析——这一条两边一致。
    assert(cmds.includes("api_post_playback"), `${eventName} 必须重新解析播放地址：${cmds}`);
    if (eventName === "hg:line-changed") assert(cmds.includes("api_post"), `${eventName} 必须重新拉帖子：${cmds}`);
    report.passed.push(`line-event-keeps-content:${eventName}`);
  }

  // ---- 契约 1b：后台刷新失败也不打断阅读 ----
  await page.evaluate(() => { window.postFlickerFixture.postResult = "fail"; window.postFlickerFixture.playbackResult = "fail"; });
  const atFail = await mark();
  const histFail = (await history()).length;
  await page.evaluate(() => window.dispatchEvent(new Event("hg:line-changed")));
  await page.waitForFunction(n => window.postFlickerFixture.history.length >= n + 2, histFail, { timeout: 10000 });
  await sleep(700);
  const afterFail = await state();
  assert(afterFail.article && afterFail.title === before.title, "后台刷新失败必须保留正文");
  assert(!afterFail.fullLoader, "后台刷新失败不得回整页错误/Loader");
  assert(!(await events()).slice(atFail).some(e => e.type === "page.del"), "后台刷新失败不得卸载页面");
  assert(afterFail.video && !afterFail.video.paused, "后台刷新失败不得打断播放");
  await page.evaluate(() => { window.postFlickerFixture.postResult = "ok"; window.postFlickerFixture.playbackResult = "ok"; });
  report.passed.push("background-refresh-failure-keeps-content");

  // ---- 契约 2：换帖子 id 仍然整页重置 ----
  const atSwitch = await mark();
  await page.evaluate(() => window.postFlickerSetId(2));
  await page.waitForFunction(() => document.querySelector("[data-post-scroll] h1")?.textContent === "示例帖子 2", null, { timeout: 10000 });
  const switched = (await events()).slice(atSwitch);
  assert(switched.some(e => e.type === "page.del" || e.type === "spinner.add"), `换帖子必须走整页重置：${JSON.stringify(switched)}`);
  const afterSwitch = await state();
  assert.equal(afterSwitch.scrollTop, 0, "换帖子后滚动位置必须归零");
  report.passed.push("post-switch-still-resets");

  assert.equal(errors.length, 0, `页面脚本错误：${errors.join(" | ")}`);
  assert.equal(report.external.length, 0, `不得访问上游网络：${report.external.join(", ")}`);
  await page.screenshot({ path: join(output, "final.png") });
  await writeFile(join(output, "report.json"), JSON.stringify({ ...report, events: await events() }, null, 2));
  console.log(`post-flicker: ${report.passed.length}/${report.passed.length} passed`);
  for (const name of report.passed) console.log(`PASS ${name}`);
} catch (error) {
  await writeFile(join(output, "report.json"), JSON.stringify({ ...report, failed: String(error?.stack || error) }, null, 2)).catch(() => {});
  if (page) await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  console.error(`FAIL post-flicker: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  await page?.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
  await browser?.close().catch(() => {});
  await vite?.close().catch(() => {});
}
