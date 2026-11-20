#!/usr/bin/env node
/**
 * 把仓库里被跟踪的安卓 Kotlin 源（src-tauri/android/**）复制进 tauri 生成的
 * 安卓工程（src-tauri/gen/android/app/src/main/java/**）。
 *
 * 为什么需要这一步：src-tauri/gen/ 在 .gitignore 里，CI 每次 `tauri android init --ci`
 * 都会重建它，任何直接写在 gen/ 里的 Kotlin 都会在下次构建时消失。所以源放在
 * src-tauri/android/（被跟踪），构建前注入。
 *
 * 什么时候跑：`pnpm tauri android init --ci` 之后、`pnpm tauri android build` 之前
 * （见 .github/workflows/release.yml）。tauri android build 不会重跑 init，所以注入的文件不会被覆盖。
 *
 * 幂等：可以重复跑，覆盖目标同名文件。
 * 缺 gen/android（没 init）直接报错退出，不静默跳过。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(repoRoot, "src-tauri", "android");
const destRoot = join(repoRoot, "src-tauri", "gen", "android", "app", "src", "main", "java");

if (!existsSync(srcRoot)) {
  console.log("[android-plugin] 没有 src-tauri/android/，跳过");
  process.exit(0);
}
if (!existsSync(destRoot)) {
  console.error(
    "[android-plugin] 找不到 " + relative(repoRoot, destRoot) + "\n" +
      "  先跑 `pnpm tauri android init --ci` 生成安卓工程，再执行本脚本。"
  );
  process.exit(1);
}

let copied = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const from = join(dir, entry);
    if (statSync(from).isDirectory()) {
      walk(from);
      continue;
    }
    if (!entry.endsWith(".kt") && !entry.endsWith(".java")) continue;
    const to = join(destRoot, relative(srcRoot, from));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    console.log("[android-plugin] " + relative(repoRoot, from) + " → " + relative(repoRoot, to));
    copied += 1;
  }
};
walk(srcRoot);

if (!copied) {
  console.error("[android-plugin] src-tauri/android/ 里没有 .kt/.java，什么都没注入");
  process.exit(1);
}
console.log("[android-plugin] 注入完成：" + copied + " 个文件");
