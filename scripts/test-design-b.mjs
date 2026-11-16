// 取色钳制和 3 槽轮换。不访问上游，也不依赖真机解码器。
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let vite, browser;
try {
  vite = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}tests/design-b.html`);
  await page.waitForFunction(() => window.designB);
  const result = await page.evaluate(() => window.designB);
  assert.deepEqual(errors, [], "页面不能有脚本错误");
  assert.equal(result.passed, true, result.errors.join("\n"));
  assert.equal(result.teal.source, "image");
  assert.notEqual(result.teal.accent, result.red.accent);
  console.log(JSON.stringify({ passed: true, teal: result.teal, red: result.red }));
} finally {
  await browser?.close();
  await vite?.close();
}
