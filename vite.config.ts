import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

const host = process.env.TAURI_DEV_HOST;
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

/** Chrome 87 及更老的 WebView 不认 CSS 级联层，@layer 块会被整段丢弃。
 *  这里按源码顺序把块里的规则展开到外面（@layer a, b; 这种只声明顺序的直接删掉），
 *  层叠顺序与 Tailwind 的声明顺序一致，行为不变，但老内核也读得到。 */
const stripCascadeLayers = {
  postcssPlugin: "hguox-strip-cascade-layers",
  Once(root: { walkAtRules: (name: string, fn: (at: any) => void) => void }) {
    /* 嵌套层要多扫几轮：外层展开后，里层才成为顶层节点 */
    for (let pass = 0; pass < 4; pass += 1) {
      let found = false;
      root.walkAtRules("layer", (at: any) => {
        found = true;
        if (at.nodes) at.replaceWith(at.nodes);
        else at.remove();
      });
      if (!found) break;
    }
    /* Tailwind 给每个半透明色都写成「hex 兜底 + @supports(color-mix) 增强」，
       兜底值等价（#ffffff1a 就是 10% 白）。Chrome 87 不认 color-mix，
       保留这段只会让产物里躺着用不上的特性，整块删掉，各内核看到同一套颜色。 */
    root.walkAtRules("supports", (at: any) => {
      const params = String(at.params || "");
      if (params.includes("color-mix(")) at.remove();
    });
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // 版本号只维护 package.json（CI 会按 tag 改写它），界面里的版本由这里注入，避免写死后漂移
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  css: {
    /* Chrome 87 不认 @layer：Tailwind v4 的工具类全在层里，老内核会整段丢弃 → 构建期摊平 */
    postcss: { plugins: [stripCascadeLayers] },
  },
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
});
