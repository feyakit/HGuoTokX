import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "vite";
import { chromium } from "playwright-core";

// W47 报的真 bug 回归：安卓微光取不到画面。
//   契约 1：开微光的 <video> 必须带 crossOrigin="anonymous"；关掉的不带。
//   契约 2：真跨源（页面一个源、媒体另一个源）时，带 crossOrigin + 回 ACAO 能 getImageData；
//           不带 crossOrigin 必然 SecurityError —— 这条就是「微光静默不生效」的机理。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "test-results", "glow-crossorigin", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const report = { environment: "Real VideoSurface in Chromium; media served from a second origin with ACAO; not native verification", passed: [], external: [] };
let vite, browser, page, media;

const mediaDir = await mkdtemp(join(tmpdir(), "hguox-glow-"));
execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "8", "-c:v", "libvpx-vp9", "-b:v", "400k", "-an", "-f", "webm", join(mediaDir, "clip.webm")], { timeout: 60000, stdio: "pipe" });
const clip = await readFile(join(mediaDir, "clip.webm"));
media = createHttpServer((req, res) => {
  if (req.url?.startsWith("/clip.webm")) {
    res.writeHead(200, {
      "Content-Type": "video/webm",
      "Content-Length": clip.length,
      // 这就是我们 Rust 侧 custom protocol 的行为：按请求 Origin 回 ACAO（无 Origin 时回 *）。
      "Access-Control-Allow-Origin": req.headers.origin || "*",
      Vary: "Origin",
    });
    res.end(clip);
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((done, reject) => { media.once("error", reject); media.listen(0, "127.0.0.1", done); });
const mediaOrigin = `http://127.0.0.1:${media.address().port}`;

try {
  vite = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await vite.listen();
  const origin = vite.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue();
    if (new URL(route.request().url()).origin === mediaOrigin) return route.continue();
    report.external.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${origin}tests/glow-crossorigin.html?media=${encodeURIComponent(`${mediaOrigin}/clip.webm`)}`);
  await page.waitForSelector("video");

  // ---- 契约 1 ----
  const all = await page.evaluate(() => [...document.querySelectorAll("video")].map(v => v.getAttribute("crossorigin")));
  assert.equal(all.filter(value => value === "anonymous").length, 1,
    `只该有开微光的那一个 video 带 crossOrigin=anonymous（关掉的不带，避免无谓的 CORS 模式）：${JSON.stringify(all)}`);
  report.passed.push("glow-video-requests-cors");

  // ---- 契约 2 ----
  await page.waitForFunction(() => window.glowProbe?.withoutCrossOrigin, null, { timeout: 20000 });
  const probe = await page.evaluate(() => window.glowProbe);
  assert.equal(probe.withCrossOrigin.ok, true, `带 crossOrigin + ACAO 必须能取像素：${JSON.stringify(probe)}`);
  assert(probe.withCrossOrigin.sum > 0, `采样帧不能是全黑：${JSON.stringify(probe.withCrossOrigin)}`);
  assert.equal(probe.withoutCrossOrigin.ok, false, `不带 crossOrigin 时应该被 canvas 污染挡住（这正是安卓上的现状）：${JSON.stringify(probe)}`);
  assert(/Security/i.test(probe.withoutCrossOrigin.error || ""), `失败原因必须是 SecurityError：${JSON.stringify(probe)}`);
  report.passed.push("cross-origin-pixels-require-cors");

  assert.equal(errors.length, 0, `页面脚本错误：${errors.join(" | ")}`);
  await page.screenshot({ path: join(output, "final.png") });
  await writeFile(join(output, "report.json"), JSON.stringify({ ...report, attrs: all, probe }, null, 2));
  console.log(`glow-crossorigin: ${report.passed.length}/${report.passed.length} passed`);
  for (const name of report.passed) console.log(`PASS ${name}`);
} catch (error) {
  await writeFile(join(output, "report.json"), JSON.stringify({ ...report, failed: String(error?.stack || error) }, null, 2)).catch(() => {});
  if (page) await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  console.error(`FAIL glow-crossorigin: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await vite?.close().catch(() => {});
  await new Promise(done => media?.close(done));
}
