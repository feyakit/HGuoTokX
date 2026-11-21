import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

// 上游 0a66791（启动部分）回归：
//   契约 1：动画期间 App 仍然挂载（3.0.7 起「拉数据与动画并行」不能被改回去）。
//   契约 2：动画结束时 <html> 上的启动锁被摘掉（否则浅色主题被 !important 深色底钉住）。
//   契约 3：首帧只有动画：App 的挂载发生在动画提交之后的一帧，而不是同一帧。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "test-results", "startup-lock", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const report = { environment: "Real StartupGate/LaunchAnimation in Chromium; mocked Tauri IPC; not native verification", passed: [], external: [] };
let vite, browser, page;

try {
  vite = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue();
    report.external.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${origin}tests/startup-lock.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.startupLockFixture.childAt !== undefined);
  const firstFrame = await page.evaluate(() => ({
    locked: document.documentElement.hasAttribute("data-hg-launching"),
    overlay: !!document.querySelector(".hg-launch"),
    childAt: window.startupLockFixture.childAt,
    overlayAtChildMount: window.startupLockFixture.overlayAtChildMount,
    bg: getComputedStyle(document.body).backgroundColor,
  }));

  // ---- 契约 1 ----
  assert.equal(firstFrame.overlayAtChildMount, true, `动画期间 App 就该挂上（并行拉数据）：${JSON.stringify(firstFrame)}`);
  report.passed.push("app-mounts-while-the-reveal-plays");

  // ---- 契约 3 ----
  assert(firstFrame.childAt > 0, `App 应晚于动画首帧挂载：${firstFrame.childAt}`);
  assert.equal(firstFrame.locked, true, "动画期间启动锁必须在");
  assert.equal(firstFrame.bg, "rgb(10, 11, 20)", `启动锁期间底色必须是品牌深色：${firstFrame.bg}`);
  report.passed.push("launch-lock-holds-the-brand-surface");

  // ---- 契约 2 ----
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-hg-launching"), null, { timeout: 8000 });
  const after = await page.evaluate(() => ({
    overlay: !!document.querySelector(".hg-launch"),
    child: !!document.querySelector("[data-app-mounted]"),
  }));
  assert.equal(after.overlay, false, "动画结束后遮罩必须卸载");
  assert.equal(after.child, true, "动画结束后 App 必须在");
  report.passed.push("launch-lock-released-and-app-kept");

  assert.equal(errors.length, 0, `页面脚本错误：${errors.join(" | ")}`);
  assert.equal(report.external.length, 0, `不得访问外部网络：${report.external.join(", ")}`);
  await page.screenshot({ path: join(output, "final.png") });
  await writeFile(join(output, "report.json"), JSON.stringify({ ...report, firstFrame, after }, null, 2));
  console.log(`startup-lock: ${report.passed.length}/${report.passed.length} passed`);
  for (const name of report.passed) console.log(`PASS ${name}`);
} catch (error) {
  await writeFile(join(output, "report.json"), JSON.stringify({ ...report, failed: String(error?.stack || error) }, null, 2)).catch(() => {});
  if (page) await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  console.error(`FAIL startup-lock: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await vite?.close().catch(() => {});
}
