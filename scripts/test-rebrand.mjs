#!/usr/bin/env node
/** Ensure the complete source tree and release metadata use the current brand. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const oldBrand = "hguo" + "tokx"; // Keep former brand out of literal grep matches.
const legacy = new RegExp(oldBrand, "i");
const excluded = new Set([".git", "node_modules", "dist", "target", "gen", "artifacts", "test-results", "coverage"]);
const textExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".md", ".rs", ".toml", ".sh", ".py", ".html", ".css", ".svg", ".xml", ".plist", ".lock", ".list"]);
const textNames = new Set([".gitattributes", ".gitignore", ".npmrc"]);
const failures = [];
let inspected = 0;
function walk(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!excluded.has(entry.name)) walk(join(folder, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    const path = join(folder, entry.name);
    const name = relative(root, path).replaceAll("\\", "/");
    if (legacy.test(name)) failures.push(`Legacy branding in path: ${name}`);
    if (!textExtensions.has(extname(entry.name).toLowerCase()) && !textNames.has(entry.name)) continue;
    if (statSync(path).size > 2000000) continue;
    inspected++;
    const body = readFileSync(path, "utf8");
    if (legacy.test(body)) failures.push(`Legacy branding in content: ${name}`);
  }
}
walk(root);
const config = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
assert.equal(config.productName, "HGuoX");
assert.equal(config.app.windows[0].title, "HGuoX");
assert.equal(config.identifier, "com.hguox.app");
assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name, "hguox");
const manifest = JSON.parse(readFileSync(join(root, "hguox.manifest.json"), "utf8"));
for (const filename of [manifest.default, manifest.android_fg]) {
  assert(existsSync(join(root, filename)), `Missing branded icon asset: ${filename}`);
}
assert.deepEqual(failures, [], "Old product name should not appear in tracked source or resources");
console.log(`PASS: HGuoX source brand audit (${inspected} text files)`);
