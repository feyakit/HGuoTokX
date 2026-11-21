import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

// 上游 7ab0a51 回归：安全区要按视口跨尺寸生效，左右各自让位（横屏刘海不对称也成立）。
//   契约 1：手机竖屏（390/320）标题与滚动体仍全宽，两侧内边距等于页面内边距。
//   契约 2：横屏 667x375，--sal=44 / --sar=16 → 左右内边距各自加上对应的安全区。
//   契约 3：平板 1024x768 → 内容限宽（≤960）且左右留白对称。
//   契约 4：浮层（Modal）四边 padding 也吃同一套安全区，内容不会被刘海压住。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "test-results", "safe-area", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const report = { environment: "Real .ios-page/.ios-overlay CSS in Chromium; insets injected as CSS vars; not native notch verification", passed: [], external: [] };
let vite, browser, page;

const measure = () => page.evaluate(() => {
  const el = document.querySelector(".ios-page > .shrink-0");
  const body = document.querySelector(".ios-page > .scroll-y");
  const page = document.querySelector(".ios-page");
  const overlay = document.querySelector(".ios-overlay.is-open");
  if (!el || !body || !page || !overlay) return null;
  const r = node => {
    const b = node.getBoundingClientRect();
    const s = getComputedStyle(node);
    return { width: b.width, left: b.left, right: b.right, padLeft: parseFloat(s.paddingLeft), padRight: parseFloat(s.paddingRight) };
  };
  const os = getComputedStyle(overlay);
  return {
    viewport: innerWidth,
    page: r(page), head: r(el), body: r(body),
    overlay: { padLeft: parseFloat(os.paddingLeft), padRight: parseFloat(os.paddingRight), padTop: parseFloat(os.paddingTop), padBottom: parseFloat(os.paddingBottom) },
  };
});

const insets = (left, right) => page.evaluate(([l, r]) => {
  document.documentElement.style.setProperty("--sal", `${l}px`);
  document.documentElement.style.setProperty("--sar", `${r}px`);
  document.documentElement.style.setProperty("--sat", "24px");
  document.documentElement.style.setProperty("--sab", "16px");
}, [left, right]);
const settle = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));

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
  await page.goto(`${origin}tests/safe-area.html`);
  await page.locator(".ios-overlay.is-open").waitFor();
  await insets(0, 0);
  await settle();

  // ---- 契约 1：竖屏全宽 ----
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await settle();
    const m = await measure();
    assert(Math.abs(m.head.width - m.viewport) <= 1, `${width}px 竖屏标题应全宽：${JSON.stringify(m.head)} / ${m.viewport}`);
    assert(Math.abs(m.body.width - m.viewport) <= 1, `${width}px 竖屏滚动体应全宽：${JSON.stringify(m.body)}`);
    assert.equal(m.head.padLeft, m.head.padRight, `${width}px 竖屏两侧内边距应相等`);
  }
  report.passed.push("portrait-keeps-full-width");

  // ---- 契约 2：横屏非对称安全区 ----
  await page.setViewportSize({ width: 667, height: 375 });
  await insets(44, 16);
  await settle();
  const land = await measure();
  assert(land.head.padLeft - land.head.padRight === 28, `左右应各自加上 safe area：${JSON.stringify(land.head)}`);
  assert(land.overlay.padLeft >= 44 + 7, `浮层左边必须让出 44px 刘海：${JSON.stringify(land.overlay)}`);
  assert(land.overlay.padTop >= 24 + 7, `浮层上边必须让出状态栏：${JSON.stringify(land.overlay)}`);
  assert(land.overlay.padBottom >= 16 + 7, `浮层下边必须让出底部手势区：${JSON.stringify(land.overlay)}`);
  report.passed.push("landscape-asymmetric-insets");

  // ---- 契约 3：平板限宽居中 ----
  await page.setViewportSize({ width: 1024, height: 768 });
  await insets(0, 0);
  await settle();
  const wide = await measure();
  for (const part of [wide.head, wide.body]) {
    assert(part.width <= 960.5, `平板应限宽 ≤960：${part.width}`);
    const leftGap = part.left - wide.page.left;
    const rightGap = wide.page.right - part.right;
    assert(Math.abs(leftGap - rightGap) <= 1, `平板留白应对称：${leftGap} / ${rightGap}`);
  }
  report.passed.push("tablet-column-centered");

  assert.equal(errors.length, 0, `页面脚本错误：${errors.join(" | ")}`);
  assert.equal(report.external.length, 0, `不得访问外部网络：${report.external.join(", ")}`);
  await page.screenshot({ path: join(output, "final.png") });
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`safe-area: ${report.passed.length}/${report.passed.length} passed`);
  for (const name of report.passed) console.log(`PASS ${name}`);
} catch (error) {
  await writeFile(join(output, "report.json"), JSON.stringify({ ...report, failed: String(error?.stack || error) }, null, 2)).catch(() => {});
  if (page) await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  console.error(`FAIL safe-area: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await vite?.close().catch(() => {});
}
