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
        navReflection: style(".ios-mobile-nav .hg-glass").backgroundImage,
      };
    });
    assert.equal(actual.quality, scenario.expected, `${scenario.name}: quality`);
    assert.equal(actual.platform, scenario.platform || "windows", `${scenario.name}: platform`);
    assert.equal(actual.cardBlur, "none", `${scenario.name}: scrolling cards do not blur video`);
    if (scenario.expected === "full") {
      assert.match(actual.navBlur, /blur\(/, "Full mode should blur navigation");
      assert.match(actual.dialogBlur, /blur\(/, "Full mode should blur overlays");
      assert.match(actual.navReflection, /radial-gradient\(/, "Full mode includes the glass reflection");
    } else {
      assert.equal(actual.navBlur, "none", `${scenario.name}: nav fallback`);
      assert.equal(actual.dialogBlur, "none", `${scenario.name}: dialog fallback`);
      assert.equal(actual.speedBlur, "none", `${scenario.name}: player menu fallback`);
      assert.equal(actual.navReflection, "none", `${scenario.name}: no reflection in solid mode`);
      assert.notEqual(actual.navBackground, "rgba(0, 0, 0, 0)", `${scenario.name}: nav must stay readable`);
    }
    if (scenario.name === "windows-capable") {
      const measurements = await page.evaluate(async () => ({
        smooth: window.__glassPerformance.assess(Array.from({length:30}, () => 16.7)),
        thirtyHz: window.__glassPerformance.assess(Array.from({length:30}, () => 33.3)),
        overloaded: window.__glassPerformance.assess(Array.from({length:30}, (_, index) => index%3===0 ? 110 : 16.7)),
        invalid: window.__glassPerformance.assess([NaN, -1, 0, 16, Infinity]),
        live: await window.__glassPerformance.sample({ frames:12, timeoutMs:5000 }),
      }));
      assert.equal(measurements.smooth.status, "smooth", "60Hz UI cadence is healthy");
      assert.equal(measurements.thirtyHz.status, "smooth", "30Hz display does not false-positive");
      assert.equal(measurements.overloaded.status, "stutter", "Repeated long frames trigger recommendation");
      assert.equal(measurements.invalid.status, "inconclusive", "Invalid samples are rejected");
      assert.equal(measurements.live.frameCount, 12, "Probe completes and cleans up after requested frames");
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
    
      // A video start should cap only high-cost composites, then restore full
      // refraction on pause. It also handles unmounts without pause events.
      await page.evaluate(() => {
        const video = document.createElement("video");
        video.id = "glass-video-probe";
        Object.defineProperty(video, "paused", { configurable: true, get: () => false });
        Object.defineProperty(video, "ended", { configurable: true, get: () => false });
        document.body.append(video);
        video.dispatchEvent(new Event("play"));
      });
      await page.waitForFunction(() => document.documentElement.dataset.glassVideo === "playing");
      const playingBlur = await page.locator(".ios-dialog").evaluate(el => getComputedStyle(el).backdropFilter);
      assert.match(playingBlur, /blur\(14px\)/, "Playback caps overlay blur at 14px");
      const navGlass = page.locator(".ios-mobile-nav .hg-glass");
      assert.match(await navGlass.evaluate(el => getComputedStyle(el).backdropFilter), /blur\(14px\)/);
      await page.locator("html").evaluate(el => el.classList.add("theme-light", "theme-transitioning"));
      assert.equal(await navGlass.evaluate(el => getComputedStyle(el).backdropFilter), "none", "Theme transition suspends video-mode blur");
      assert.notEqual(await navGlass.evaluate(el => getComputedStyle(el).backgroundImage), actual.navReflection, "Light and dark use different reflections");
      await page.locator("html").evaluate(el => el.classList.remove("theme-light", "theme-transitioning"));
      const tabsBlur = await page.locator(".desktop-home-tabs").evaluate(el => getComputedStyle(el).backdropFilter);
      assert.match(tabsBlur, /blur\(14px\)/, "Desktop video tabs cap blur while playing");
      // Two concurrently playing videos must not race the quality state.
      await page.evaluate(() => {
        const video = document.createElement("video");
        video.id = "second-glass-video";
        Object.defineProperty(video, "paused", { configurable: true, get: () => false });
        Object.defineProperty(video, "ended", { configurable: true, get: () => false });
        document.body.append(video);
        video.dispatchEvent(new Event("play"));
      });
      await page.locator("#glass-video-probe").evaluate(video => video.dispatchEvent(new Event("pause")));
      assert.equal(await page.locator("html").getAttribute("data-glass-video"), "playing", "Other playing video retains compositor cap");
      await page.locator("#second-glass-video").evaluate(video => video.remove());
      await page.waitForFunction(() => document.documentElement.dataset.glassVideo === "idle");
      assert.match(await page.locator(".ios-dialog").evaluate(el => getComputedStyle(el).backdropFilter), /blur\(28px\)/);
      await page.locator("#glass-video-probe").evaluate(video => video.dispatchEvent(new Event("play")));
      await page.waitForFunction(() => document.documentElement.dataset.glassVideo === "playing");
      await page.evaluate(() => window.__glass.setPreference("low"));
      assert.equal(await page.locator(".ios-dialog").evaluate(el => getComputedStyle(el).backdropFilter), "none", "Low quality overrides video cap");
      await page.evaluate(() => window.__glass.setPreference("auto"));
      assert.match(await page.locator(".ios-dialog").evaluate(el => getComputedStyle(el).backdropFilter), /blur\(14px\)/);
      await page.locator("#glass-video-probe").evaluate(video => video.remove());
      await page.waitForFunction(() => document.documentElement.dataset.glassVideo === "idle");
      await page.evaluate(() => {
        const detached = document.createElement("video");
        Object.defineProperty(detached, "paused", { configurable: true, get: () => false });
        detached.dispatchEvent(new Event("play"));
      });
      assert.equal(await page.locator("html").getAttribute("data-glass-video"), "idle", "Detached media events are ignored");
      await page.evaluate(() => {
        const video = document.createElement("video");
        video.id = "video-error-probe";
        Object.defineProperty(video, "paused", { configurable: true, get: () => false });
        Object.defineProperty(video, "ended", { configurable: true, get: () => false });
        document.body.append(video);
        video.dispatchEvent(new Event("playing"));
      });
      await page.waitForFunction(() => document.documentElement.dataset.glassVideo === "playing");
      assert.equal(await page.locator("#video-error-probe").evaluate(el => getComputedStyle(el).backdropFilter), "none", "Video pixels are never backdrop blurred");
      await page.locator("#video-error-probe").evaluate(el => el.dispatchEvent(new Event("error")));
      await page.waitForFunction(() => document.documentElement.dataset.glassVideo === "idle");
      await page.evaluate(() => window.__stopGlassVideo());
      assert.equal(await page.locator("html").getAttribute("data-glass-video"), null, "Cleanup leaves no stale quality attribute");
    }
    if (scenario.name === "low-memory") {
      await page.evaluate(() => document.documentElement.classList.add("theme-light"));
      for (const selector of [".desktop-home-tabs", ".player-speed-menu", ".desktop-context-header .ios-button"]) {
        const style = await page.locator(selector).evaluate(el => {
          const css = getComputedStyle(el);
          return [css.backgroundColor, css.backdropFilter];
        });
        assert.deepEqual(style, ["rgb(36, 36, 42)", "none"], `Light theme preserves the player material at low quality for ${selector}`);
      }
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
