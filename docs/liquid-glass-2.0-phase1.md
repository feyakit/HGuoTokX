# HGuoX · Liquid Glass 2.0 · Phase 1

This branch proposes an incremental cross-platform visual refresh. It is **not** a native UIKit Liquid Glass implementation and does not replace playback or networking.

## Delivered

- Shared H + play mark in `hguox.svg`, `public/logo.svg`, `app-icon.svg`.
- Matching **opaque, unmasked square** artwork in `src-tauri/icons/ios/source.svg` (iOS asset pipeline requires it).
- Glass highlight and ambient brand tokens in `src/styles/ios.css`, preserving existing nav, modal, segmented-control layouts and accessibility fallbacks.
- No changes to API routing, media decoding, data storage, OS permissions or app package identifiers.

## Remaining before merging/release

1. Run `pnpm install --frozen-lockfile && pnpm build && pnpm test:ios-ui && pnpm test:ios-icons && pnpm test:ios-overlays && pnpm test:mobile-layout`.
2. **Implemented in phase 2:** `scripts/generate-brand-icons.mjs` stages, validates and refreshes the tracked desktop/Android icon sources from `app-icon.svg` before packaging. CI validates the generator; inspect build output and real app launcher visuals. The checked-in binary icon files may still depict the old logo until deliberately regenerated and committed.
3. `node scripts/generate-ios-icons.mjs` is now checked by CI and runs before native packaging; check the generated opaque iOS icon slots on a real device (corner masking is applied by iOS).
4. Inspect light/dark/high-contrast/reduced-transparency modes on Android, iOS, Windows, macOS and Linux, plus touch/keyboard focus, 44px tap targets and player overlays.
5. Keep existing licenses/attribution. Do not change ATS/network security settings as part of a visual PR.

## Design system

Brand palette: ice blue `#78D8FF`, violet `#7977FF`, rose `#F28ACF`. Use glossy materials on navigation and transient chrome; keep video and reading surfaces solid/legible. Platform-specific gestures and accessible fallbacks remain native-appropriate.

## Review notes

- Phase 1 deliberately preserves the existing `--p-primary` semantics rather than recoloring player buttons.
- Small-size app icon contrast and real-world icon generation require a separate acceptance pass.

## Phase 2 implementation

- Added `scripts/generate-brand-icons.mjs` and included it in Tauri `beforeBuildCommand` and CI. Icons are generated in a temporary directory, validated as PNG/ICO/ICNS and copied to tracked source paths only after all expected slots are present.
- Added quiet ice/violet/rose refraction to non-video mobile navigation. Video navigation and reduced transparency/high contrast stay legible.
- No production binary packages have been built or manually checked as part of this review. CI build is the gate for these scripts; individual platforms still require native acceptance.

## Phase 3 · implemented scope and delivery gates

Code delivered on this branch:
- Cross-platform page chrome for search, page headings, filters, settings cards and Windows/macOS/Linux desktop sidebars.
- Desktop video controls with restrained translucent menus and gradient seek-progress. Playback clock, codecs, network and session logic unchanged.
- Updated visual regression expectations to refer to HGuoX rather than the previous name.
- Static brand consistency test (`pnpm test:brand`).
- CI Chromium fixtures for mobile tab alignment, overlays/focus/back handling and the real App's 390×844 dark-mode viewport. Screenshots are uploaded if that CI job fails.

**Definition of done before release**
1. Green latest-head CI: frontend, icon generation, static brand test, Chromium fixtures and Rust compilation.
2. Run the existing full UI matrix (`pnpm test:ios-ui`) and the video regression suite (`pnpm test:playback`) against the candidate commit.
3. Build and install Android APK, iOS unsigned/signed target as appropriate, Windows setup/portable, macOS app/dmg, Linux deb. Check package name, launcher icon, splash and window branding.
4. Verify login/logout, account scope, favorites, playback resume, episode swipes, search/history, proxy line switching and security preferences on **real devices**. Browser mocks do not prove native media success.
5. Re-evaluate iOS ATS `NSAllowsArbitraryLoads` in the unsigned workflow with a documented upstream-network compatibility matrix before altering networking.
6. Inspect light/dark, high contrast, reduced motion, reduced transparency, landscape, safe areas, keyboard tab order and low-power performance.
7. Confirm redistribution complies with original PolyForm Noncommercial license and the project README's distribution restrictions.

**Not complete in this branch:** signed store submissions, real-device installation evidence, native API-level Liquid Glass and full feature regression. The visual layer is a WebView/CSS-inspired material system.

## Phase 4 · Full Glass and platform-aware degradation

**Default appearance:** high-fidelity glass is enabled on capable devices. Platform-specific blur ceilings are set through `data-glass-platform`: iOS 38 px, macOS 36 px, Windows 28 px, Android 22 px and Linux 16 px (these are styling caps, not claims of device support).

**Auto downgrade:** `src/glassQuality.ts` sets `data-glass-quality="low"` when CSS backdrop blur is unavailable, when device-memory reports ≤2 GB, when hardware concurrency reports ≤2 logical cores, or when the OS requests reduced transparency, increased contrast or forced colors. Unsupported optional hardware fields do not automatically downgrade. System preference changes are observed live; no identifiers or preferences are persisted.

**Frame cost control:** blur is limited to mobile navigation, transient dialogs/toasts, desktop search and related compact controls. Normal cards, settings lists and account cards use solid material surfaces even in full mode. The bottom navigation over video uses a maximum 8 px blur with an opaque contrasting base. Video frames, posters and long lists are not wrapped in a live blurred backdrop.

**Accessibility and compatibility:** low mode uses legible solid colors; existing reduced-motion and high-contrast rules remain in force. Fallbacks are applied by CSS even when JavaScript is delayed. The rendering policy is a capability heuristic, not a real-time GPU frame-rate monitor. It cannot guarantee 60 fps or identical glass compositing on all WebViews.

**Validation:** `pnpm test:glass-quality` checks full mode on five platform-token variants plus low-memory, low-core and forced-color fallback scenarios in Chromium. This is a WebView-style regression, not native iOS/Android/Windows/macOS/Linux acceptance testing.

## Phase 5 · selected neon-glass X branding

The selected direction is the **second dark neon-glass concept**: luminous warm
peach/play core, cyan-violet X ribbons and a deep indigo app tile, **without
text inside the icon**.

- `app-icon.svg`, `hguox.svg`, and `public/logo.svg` share one
  scalable, self-contained vector **interpretation** of the selected concept.
  This is not a pixel-for-pixel tracing of the photorealistic generated image.
- `src-tauri/icons/ios/source.svg` uses the same artwork but has no pre-rounded
  mask and no corner-stroke so Apple can apply its own shape.
- All native icon slots are generated at build time by
  `generate-brand-icons.mjs` and `generate-ios-icons.mjs`, then synchronized
  to generated mobile projects by the platform sync scripts.
- In-app branding and launch screen reference `/logo.svg` rather than retaining
  independent copies of the earlier H silhouette.
- Brand static tests now require the new warm/cool gradients, core/play
  geometry and the shared icon source.

**Source-art fidelity:** the user-approved 1254-pixel concept is maintained as
a separate original artwork and should be archived unmodified. The vector
interpretation deliberately simplifies photographic refractions to remain
legible at 32–48 px. Pixel-identical icon packaging requires committing the
original image as a native binary asset, followed by icon generation and
real-device mask checks; it must not be claimed from the vector alone.

## Phase 6 · Runtime glass quality controls

Appearance Settings exposes **自动 / 完整 / 省电**. Auto remains the default: full
quality on supported devices, low cost when reported device RAM is ≤2 GB or
logical cores ≤2. Choosing "完整" overrides those *hardware heuristics* only;
it **cannot** override missing CSS blur, reduced transparency, high contrast
or forced colors. "省电" switches navigational and dialog backgrounds to
solid, readable materials. Changing modes applies immediately and saves just
one device-local preference key (`hguox_glass_preference_v1`). The update
event is handled across tabs/windows via the storage listener.

`pnpm test:glass-quality` verifies persistence across reload, live quality
switches, low-memory manual override and forced-colors priority. Real-world
GPU load varies with drivers, WebView compositor and video decoder and still
requires on-device validation.
