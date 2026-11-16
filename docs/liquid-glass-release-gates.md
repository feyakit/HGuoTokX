# HGuoX Liquid Glass 2.0 — Release Gate & Device QA

Status: **Draft PR / not cleared for production release**.

This document separates **CI passing** from **native WebView acceptance**.
GitHub Actions Chromium tests simulate platform CSS variants; they do NOT
prove iOS WKWebView, Android System WebView, Windows WebView2, macOS WKWebView
or Linux WebKitGTK performance.

## Development log

| Change | Evidence |
|---|---|
| Integrated `main` 3.0.0 in `f9a39ad` | [Integration CI](https://github.com/feyakit/HGuoX/actions/runs/43794221846) passed TypeScript/Vite, Rust compile checks and Chromium UI tests. Main's playback and tag-pagination files are present in the integration tree. |
| Launch and icon fixes | Visible wordmark, WebView first paint and native launch backgrounds are aligned. The Android launcher generator consumes the adaptive foreground manifest. Generated Android foregrounds have transparent corners across all five densities. The iOS generator validates 18 opaque square assets. |
| Glass and layout | Mobile dialogs and sheets use safe-area padding, full mode uses light/dark reflection gradients, and theme transitions suspend backdrop blur. Video playback caps blur on additional navigation surfaces. The Chromium fixture tests these changes. |
| Native build coverage | Feature-branch pushes run Windows NSIS/portable, Linux DEB, macOS arm64 DMG and unsigned iOS IPA jobs in `release.yml`. Android runs the separate ARM64 preview. Artifacts are tied to the Actions commit, with native device acceptance recorded below. |

## Current release blockers

1. **Integrated build validation:** `main` at `85a506d` was integrated into
   the Liquid Glass feature branch. Frontend, Rust and Tauri use `3.0.0`,
   with Android version code `3000000`. The merge retains independent tag
   pagination and source-specific video sizing from `main`, plus the glass
   rendering policy and neon X icon sources from the feature branch. The
   integrated revision needs CI results and five-platform native QA.
   Confirm version ordering again before a formal release.
2. **Android identity and upgrade:** the app identifier is
   `com.hguox.app`. This may be a different Android app from older package
   identifiers. Changing this identifier can isolate app-local storage.
   A new random preview signing key is generated for each preview run, so
   different preview packages cannot be treated as safe in-place updates.
3. **Logo fidelity:** the selected second dark-neon concept is represented
   by reproducible SVG icon sources, but native OS launcher masks, tiny icon
   legibility and any pixel-identical master artwork need visual review.
4. **Native device testing:** each platform below needs an observed result,
   including reduced-transparency, contrast, light/dark, rotation and video
   playback behavior. No platform should be marked "verified" solely because
   Chromium tests passed.
5. **Signing/notarization:** unsigned iOS/macOS output, untrusted test-key
   Android output and other preview archives are QA artifacts, not production
   releases. Configure managed release signing/notarization separately.
6. **Version/update channel:** ensure Android versionCode is monotonically
   higher for the *same* package+signer upgrade path. Verify the updater's
   published version, URL, package identity and signing expectations.

## Generating an Android arm64 test artifact

On pushes to `design/liquid-glass-brand-v1`, the independent
`.github/workflows/preview-android.yml` job builds an APK from the exact
branch commit. It uploads an artifact named
`hguox-liquid-glass-arm64-preview` (retained for seven days).

Artifact contents:
- `HGuoX_<SHA>_arm64_TEST-KEY.apk`
- `SHA256SUMS.txt`
- `package-identity.txt`
- `signature-verification.txt`
- `README-TEST-APK.md`

**Do not upgrade another app build with this APK.** Every build uses a fresh,
untrusted certificate; Android will refuse mismatched signing keys.
Use a spare device without an existing HGuoX installation. Uninstalling an app
can destroy its local favorites, history and settings. A successful
`apksigner verify` confirms the test signature and file integrity.

## Package and upgrade checks

| Item | State |
|---|---|
| Product / identifier / version | `HGuoX` / `com.hguox.app` / `3.0.0` with Android version code `3000000`. |
| Android release signing | Tagged publication requires a configured stable Android signing key. Verify the actual release certificate against the installed release and check that the candidate version code is higher. |
| iOS and macOS signing | The current iOS artifact is unsigned. The macOS preview is ad-hoc signed. Distribution identity, provisioning and notarization need deployment verification before publication. |
| Windows and Linux packaging | Windows emits NSIS and a portable ZIP. Linux emits an amd64 DEB. Validate trust and runtime dependencies on the target systems. |
| Old app data | `hghubx_*` keys and same-storage migration are retained. A package-identifier change creates another app data container. Validate backup, restore and rollback with a preserved old install before describing a migration as supported. |
| Selected logo source | The SVG sources implement the selected neon X concept. The 1254 px original could not be matched to a confirmed source file during this handoff. Pixel fidelity and launcher appearance remain open. |

## Real-device acceptance matrix

| Platform | Target | QA actions | Result |
|---|---|---|---|
| Android | arm64 System WebView | Open, back navigation, immersive video, 30+ seconds playing, orientation, switch Full/Low during playback, minimize/reopen, clear cache | Pending |
| iOS | WKWebView | Safe areas, keyboard, swipe/back, portrait/landscape, glass legibility, accessibility, signed-device deployment | Pending |
| Windows | WebView2 | DPI 100%/150%/200%, resizing, maximize, HLS playback, always-on-top overlays, portable/installer | Pending |
| macOS | WKWebView | traffic lights, fullscreen, Retina scaling, backdrop priority, Apple Silicon installer and notarization expectations | Pending |
| Linux | WebKitGTK | GTK distro compatibility, 100%/200% scaling, video decoder fallback, blur support/solid material, installer | Pending |

### Required visual checks

- Confirm the bottom bar never blocks interactive controls or safe areas.
- Confirm the selected dark neon icon is clear at 32, 48, 128 and 512px,
  including Android adaptive masks and Apple's system corner mask.
- Open a dialog over live video; confirm text stays readable and video isn't
  itself blurred or duplicated.
- Toggle **自动 / 完整 / 省电**, then restart. Confirm saved choice and
  system reduced-transparency, high-contrast and forced-colors overrides.
- In Full mode, confirm video playback does not cause recurring long frames;
  compare with Low mode on the same device and video. Use the optional
  **检测玻璃流畅度** feature as *indicative UI cadence only*, not video FPS,
  GPU usage, power draw or thermals.
- Test poor network, HLS failure, blocked media, rapid page switches and
  app background/foreground lifecycle. Confirm stale playback blur clears.
- Verify the old app's local data does not silently disappear during a
  package-name or signing-key change. Preserve pre-upgrade backups.

### Evidence record (fill on real devices)

| Field | Value |
|---|---|
| Device + OS build | Pending |
| Browser engine / WebView version | Pending |
| APK / IPA / package SHA-256 | Pending |
| App commit SHA | Pending |
| Screen scale and orientation | Pending |
| Auto / Full / Low appearance screenshots | Pending |
| Playback and overlay result | Pending |
| UI cadence sample median / p95 (indicative) | Pending |
| Crash/error log summary | Pending |
| Accepted by / date | Pending |

## Release decision

Production release requires: current mainline reconciled, green CI on exact
release commit, native installer and playback checks on all claimed supported
platforms, stable release signing, version/upgrade migration strategy,
license/brand review and a documented rollback path.

Do not mark a platform complete without device evidence. Keep PR #1 in draft
until these gates are satisfied.
