// Full-glass and automatic-degradation checks against real compiled CSS.
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const vite = await createServer({ server: { host: "127.0.0.1", port: 0 } });
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  });
  const origin = vite.resolvedUrls.local[0];
  const capableDevice = { memoryGB: 8, cores: 8 };
  const scenarios = [
    { name: "windows-capable", platform: "windows", expected: "full", options: capableDevice },
    { name: "ios-capable", platform: "ios", expected: "full", options: capableDevice },
    { name: "android-capable", platform: "android", expected: "full", options: capableDevice },
    { name: "macos-capable", platform: "macos", expected: "full", options: capableDevice },
    { name: "linux-capable", platform: "linux", expected: "full", options: capableDevice },
    { name: "low-memory", expected: "low", options: { ...capableDevice, memoryGB: 2 } },
    { name: "low-cpu", expected: "low", options: { ...capableDevice, cores: 2 } },
    { name: "forced-colors", expected: "low", options: { ...capableDevice, forcedColors: "active" } },
  ];
  for (const scenario of scenarios) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      forcedColors: scenario.options.forcedColors || "none",
    });
    await context.addInitScript(({ memoryGB, cores }) => {
      if (memoryGB !== undefined) Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: memoryGB });
      if (cores !== undefined) Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, value: cores });
    }, scenario.options);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}scripts/fixtures/glass-quality.html?platform=${scenario.platform || "windows"}`);
    await page.waitForFunction(() => !!document.documentElement.dataset.glassQuality);
    const actual = await page.evaluate(() => {
      const style = selector => getComputedStyle(document.querySelector(selector));
      const blur = selector => style(selector).backdropFilter || style(selector).webkitBackdropFilter;
      return {
        quality: document.documentElement.dataset.glassQuality,
        platform: document.documentElement.dataset.glassPlatform,
        navBlur: blur(".ios-mobile-nav .hg-glass"),
        dialogBlur: blur(".ios-dialog"),
        cardBlur: blur(".ios-setting-group"),
        speedBlur: blur(".player-speed-menu"),
        navBackground: style(".ios-mobile-nav .hg-glass").backgroundColor,
      };
    });
    assert.equal(actual.quality, scenario.expected, `${scenario.name}: quality`);
    assert.equal(actual.platform, scenario.platform || "windows", `${scenario.name}: platform`);
    assert.equal(actual.cardBlur, "none", `${scenario.name}: scrolling cards do not blur video`);
    if (scenario.expected === "full") {
      assert.match(actual.navBlur, /blur\(/, "Full mode should blur navigation");
      assert.match(actual.dialogBlur, /blur\(/, "Full mode should blur overlays");
    } else {
      assert.equal(actual.navBlur, "none", `${scenario.name}: nav fallback`);
      assert.equal(actual.dialogBlur, "none", `${scenario.name}: dialog fallback`);
      assert.equal(actual.speedBlur, "none", `${scenario.name}: player menu fallback`);
      assert.notEqual(actual.navBackground, "rgba(0, 0, 0, 0)", `${scenario.name}: nav must stay readable`);
    }
    if (scenario.name === "windows-capable") {
      // Manual preference is persisted and takes effect without reloading.
      await page.evaluate(() => window.__glass.setPreference("low"));
      await page.waitForFunction(() => document.documentElement.dataset.glassQuality === "low");
      assert.equal(await page.locator(".ios-dialog").evaluate(el => getComputedStyle(el).backdropFilter), "none");
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.glassQuality === "low");
      assert.equal(await page.evaluate(() => window.__glass.getPreference()), "low");
      await page.evaluate(() => window.__glass.setPreference("full"));
      await page.waitForFunction(() => document.documentElement.dataset.glassQuality === "full");
      assert.match(await page.locator(".ios-dialog").evaluate(el => getComputedStyle(el).backdropFilter), /blur\(/);
      // Accessibility toggles while the WebView stays alive must change
      // compositing without restarting the app.
      await page.emulateMedia({ forcedColors: "active" });
      await page.waitForFunction(() => document.documentElement.dataset.glassQuality === "low");
      assert.equal(await page.locator(".ios-dialog").evaluate(el => getComputedStyle(el).backdropFilter), "none");
      await page.emulateMedia({ forcedColors: "none" });
      await page.waitForFunction(() => document.documentElement.dataset.glassQuality === "full");
      await page.evaluate(() => window.__glass.setPreference("auto"));
      assert.equal(await page.evaluate(() => window.__glass.getPreference()), "auto");
    }
    if (scenario.name === "low-memory") {
      // A deliberate quality override can opt into full glass, unless
      // accessibility or unsupported blur requires the safe fallback.
      await page.evaluate(() => window.__glass.setPreference("full"));
      await page.waitForFunction(() => document.documentElement.dataset.glassQuality === "full");
      await page.emulateMedia({ forcedColors: "active" });
      await page.waitForFunction(() => document.documentElement.dataset.glassQuality === "low");
      await page.emulateMedia({ forcedColors: "none" });
      await page.waitForFunction(() => document.documentElement.dataset.glassQuality === "full");
    }
    assert.deepEqual(errors, [], `${scenario.name}: no runtime errors`);
    console.log(`PASS ${scenario.name}: ${JSON.stringify(actual)}`);
    await context.close();
  }
} finally {
  await browser?.close();
  await vite.close();
}
