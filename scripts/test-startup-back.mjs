import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

// 上游 4dd7844 回归：启动动画期间的返回键归动画，不能穿透到已挂载的 App。
//   契约 1：动画还在时按返回 → 动画被跳过，但 App 的返回处理（退出应用）一次都不许发生。
//   契约 2：动画结束后按返回 → 正常交给 App（该退就退）。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "test-results", "startup-back", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const report = { environment: "Real StartupGate/LaunchAnimation + App-like back handler in Chromium; mocked Tauri broadcast; not native verification", passed: [], external: [] };
let vite, browser, page;

try {
  vite = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
  /* 必须用安卓 UA：LaunchAnimation 只在 platform === "android" 时注册 back-button，
     桌面 UA 下它只监听 Esc，测不到「两个监听同时收到广播」这件事。 */
  page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (Linux; Android 14; MI 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue();
    report.external.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${origin}tests/startup-back.html`);
  // 动画期间：遮罩在、App 也已挂载（这正是 3.0.7 起的新结构）
  await page.locator(".hg-launch").waitFor();
  await page.locator("[data-app-mounted]").waitFor();
  await page.waitForFunction(() => window.startupBackFixture.backHandlers.length >= 2);

  // ---- 契约 1 ----
  await page.evaluate(() => window.pressBack());
  await page.evaluate(() => new Promise(done => setTimeout(done, 120)));
  const afterBack = await page.evaluate(() => ({
    exits: window.startupBackFixture.exits,
    launchVisible: !!document.querySelector(".hg-launch"),
  }));
  assert.equal(afterBack.exits, 0, `动画期间按返回不得退出应用：${JSON.stringify(afterBack)}`);
  assert.equal(afterBack.launchVisible, false, "返回键应该把动画跳掉");
  report.passed.push("back-during-launch-skips-the-reveal-without-exiting");

  // ---- 契约 2 ----
  await page.waitForFunction(() => window.startupBackFixture.backHandlers.length >= 1);
  await page.evaluate(() => window.pressBack());
  await page.waitForFunction(() => window.startupBackFixture.exits >= 1, null, { timeout: 5000 });
  report.passed.push("back-after-launch-reaches-the-app");

  assert.equal(errors.length, 0, `页面脚本错误：${errors.join(" | ")}`);
  assert.equal(report.external.length, 0, `不得访问外部网络：${report.external.join(", ")}`);
  await page.screenshot({ path: join(output, "final.png") });
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`startup-back: ${report.passed.length}/${report.passed.length} passed`);
  for (const name of report.passed) console.log(`PASS ${name}`);
} catch (error) {
  await writeFile(join(output, "report.json"), JSON.stringify({ ...report, failed: String(error?.stack || error) }, null, 2)).catch(() => {});
  if (page) await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  console.error(`FAIL startup-back: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await vite?.close().catch(() => {});
}
