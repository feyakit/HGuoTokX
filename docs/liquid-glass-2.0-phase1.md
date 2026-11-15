# HGuoTokX · Liquid Glass 2.0 · Phase 1

This branch proposes an incremental cross-platform visual refresh. It is **not** a native UIKit Liquid Glass implementation and does not replace playback or networking.

## Delivered

- Shared H + play mark in `hguotokx.svg`, `public/logo.svg`, `app-icon.svg`.
- Matching **opaque, unmasked square** artwork in `src-tauri/icons/ios/source.svg` (iOS asset pipeline requires it).
- Glass highlight and ambient brand tokens in `src/styles/ios.css`, preserving existing nav, modal, segmented-control layouts and accessibility fallbacks.
- No changes to API routing, media decoding, data storage, OS permissions or app package identifiers.

## Remaining before merging/release

1. Run `pnpm install --frozen-lockfile && pnpm build && pnpm test:ios-ui && pnpm test:ios-icons && pnpm test:ios-overlays && pnpm test:mobile-layout`.
2. Run `pnpm tauri icon app-icon.svg` in a controlled build environment, review the generated **desktop/Android** PNG/ICO/ICNS assets and commit them only after inspection. Current tracked binary assets still show the old mark; `beforeBuildCommand` synchronizes them but does not automatically regenerate those source binaries.
3. Run `node scripts/generate-ios-icons.mjs` and verify opaque icon slots; check generated iOS icons on device (corner masking is applied by iOS).
4. Inspect light/dark/high-contrast/reduced-transparency modes on Android, iOS, Windows, macOS and Linux, plus touch/keyboard focus, 44px tap targets and player overlays.
5. Keep existing licenses/attribution. Do not change ATS/network security settings as part of a visual PR.

## Design system

Brand palette: ice blue `#78D8FF`, violet `#7977FF`, rose `#F28ACF`. Use glossy materials on navigation and transient chrome; keep video and reading surfaces solid/legible. Platform-specific gestures and accessible fallbacks remain native-appropriate.

## Review notes

- Phase 1 deliberately preserves the existing `--p-primary` semantics rather than recoloring player buttons.
- Small-size app icon contrast and real-world icon generation require a separate acceptance pass.
