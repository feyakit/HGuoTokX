/* 构建产物红线：不允许出现老 WebView（Chrome 87）不认的 CSS 特性。
 *
 * 背景：小米9 这类老设备的系统 WebView 停在 Chrome 87，@layer 会让整段样式失效，
 * color-mix / aspect-ratio / @container / :has 直接不生效。产物里只要混进一条，
 * 老机器上就是「海报高度塌成 0」「半透明层消失」这种很难归因的问题。
 *
 * 命中任意一条 → 构建失败，别让它悄悄混进包里。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = new URL("../dist/assets/", import.meta.url);
const BANNED = [
  { name: "@layer", test: /@layer\b/g, hint: "CSS 级联层要摊平（见 vite.config.ts 的 postcss 插件）" },
  { name: "color-mix()", test: /color-mix\(/g, hint: "改用 8 位 hex 或 rgba()" },
  { name: "aspect-ratio", test: /aspect-ratio\s*:/g, hint: "改用百分比 padding 或显式 height/calc()" },
  { name: "@container", test: /@container\b/g, hint: "改用 @media" },
  { name: ":has(", test: /:has\(/g, hint: "改用组件加类名 / 属性选择器" },
  { name: "oklch()/oklab()", test: /oklch\(|oklab\(/g, hint: "改用 rgb() 写法" },
];

let files;
try {
  files = readdirSync(DIR).filter(name => name.endsWith(".css"));
} catch {
  console.error("[legacy-css] 找不到 dist/assets，先跑 vite build");
  process.exit(1);
}
if (!files.length) {
  console.error("[legacy-css] dist/assets 里没有 CSS 产物");
  process.exit(1);
}

const hits = [];
for (const file of files) {
  const text = readFileSync(join(DIR.pathname, file), "utf8");
  for (const rule of BANNED) {
    const count = (text.match(rule.test) || []).length;
    if (count) hits.push(`${file}: ${rule.name} ×${count} —— ${rule.hint}`);
  }
}

if (hits.length) {
  console.error("[legacy-css] 产物里还有老内核不支持的特性：");
  for (const line of hits) console.error("  " + line);
  process.exit(1);
}
console.log(`[legacy-css] 通过：${files.length} 个 CSS 产物里没有老内核不支持的特性`);
