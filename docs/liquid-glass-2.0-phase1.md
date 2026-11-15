# HGuoTokX · Liquid Glass 2.0 · Phase 1

This branch proposes an incremental cross-platform visual refresh. It is **not** a native UIKit Liquid Glass implementation and does not replace playback or networking.

## Delivered

- Shared H + play mark in `hguotokx.svg`, `public/logo.svg`, `app-icon.svg`.
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
