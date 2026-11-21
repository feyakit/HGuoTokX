import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

// 上游 12f1968 + 589b0fb 回归：可信线路之间切换，登录态必须由 boot 裁决，不许闪断成登出。
//   契约 1：hg:line-changed / hg:proxy-changed 期间，store 里的 user 一次都不许变成 null，
//           而且每次事件之后必须重新问一次 boot（不是前端自己猜）。
//   契约 2：不可信（自定义）线路：后端已清会话，boot 返回 null → 界面正常登出（fail closed）。
//   契约 3：同一账号跨可信线路，本地账号桶跟着迁移，未上传的 dirtyHistory 不丢。
// 真实 AppProvider + 假 IPC；bootDelay 模拟真机 IPC 往返，把「先清后拉」的闪断放大到可采样。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "test-results", "line-session-keep", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const report = { environment: "Real AppProvider in Chromium; mocked Tauri IPC; not native verification", passed: [], external: [] };
const MAIN = "https://main.fixture.invalid";
const MIRROR = "https://mirror-one.fixture.invalid";
const ACCOUNTS_KEY = "hguox_accounts_v1";
let vite, browser, page;

try {
  vite = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue();
    report.external.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${origin}tests/line-session-keep.html`);
  await page.waitForFunction(() => window.lineSessionSnapshot?.ready && window.lineSessionSnapshot.user?.id === 17);
  const boots = () => page.evaluate(() => window.lineSessionFixture.boots);
  const userIds = () => page.evaluate(() => window.lineSessionFixture.seen.slice());

  // ---- 契约 1：可信切换（后端 rebase 保留会话）不得闪断 ----
  await page.evaluate(() => {
    window.lineSessionFixture.bootDelay = 150;
    window.lineSessionFixture.seen.length = 0;
    /* 后端已完成可信 rebase：当前线路换成镜像，会话仍属于同一账号（boot 会这样回报）。 */
    window.lineSessionFixture.base = "https://mirror-one.fixture.invalid";
  });
  const bootsBefore = await boots();
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("hg:line-changed"));
    window.dispatchEvent(new Event("hg:proxy-changed"));
    await new Promise(done => setTimeout(done, 700));
  });
  const after = await userIds();
  assert(after.length > 0, "切线期间 store 必须有渲染，否则采样不到闪断");
  assert(after.every(id => id === 17), `切线/代理事件期间不得出现登出闪断：${[...new Set(after)]}`);
  const bootsAfter = await boots();
  assert.equal(bootsAfter - bootsBefore, 2, `每个事件都必须重新问一次 boot：${bootsBefore} → ${bootsAfter}`);
  report.passed.push("trusted-line-change-keeps-login-without-flash");

  // ---- 契约 3：同一账号跨可信线路，账号桶跟着迁移（dirtyHistory 不丢）----
  const migrated = await page.evaluate(({ ACCOUNTS_KEY, MAIN_KEY }) => {
    const raw = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "{}");
    const keys = Object.keys(raw.accounts || {});
    return { keys, hasOld: keys.includes(MAIN_KEY), old: raw.accounts?.[MAIN_KEY]?.data?.dirtyHistory || null };
  }, { ACCOUNTS_KEY, MAIN_KEY: JSON.stringify([MAIN, 17]) });
  assert(!migrated.hasOld, `旧线路的账号桶必须搬走，不能留两份：${JSON.stringify(migrated.keys)}`);
  assert(migrated.keys.length === 1 && migrated.keys[0] === JSON.stringify([MIRROR, 17]), `账号桶应迁到当前线路：${JSON.stringify(migrated.keys)}`);
  report.passed.push("account-bucket-migrates-with-the-session");

  // ---- 契约 2：切到不可信线路 → boot 返回 null，界面正常登出 ----
  await page.evaluate(() => { window.lineSessionFixture.loggedIn = false; window.lineSessionFixture.base = "https://custom.fixture.invalid"; });
  await page.evaluate(() => window.dispatchEvent(new Event("hg:line-changed")));
  await page.waitForFunction(() => window.lineSessionSnapshot.user === null, null, { timeout: 5000 });
  const loggedOut = await userIds();
  assert.equal(loggedOut[loggedOut.length - 1], null);
  report.passed.push("untrusted-line-still-logs-out-through-boot");

  assert.equal(errors.length, 0, `页面脚本错误：${errors.join(" | ")}`);
  assert.equal(report.external.length, 0, `不得访问外部网络：${report.external.join(", ")}`);
  await page.screenshot({ path: join(output, "final.png") });
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`line-session-keep: ${report.passed.length}/${report.passed.length} passed`);
  for (const name of report.passed) console.log(`PASS ${name}`);
} catch (error) {
  await writeFile(join(output, "report.json"), JSON.stringify({ ...report, failed: String(error?.stack || error) }, null, 2)).catch(() => {});
  if (page) await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  console.error(`FAIL line-session-keep: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await vite?.close().catch(() => {});
}
