#!/usr/bin/env node
/** Static cross-platform brand consistency gate. No external network required. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = file => readFileSync(resolve(root, file), "utf8");
const markers = ["#F9488C", "#29E5FC", "#7F55FF"];
const sources = [
  "app-icon.svg",
  "hguox.svg",
  "public/logo.svg",
  "src-tauri/icons/ios/source.svg",
];
for (const file of sources) {
  const svg = read(file);
  assert.match(svg, /<svg\b/, `${file} must be SVG`);
  assert.match(svg, /viewBox="0 0 1024 1024"/, `${file} must share icon geometry`);
  assert.match(svg, /M453 414/, `${file} must contain new play triangle`);
  for (const layer of ["orbitWarm", "orbitCool", "peach", "play"]) assert(svg.includes(layer), `${file}: missing neon-glass ${layer} layer`);
  for (const marker of markers) assert(svg.includes(marker), `${file}: missing ${marker}`);
}
const ios = read("src-tauri/icons/ios/source.svg");
assert(!/<clipPath\b/.test(ios), "iOS source must be square and unmasked");
assert(/<rect width="1024" height="1024" fill="url\(#back\)"/.test(ios), "iOS source must provide opaque background");
const web = read("public/logo.svg");
assert(web.includes('clip-path="url(#appMask)"'), "Other platforms should retain rounded mark");
const css = read("src/styles/ios.css");
for (const token of ["--brand-ice", "--brand-violet", "--brand-pink", "--glass-rim"]) assert(css.includes(token), `Missing ${token}`);
assert(css.includes("prefers-reduced-transparency"), "Must have transparency fallback");
assert(css.includes("forced-colors:active"), "Must have forced-color fallback");
const app = read("src/components/LaunchAnimation.tsx");
const desktop = read("src/components/DesktopChrome.tsx");
const icons = read("src/icons.tsx");
const wordmark = app.match(/className="hg-launch-wordmark">(.+?)<\/div>/)?.[1];
assert.equal(wordmark?.replace(/<[^>]+>/g, ""), "HGuoX", "Visible launch wordmark must match the current product name");
assert(!app.includes("<span>HGhub</span>"), "Launch must not display the legacy name");
assert(desktop.includes("HGuo"), "Desktop chrome must show current product");
assert(icons.includes('src="/logo.svg"'), "In-app Logo must use the same public source as the launcher");
assert(app.includes('src="/logo.svg"'), "Launch animation must render the selected source");
assert(!app.includes("hg-launch-left"), "Legacy H stroke launch animation must not be displayed");
const config = JSON.parse(read("src-tauri/tauri.conf.json"));
const splashColor = /--launch-bg:\s*(#[0-9a-f]{6});/i.exec(read("src/styles/launch.css"))?.[1];
assert(splashColor, "The launch reveal must have an explicit base background");
assert.equal(config.app.windows[0].backgroundColor, splashColor);
assert.equal(JSON.parse(read("src-tauri/tauri.macos.conf.json")).app.windows[0].backgroundColor, splashColor);
assert(read("index.html").includes(`background:${splashColor}`));
assert(read("scripts/patch-android-splash.mjs").includes(`const BRAND = "${splashColor}"`));
const iosChannels = splashColor.slice(1).match(/../g);
for (const [channel, index] of [["red", 0], ["green", 1], ["blue", 2]]) {
  assert(read("scripts/patch-ios-splash.mjs").includes(`${channel}: "0x${iosChannels[index]}"`));
}
const adaptive = JSON.parse(read("hguox.manifest.json"));
assert.equal(read(adaptive.default), web, "Launcher manifest and web app use the same mark");
assert(read("scripts/generate-brand-icons.mjs").includes('"hguox.manifest.json"'));
assert(read("src-tauri/icons/android/values/ic_launcher_background.xml").includes(adaptive.bg_color));
assert.match(read("src-tauri/icons/android/mipmap-anydpi-v26/ic_launcher.xml"), /@mipmap\/ic_launcher_foreground/);
const beforeBuild = config.build.beforeBuildCommand;
for (const step of ["generate-brand-icons.mjs","generate-ios-icons.mjs","sync-android-icons.mjs","sync-ios-icons.mjs"]) {
  assert(beforeBuild.includes(step), `Build must invoke ${step}`);
}
assert(beforeBuild.indexOf("generate-brand-icons.mjs") < beforeBuild.indexOf("sync-android-icons.mjs"), "Generate brand sources before synchronizing Android");
assert(beforeBuild.indexOf("generate-ios-icons.mjs") < beforeBuild.indexOf("sync-ios-icons.mjs"), "Generate iOS sources before synchronizing Apple");
console.log("PASS: selected HGuoX neon-glass X icon, consistent app sources and platform build ordering");
