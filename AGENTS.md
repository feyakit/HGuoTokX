# AGENTS.md

给 AI 编码助手的项目约定。改代码前请先读完这一页，能省掉大部分返工。

## 这是什么项目

`HGuoX` 是基于 [HGhubX](https://github.com/zxsos/HGhubX) 的**二次定制**：
Tauri 2 + React 19 + TypeScript + Rust，目标是 **Android 手机自用**。

- 许可证 **PolyForm Noncommercial 1.0.0**：禁止商用；`LICENSE` 里的
  `Required Notice: Copyright (c) 2026 HGhubX contributors` **必须保留**，
  不许删、不许改成自己的名字。
- 上游是活的，会持续更新。改动原则：**能不改上游代码就不改**，
  优先在配置、图标、样式层做定制，这样同步上游时不打架。

## 构建与验证

本地大概率**没有 cargo / rustc / Android NDK**（我在容器里就是），所以：

| 想验证什么 | 怎么验 |
|---|---|
| TypeScript 类型 + 前端打包 | `pnpm build`（= `tsc --noEmit && tsc -p tsconfig.tests.json && vite build`） |
| 单元/回归用例 | `pnpm test:<名字>`，全部列在 `package.json` 的 scripts 里 |
| 出 Android ARM64 测试 APK | 推送 Liquid Glass 开发分支，由 `preview-android.yml` 输出临时签名测试包 |

CI（`.github/workflows/`）：

- `ci.yml` — push main / Liquid Glass 开发分支或更新 PR 时，运行前端构建、Rust 编译和 UI 回归
- `release.yml` — Liquid Glass 分支推送时打包 iOS、Windows、macOS 和 Linux 预览。正式发布使用 `v*` tag 或带 tag 的手动运行。

**不要**为了验证一个前端改动去推 tag：一次五平台构建 30 分钟。

## 已知的坑（都真踩过）

### 1. iOS 图标的 `source.svg` 有三个硬性要求

`scripts/generate-ios-icons.mjs` 会校验 `src-tauri/icons/ios/source.svg`：

```js
if (/\brx\s*=|\bstroke\s*=/.test(sourceSvg.split("<g", 1)[0])) throw ...
```

- **背景必须是正方形、不带 `rx`、不带 `stroke`**（系统自己裁圆角）
- 校验只看**第一个 `<g>` 之前**的内容，所以内容图元**必须包在 `<g>` 里**，
  否则整个文件都算「背景」，内容里的 `rx` 也会被拒
- 这个文件缺失或不合规，**五个平台全部在 `beforeBuildCommand` 第一步就失败**，
  报错信息各不相同但根因都在这

### 2. 换图标时别漏非 PNG 文件

重新生成 `src-tauri/icons/` 时如果只处理 `.png`，会把 `ios/source.svg`
这类文件弄丢，后果同上。

### 3. 包名与产品名

```
identifier    com.hguox.app
productName   HGuoX
Cargo 包名     hghubx（保留旧技术标识，改了要连带修改 iOS/Xcode 工程配置）
```

### 4. 签名

`.github/workflows/release.yml` 的正式发布要求配置 `ANDROID_KEY_BASE64` 和对应签名凭据。
临时密钥只用于测试，测试包文件名带 `TEST-KEY`。请用备用设备或无现有安装的测试环境。
keystore 不在仓库里，别去找。

## 代码约定

- **注释和提交信息用中文**，解释「为什么」而不是「做了什么」
- 提交署名固定：

  ```
  git -c user.name="feyakit" -c user.email="feya0517@gmail.com" commit
  ```

- 新增功能尽量带一个 `tests/xxx.html` + `tests/xxx.tsx` + `scripts/test-xxx.mjs`
  的回归用例（上游这套基建很完整，照着写就行），并在 `package.json` 加 script
- 中文文案要贴合产品语气：直接、不夸张、不用营销词

## 别做的事

- 删 `LICENSE` 里的版权声明，或把项目说成完全原创
- 重构上游的业务逻辑（`Feed.tsx`、`net.rs`、`media.rs` 这些）——一旦分叉过大，
  以后同步上游就要手动合并
- 把 `hghubx_` 开头的 localStorage 键名改掉——那是存储迁移逻辑的基准，
  改了老用户的收藏/历史会丢
- 在没跑 `pnpm build` 的情况下提交

## 同步上游

上游**只有一个来源**：`zxsos/HGhubX`。别从其他 fork 或同名仓库取代码；代码注释里出现的
`Minireel/HGhubX`、`zhujinrun/HGhubX` 只是历史出处说明（这两个仓库已不存在），不是上游。

```bash
git remote add upstream https://github.com/zxsos/HGhubX.git   # 只需一次
git fetch upstream
git log --oneline upstream/$(git describe --tags --abbrev=0 upstream/main)..upstream/main   # 上次同步点之后上游多了什么
git diff main upstream/main -- <某个文件>     # 看具体改动
git checkout upstream/main -- <某个文件>      # 只取某个文件（取完记得改品牌名）
```

取完上游文件后，把 `HGhubX` 换成 `HGuoX`、`com.hghubx.app` 换成 `com.hguox.app`。

> 更名提醒：新的 `com.hguox.app` 会被系统视为不同的应用标识，正式升级前须评估已有安装与本机数据迁移。
