#!/usr/bin/env node
/**
 * Regenerate desktop and Android launch icons from the shared HGuoX artwork.
 * iOS uses its unmasked opaque source.svg and dedicated generator.
 *
 * Generation is staged and validated before updating the tracked icon sources.
 * Run before bundling so CI and local builds cannot silently ship stale icons.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const source = join(root, "hguox.manifest.json");
const icons = join(root, "src-tauri", "icons");
const staging = mkdtempSync(join(tmpdir(), "hguox-brand-icons-"));

const desktop = [
  "32x32.png", "64x64.png", "128x128.png", "128x128@2x.png", "icon.png", "icon.ico", "icon.icns",
];
const densities = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
const android = densities.flatMap(density => [
  `android/mipmap-${density}/ic_launcher.png`,
  `android/mipmap-${density}/ic_launcher_foreground.png`,
  `android/mipmap-${density}/ic_launcher_round.png`,
]);
const required = [...desktop, ...android];
const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function validate(path) {
  const data = readFileSync(path);
  if (data.length < 33) throw new Error(`Icon unexpectedly small: ${path}`);
  if (path.endsWith(".png")) {
    if (!data.subarray(0, 8).equals(pngHeader)) throw new Error(`Invalid PNG: ${path}`);
    if (data.readUInt32BE(16) < 16 || data.readUInt32BE(20) < 16) throw new Error(`Invalid PNG dimensions: ${path}`);
  }
  if (path.endsWith(".ico") && (data[0] !== 0 || data[1] !== 0 || data[2] !== 1)) throw new Error(`Invalid ICO: ${path}`);
  if (path.endsWith(".icns") && data.toString("ascii", 0, 4) !== "icns") throw new Error(`Invalid ICNS: ${path}`);
}

try {
  if (!existsSync(cli) || !existsSync(source)) throw new Error("请安装依赖并提供 hguox.manifest.json 后再生成图标");
  execFileSync(process.execPath, [cli, "icon", "--output", staging, source], { cwd: root, stdio: "inherit" });
  // Validate the entire output before overwriting any tracked source asset.
  for (const name of required) {
    const generated = join(staging, name);
    const destination = join(icons, name);
    if (!existsSync(generated) || !existsSync(destination)) throw new Error(`Missing required icon slot: ${name}`);
    if (!statSync(generated).isFile()) throw new Error(`Invalid icon slot: ${name}`);
    validate(generated);
  }
  for (const name of required) copyFileSync(join(staging, name), join(icons, name));
  console.log(`[icons] regenerated and validated ${required.length} desktop/Android assets`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
