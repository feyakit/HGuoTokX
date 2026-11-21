// 平衡音量（POC）本地探针：不起 Tauri、不碰网络，只用 vite dev + 无头 Chromium 量真实 dB。
// 用法：node scripts/test-balance-volume.mjs [--browser-executable PATH]
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createServer as createNetServer } from "node:net";
import { chromium } from "playwright-core";
import { createServer as createViteServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values: args } = parseArgs({ options: { "browser-executable": { type: "string" } } });
const executablePath = args["browser-executable"]
  || process.env.CHROMIUM_PATH
  || undefined;

/* 仓库的 vite.config 把 1420 写死成 strictPort，这里先要一个空闲端口再显式覆盖，避免和别的 dev server 抢。 */
const freePort = await new Promise((resolvePort, rejectPort) => {
  const probe = createNetServer();
  probe.once("error", rejectPort);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    const port = typeof address === "object" && address ? address.port : 0;
    probe.close(() => resolvePort(port));
  });
});
const server = await createViteServer({ root, server: { port: freePort, strictPort: true, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${freePort}/`;

const browser = await chromium.launch({
  executablePath,
  args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio", "--no-sandbox"],
});
const page = await browser.newPage();
const failures = [];
try {
  await page.goto(`${url}tests/balance-probe.html`);
  await page.waitForFunction(() => !!window.__balanceProbe);

  /* 注意：开源头 Chromium 不带 H.264/AAC，isBalanceVolumeSupported()（要求 MSE 能播 avc1+mp4a）
     在这里一定是 false，而真机 WebView 是 true。探针要量的是 Web Audio 链路本身，
     所以只把它当信息打印：链条只依赖 AudioContext，不依赖编解码。 */
  const supported = await page.evaluate(() => window.__balanceProbe.supported());
  console.log(`[balance] 内核自报支持：${supported}（开源头 Chromium 恒为 false，真机 WebView 为 true）`);

  // 跨源无 CORS 的地址必须判 opaque（挂上就是整片无声）
  /* 用真·跨源地址判守卫：只比 origin，不需要真能取到（取不到正好也不会去挂节点）。 */
  const guard = await page.evaluate(() => window.__balanceProbe.checkOpaqueGuard("https://example.invalid/cross-origin-sample.m4a"));
  assert.equal(guard, "unsupported", "跨源无 CORS 的源必须判 unsupported");
  console.log(`[balance] 跨源守卫：${guard} ✔`);

  await page.evaluate(() => window.__balanceProbe.loadFixture());
  await page.click("#start");
  await page.waitForFunction(() => window.__balanceProbe.isStarted(), null, { timeout: 15000 });
  const m = await page.evaluate(() => window.__balanceProbe.run());

  const round = (v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v);
  console.log(`[balance] 安静段输出 ${round(m.quietDb)} dB（目标增益 ${round(m.quietDesired)} dB）`);
  console.log(`[balance] 响段输出   ${round(m.loudDb)} dB（目标增益 ${round(m.loudDesired)} dB）`);
  console.log(`[balance] 音量 0.2 后 ${round(m.loweredDb)} dB`);
  console.log(`[balance] 峰值 ${round(m.quietPeakDb)} / ${round(m.loudPeakDb)} dB`);

  const check = (ok, message) => { if (!ok) failures.push(message); };
  check(m.quietDb > -22 && m.quietDb < -15, `安静段输出 ${round(m.quietDb)} dB 不在 -22..-15 目标带内`);
  check(Math.abs(m.loudDb - m.quietDb) <= 1.5, `两段输出差 ${round(Math.abs(m.loudDb - m.quietDb))} dB 超过 1.5dB`);
  check(m.quietDesired > 10, "安静段应被大幅提升");
  check(m.loudDesired < 0, "响段应被衰减");
  check(m.quietPeakDb < -1.4 && m.loudPeakDb < -1.4, "峰值必须低于限幅上限");
  check(m.loweredDb <= m.loudDb - 12 && m.loweredDb >= m.loudDb - 17, "手动音量必须仍然生效");
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(failures.map(f => `✗ ${f}`).join("\n"));
  process.exit(1);
}
console.log("[balance] 全部通过");
