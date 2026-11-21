import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

// 上游 3622227 回归：返回收藏列表要刷新可见卡片。
//   契约 1：首次进入按可见 id 拉一次，卡片渲染出来。
//   契约 2：被详情页盖住（active=false）再返回（active=true）→ 同一批 id 重新校验一遍。
//   契约 3：停留在列表里（active 不变、id 不变）不得反复重拉。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "test-results", "favorites-return", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const report = { environment: "Real FavoritesPage + AppProvider in Chromium; mocked Tauri IPC; not native verification", passed: [], external: [] };
const FAVS = [1, 2, 3];
let vite, browser, page;

try {
  vite = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(favs => {
    localStorage.setItem("hguox_app_v1", JSON.stringify({ favs, history: [] }));
  }, FAVS);
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue();
    report.external.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${origin}tests/favorites-return.html`);
  await page.waitForFunction(count => window.favoritesFixture.calls.length >= count, FAVS.length);
  const calls = () => page.evaluate(() => window.favoritesFixture.calls.slice());

  // ---- 契约 1 ----
  await page.getByText("收藏卡 1", { exact: true }).waitFor();
  const first = await calls();
  assert.deepEqual([...first].sort((a, b) => a - b), [...FAVS], `首次进入应按可见 id 各拉一次：${first}`);
  report.passed.push("first-render-loads-visible-cards");

  // ---- 契约 3：停留不动不得反复重拉 ----
  await page.evaluate(() => new Promise(done => setTimeout(done, 600)));
  assert.equal((await calls()).length, first.length, "停留在列表里不得重复请求");
  report.passed.push("staying-on-the-list-does-not-refetch");

  // ---- 契约 2：盖住再返回 → 重新校验 ----
  await page.evaluate(() => window.favoritesSetActive(false));
  await page.evaluate(() => new Promise(done => setTimeout(done, 200)));
  assert.equal((await calls()).length, first.length, "被盖住时不该有请求");
  await page.evaluate(() => window.favoritesSetActive(true));
  await page.waitForFunction(before => window.favoritesFixture.calls.length >= before + 3, first.length, { timeout: 10000 });
  const after = await calls();
  const refreshed = after.slice(first.length);
  assert.deepEqual([...refreshed].sort((a, b) => a - b), [...FAVS], `返回时应整屏重校验一次：${after}`);
  report.passed.push("returning-revalidates-visible-favorites");

  // 返回后也应只有一批，不是每帧一次
  await page.evaluate(() => new Promise(done => setTimeout(done, 600)));
  assert.equal((await calls()).length, after.length, "返回后的重校验只允许一轮");
  report.passed.push("return-revalidation-happens-once");

  assert.equal(errors.length, 0, `页面脚本错误：${errors.join(" | ")}`);
  assert.equal(report.external.length, 0, `不得访问外部网络：${report.external.join(", ")}`);
  await page.screenshot({ path: join(output, "final.png") });
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`favorites-return: ${report.passed.length}/${report.passed.length} passed`);
  for (const name of report.passed) console.log(`PASS ${name}`);
} catch (error) {
  await writeFile(join(output, "report.json"), JSON.stringify({ ...report, failed: String(error?.stack || error) }, null, 2)).catch(() => {});
  if (page) await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  console.error(`FAIL favorites-return: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await vite?.close().catch(() => {});
}
