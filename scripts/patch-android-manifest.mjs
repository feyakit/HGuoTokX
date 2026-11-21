#!/usr/bin/env node
/**
 * 把 Android 侧两项 Tauri 配置没暴露的设置补进生成工程：
 *   1. `targetSdkVersion` = 34
 *      —— tauri.conf.json 的 bundle.android 只支持 minSdkVersion / versionCode，
 *         生成的 gradle 默认跟 compileSdk 走（本机装的是 android-36），
 *         不提回来会跟 34 的设备行为不一致（权限弹窗、后台限制）。
 *   2. `android:allowBackup="false"` / `android:fullBackupContent="false"`
 *      —— 播放器不该把登录态/缓存备份到云。
 *
 * 为什么是脚本：src-tauri/gen/ 在 .gitignore 里，CI 每次 `tauri android init --ci`
 * 都会重建，直接改生成文件下次就没了（与 inject-android-plugin.mjs 同样道理）。
 *
 * 何时跑：`pnpm tauri android init --ci` 之后、`pnpm tauri android build` 之前。
 * 幂等：重复跑不会重复改；缺文件直接报错退出，不静默跳过。
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const genRoot = join(repoRoot, "src-tauri", "gen", "android");
const TARGET_SDK = "34";

if (!existsSync(genRoot)) {
  console.error("[android-manifest] 找不到 src-tauri/gen/android\n  先跑 `pnpm tauri android init --ci`");
  process.exit(1);
}

function findProjectDir() {
  for (const name of readdirSync(genRoot)) {
    const dir = join(genRoot, name);
    if (existsSync(join(dir, "build.gradle.kts")) || existsSync(join(dir, "build.gradle"))) {
      const manifest = join(dir, "src", "main", "AndroidManifest.xml");
      if (existsSync(manifest)) return { dir, manifest, gradle: existsSync(join(dir, "build.gradle.kts")) ? join(dir, "build.gradle.kts") : join(dir, "build.gradle") };
    }
  }
  return null;
}

const found = findProjectDir();
if (!found) {
  console.error("[android-manifest] gen/android 下没找到带 AndroidManifest.xml 的 app 工程");
  process.exit(1);
}

/* ---------- 1. targetSdkVersion ---------- */
let gradle = readFileSync(found.gradle, "utf8");
const before = gradle;
gradle = gradle.replace(/(targetSdk(?:Version)?\s*[=:(]\s*)(\d+)/g, (_, head) => `${head}${TARGET_SDK}`);
/* 没有就补一行到 defaultConfig 里 */
if (gradle === before && !/targetSdk(?:Version)?\s*[=:(\s]/.test(gradle)) {
  gradle = gradle.replace(/(defaultConfig\s*\{)/, `$1\n        targetSdkVersion = ${TARGET_SDK}`);
}
if (gradle === before && !new RegExp(`targetSdk(?:Version)?\\s*[=:(]\\s*${TARGET_SDK}\\b`).test(gradle)) {
  console.error(`[android-manifest] 没能把 targetSdkVersion 改成 ${TARGET_SDK}（${relative(repoRoot, found.gradle)} 结构变了）`);
  process.exit(1);
}
if (gradle !== before) writeFileSync(found.gradle, gradle);

/* ---------- 2. allowBackup / fullBackupContent ---------- */
let manifest = readFileSync(found.manifest, "utf8");
const manifestBefore = manifest;
const attrs = [["allowBackup", "false"], ["fullBackupContent", "false"]];
for (const [name, value] of attrs) {
  const re = new RegExp(`android:${name}\\s*=\\s*"[^"]*"`);
  if (re.test(manifest)) {
    manifest = manifest.replace(re, `android:${name}="${value}"`);
  } else if (/<application\b/.test(manifest)) {
    manifest = manifest.replace(/<application\b/, `<application\n        android:${name}="${value}"`);
  } else {
    console.error("[android-manifest] AndroidManifest.xml 里没有 <application>");
    process.exit(1);
  }
}
if (manifest !== manifestBefore) writeFileSync(found.manifest, manifest);

const sdkOk = new RegExp(`targetSdk(?:Version)?\\s*[=:(]\\s*${TARGET_SDK}\\b`).test(gradle);
const backupOk = /android:allowBackup="false"/.test(manifest) && /android:fullBackupContent="false"/.test(manifest);
console.log(`[android-manifest] ${relative(repoRoot, found.gradle)}: targetSdkVersion=${TARGET_SDK} ${sdkOk ? "✓" : "✗"}`);
console.log(`[android-manifest] ${relative(repoRoot, found.manifest)}: allowBackup=false ${backupOk ? "✓" : "✗"}`);
if (!sdkOk || !backupOk) process.exit(1);
