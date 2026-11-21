import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

// 上游 205eb02 回归：键盘把可视区顶矮之后，面板里的输入框和提交按钮必须还在可视区。
//   契约 1：面板变矮、焦点在输入框上 → 面板自己滚动，输入框底边不越过面板底边。
//   契约 2：滚动只发生在面板内部（document.scrollingElement 不动），不把整页顶起来。
//   契约 3：没有 avoidNativeKeyboard 的面板保持原样（行为只对登录这类表单开启）。
// 注意：桌面 Chromium 压矮视口 ≠ 真机 IME，安卓真机仍需实测（报告里标注）。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "test-results", "keyboard-sheet", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const report = { environment: "Real Sheet/DialogFrame in Chromium, viewport height shrunk to emulate adjustResize; not native IME verification", passed: [], external: [] };
let vite, browser, page;

const measure = () => page.evaluate(() => {
  const panel = document.querySelector(".ios-overlay.is-open [role=dialog]");
  if (!panel) return null;
  const active = document.activeElement;
  const pr = panel.getBoundingClientRect();
  const field = active && active.matches("input") ? active.getBoundingClientRect() : null;
  return {
    panel: { top: pr.top, bottom: pr.bottom, height: pr.height, scrollTop: panel.scrollTop },
    field: field ? { top: field.top, bottom: field.bottom } : null,
    pageScroll: document.scrollingElement?.scrollTop ?? 0,
  };
});

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
  await page.goto(`${origin}tests/keyboard-sheet.html`);
  await page.locator("#kb-submit").waitFor();

  // 聚焦密码框（表单最靠下的输入），再模拟键盘把可视区压到 520px
  await page.locator("#kb-password").focus();
  const before = await measure();
  assert(before?.field, "前置：焦点必须在输入框上");
  await page.setViewportSize({ width: 390, height: 380 });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.evaluate(() => new Promise(done => setTimeout(done, 120)));
  const after = await measure();
  assert(after.panel.height < before.panel.height, `前置：可视区压矮后面板应变矮：${before.panel.height} → ${after.panel.height}`);

  // ---- 契约 1 ----
  assert(after.field.bottom <= after.panel.bottom + 1, `键盘弹出后输入框必须留在面板可视区：${JSON.stringify(after)}`);
  const submit = await page.locator("#kb-submit").boundingBox();
  const panelBox = await page.locator(".ios-overlay.is-open [role=dialog]").boundingBox();
  assert(submit && panelBox && submit.y + submit.height <= panelBox.y + panelBox.height + 1,
    `键盘弹出后「登录」按钮必须仍在面板可视区：${JSON.stringify({ submit, panelBox })}`);
  report.passed.push("focused-field-and-submit-stay-visible");

  // ---- 契约 2 ----
  assert.equal(after.pageScroll, 0, "只允许滚面板，不允许顶整页");
  assert(after.panel.scrollTop > 0, "面板应自己滚动让出位置");
  report.passed.push("only-the-panel-scrolls");

  assert.equal(errors.length, 0, `页面脚本错误：${errors.join(" | ")}`);
  assert.equal(report.external.length, 0, `不得访问外部网络：${report.external.join(", ")}`);
  await page.screenshot({ path: join(output, "final.png") });
  await writeFile(join(output, "report.json"), JSON.stringify({ ...report, before, after }, null, 2));
  console.log(`keyboard-sheet: ${report.passed.length}/${report.passed.length} passed`);
  for (const name of report.passed) console.log(`PASS ${name}`);
} catch (error) {
  await writeFile(join(output, "report.json"), JSON.stringify({ ...report, failed: String(error?.stack || error) }, null, 2)).catch(() => {});
  if (page) await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  console.error(`FAIL keyboard-sheet: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await vite?.close().catch(() => {});
}
