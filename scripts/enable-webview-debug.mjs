#!/usr/bin/env node
/**
 * 【仅诊断分支 test/webview-debug】给 release APK 打开 Android WebView 远程调试。
 *
 * 背景：只有 debug 变体的 WebView 才允许 chrome://inspect 连 CDP；测试机装的是 release 包，
 * 要逐条关属性二分定位「帖子详情页按住下滑持续闪」，就必须在 release 里显式打开。
 *
 * 做法：改生成工程里的 MainActivity，在 onCreate 里调
 *   WebView.setWebContentsDebuggingEnabled(true)
 * gen/ 不入库（CI 每次 init 重建），所以必须做成 init 之后的补丁；幂等。
 *
 * ⚠️ 这个脚本只应该被 test/webview-debug 分支的 workflow 调用，**不要合进 main**：
 *    打开后同局域网任何人都能 attach 调试 WebView。
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const javaRoot = join(repoRoot, "src-tauri", "gen", "android", "app", "src", "main", "java");

if (!existsSync(javaRoot)) {
  console.error("[webview-debug] 找不到 src-tauri/gen/android/app/src/main/java\n  先跑 `pnpm tauri android init --ci`");
  process.exit(1);
}

function findMainActivity(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      const hit = findMainActivity(full);
      if (hit) return hit;
    } else if (name === "MainActivity.kt" || name === "MainActivity.java") {
      return full;
    }
  }
  return null;
}

const target = findMainActivity(javaRoot);
if (!target) {
  console.error("[webview-debug] gen/android 下没找到 MainActivity");
  process.exit(1);
}

let source = readFileSync(target, "utf8");
const before = source;
const isKotlin = target.endsWith(".kt");

if (!source.includes("WebView.setWebContentsDebuggingEnabled")) {
  if (isKotlin) {
    if (!/^import\s+android\.webkit\.WebView\s*$/m.test(source)) {
      /* 放在第一个 import 之前，沿用 Kotlin 的 import 顺序要求不敏感 */
      source = source.replace(/^(import\s+)/m, "import android.webkit.WebView\n$1");
    }
    if (!/onCreate\s*\(/.test(source)) {
      console.error("[webview-debug] MainActivity.kt 里没有 onCreate，结构变了");
      process.exit(1);
    }
    source = source.replace(/(super\.onCreate\([^)]*\)\s*\n)/, (m) => `${m}        WebView.setWebContentsDebuggingEnabled(true)\n`);
  } else {
    if (!/^import\s+android\.webkit\.WebView;/m.test(source)) {
      source = source.replace(/^(import\s+)/m, "import android.webkit.WebView;\n$1");
    }
    source = source.replace(/(super\.onCreate\([^)]*\);\s*\n)/, (m) => `${m}        WebView.setWebContentsDebuggingEnabled(true);\n`);
  }
}

if (!source.includes("WebView.setWebContentsDebuggingEnabled")) {
  console.error("[webview-debug] 没能插进 onCreate（模板结构变了）");
  process.exit(1);
}
if (source !== before) writeFileSync(target, source);
console.log(`[webview-debug] ${relative(repoRoot, target)}: setWebContentsDebuggingEnabled(true) ✓`);
