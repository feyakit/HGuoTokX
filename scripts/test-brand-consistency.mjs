#!/usr/bin/env node
/** Static cross-platform brand consistency gate. No external network required. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = file => readFileSync(resolve(root, file), "utf8");
const markers = ["#78D8FF", "#7977FF", "#F28ACF"];
const sources = [
  "app-icon.svg",
  "hguotokx.svg",
  "public/logo.svg",
  "src-tauri/icons/ios/source.svg",
];
for (const file of sources) {
  const svg = read(file);
  assert.match(svg, /<svg\b/, `${file} must be SVG`);
  assert.match(svg, /viewBox="0 0 1024 1024"/, `${file} must share icon geometry`);
  assert.match(svg, /L653 524L483 622/, `${file} must contain H play silhouette`);
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
assert(app.includes("HGuoTok"), "Launch must show current product name");
assert(!app.includes("<span>HGhub</span>"), "Launch must not display the legacy name");
assert(desktop.includes("HGuo"), "Desktop chrome must show current product");
for (const marker of markers) assert(icons.includes(marker), `Inline Logo missing ${marker}`);
const config = JSON.parse(read("src-tauri/tauri.conf.json"));
const beforeBuild = config.build.beforeBuildCommand;
for (const step of ["generate-brand-icons.mjs","generate-ios-icons.mjs","sync-android-icons.mjs","sync-ios-icons.mjs"]) {
  assert(beforeBuild.includes(step), `Build must invoke ${step}`);
}
assert(beforeBuild.indexOf("generate-brand-icons.mjs") < beforeBuild.indexOf("sync-android-icons.mjs"), "Generate brand sources before synchronizing Android");
assert(beforeBuild.indexOf("generate-ios-icons.mjs") < beforeBuild.indexOf("sync-ios-icons.mjs"), "Generate iOS sources before synchronizing Apple");
console.log("PASS: HGuoTokX brand sources, fallbacks and platform build ordering");
