// 胶囊 tab 的度量回归：断言「文字墨间距」区间，而不是写死盒间距。
// 背景：参考图上未选中项没有可见边框，盒间距只能靠「墨距 − 两侧内边距」反推，
// 所以验收口径统一到墨距（38–42 CSS，实测 38.1 / 41.7）。高 27 / r8 两边一致，一并锁住。
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { installFixture } from "./fixtures/app-ui.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "test-results", "pill-row");
await mkdir(output, { recursive: true });
const INK_MIN = 38, INK_MAX = 42;

let vite, browser;
try {
  vite = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await context.addInitScript(installFixture, { theme: "dark", titles: ["城市与晚风", "星河旅人"] });
  await context.addInitScript(() => localStorage.setItem("hguox_usage_agreement", JSON.stringify({
    version: "2026-11-15-v1", accepted: true, acceptedAt: "2026-11-15T00:00:00.000Z",
  })));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(origin).origin) return route.continue();
    return route.abort();
  });
  await page.goto(origin);
  await page.locator(".hg-pill").first().waitFor();

  const m = await page.evaluate(() => {
    const pills = [...document.querySelectorAll(".hg-pill")];
    const ink = pills.map(pill => {
      const range = document.createRange();
      range.selectNodeContents(pill);
      const box = range.getBoundingClientRect();
      return { left: +box.left.toFixed(2), right: +box.right.toFixed(2) };
    });
    const style = getComputedStyle(pills[0]);
    return {
      labels: pills.map(p => p.textContent),
      inkGaps: ink.slice(1).map((next, i) => +(next.left - ink[i].right).toFixed(2)),
      inkPadLeft: +(ink[0].left - pills[0].getBoundingClientRect().left).toFixed(2),
      height: +pills[0].getBoundingClientRect().height.toFixed(2),
      radius: style.borderTopLeftRadius,
      border: style.borderTopWidth,
      padding: style.paddingLeft,
      boxGap: parseFloat(getComputedStyle(pills[0].parentElement).gap),
    };
  });
  console.log(JSON.stringify(m, null, 1));

  assert.equal(m.height, 27, "胶囊高 27（参考 27.4，两边已一致）");
  assert.equal(m.radius, "8px", "圆角 8（参考 8，不是半圆）");
  assert(m.inkGaps.length >= 2, "至少有 3 个 tab 才能量相邻间距");
  for (const gap of m.inkGaps) {
    assert(gap >= INK_MIN && gap <= INK_MAX,
      `文字墨间距必须在 ${INK_MIN}–${INK_MAX} CSS（参考实测 38.1 / 41.7），实际 ${gap}`);
  }
  assert.deepEqual(errors, [], "No page errors");
  console.log(`PASS: 胶囊 27/r8，墨间距 ${m.inkGaps.join(" / ")} CSS 落在 ${INK_MIN}–${INK_MAX}`);
} catch (error) {
  console.error(String(error?.stack || error));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await vite?.close();
}
