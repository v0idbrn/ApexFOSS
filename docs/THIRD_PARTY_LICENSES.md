# Third-Party Licenses

**Last updated: 2026-09-25 (Phase 2G).**
**Scope:** components bundled into ApexFOSS builds (runtime) plus the primary build/test toolchain. SPDX identifiers are taken from each component's own `package.json` (`license` field) or Android metadata as installed in this repository.

> **This file documents third-party licenses only. It does NOT declare or change the license of ApexFOSS itself** — the project currently has **no `LICENSE` file** (open owner decision, D-038; see `docs/KNOWN_LIMITATIONS.md`). No license was added as part of this audit.

## How this list was produced

Licenses below were read from the installed `node_modules/*/package.json` on 2026-09-25 (versions pinned by `package-lock.json`). For a complete, machine-generated inventory at release time, run (requires network):

```
npx license-checker --production --summary
npx license-checker --production --failOn "GPL-3.0;AGPL-*"   # example policy gate
```

Any component whose license could not be read programmatically is marked **⚠ manual review**.

## Direct runtime dependencies (package.json → dependencies)

| Component | Version | License (SPDX) | Notes |
|---|---|---|---|
| expo | ~55.0.31 | MIT | SDK core |
| expo-build-properties | ~55.0.18 | MIT | Config plugin (ABI/signing build flags) |
| expo-dev-client | ~55.0.40 | MIT | Debug builds only (not used at runtime in release) |
| expo-keep-awake | ~55.0.8 | MIT | Screen keep-awake during workouts |
| expo-notifications | ~55.0.27 | MIT | Local notifications; pulls firebase-messaging (below) |
| expo-system-ui | ~55.0.22 | MIT | System UI colors |
| @nozbe/watermelondb | ^0.28.0 | MIT | Local database (JSI) |
| @morrowdigital/watermelondb-expo-plugin | ^2.3.3 | MIT | Build-time config plugin |
| react | 19.2.0 | MIT | UI runtime |
| react-native | 0.83.10 | MIT | UI runtime |
| react-native-safe-area-context | ~5.6.2 | MIT | Layout |
| react-native-screens | ~4.23.0 | MIT | Native screen containers |
| nativewind | ^4.2.1 | MIT | Tailwind runtime styling |
| zustand | ^5.0.8 | MIT | State containers (mirrors only) |

## Direct development dependencies (selected)

| Component | Version | License (SPDX) | Notes |
|---|---|---|---|
| typescript | ~5.9.3 | Apache-2.0 | |
| tailwindcss | ^3.4.19 | MIT | Class generation (build-time) |
| jest | ^29.7.0 | MIT | Test runner |
| jest-expo | ~55.0.0 | MIT | Test preset |
| react-test-renderer | ^19.1.0 | MIT | |
| @expo/metro-config | ^57.0.12 | MIT | Bundler config |
| @babel/plugin-* (decorators, class-properties, private-*, typescript) | 7.x | MIT | Transforms |

## Notable transitive components (runtime-relevant)

| Component | Version | License (SPDX) | Pulled in by |
|---|---|---|---|
| @babel/runtime | 7.26.0 | MIT | @nozbe/watermelondb (advisory noted: F-19/D-039) |
| rxjs | 7.8.2 | Apache-2.0 | WatermelonDB |
| lokijs (Watermelon fork) | 1.5.12-wmelon6 | MIT | WatermelonDB test/in-memory adapter |
| uuid | 7.0.3 | MIT | Expo toolchain |
| firebase-messaging | 25.0.1 | Apache-2.0 | expo-notifications (**dormant**: no google-services.json, no INTERNET — see SECURITY_AUDIT F-14) |
| ShortcutBadger (`me.leolin`) | 1.1.22 | Apache-2.0 | expo-notifications (launcher badge display) |
| kotlinx-coroutines-android | 1.10.2 | Apache-2.0 | expo-notifications |

## Android / native layer (representative, from Gradle dependency graph)

| Component | License (SPDX) | Notes |
|---|---|---|
| React Android (react-android / ReactAndroid) | MIT | RN native runtime |
| Hermes engine | MIT | JS engine (bundled `.so`) |
| AndroidX (core, lifecycle, startup, emoji2, profileinstaller, …) | Apache-2.0 | |
| Google Play services / GMS basics, datatransport, firebase-common/installations | Apache-2.0 | Reachable components documented in SECURITY_AUDIT F-14 (dormant) |
| Kotlin stdlib / coroutines | Apache-2.0 | |
| Gradle wrapper 9.0 / Android Gradle Plugin | Apache-2.0 | Build-time only |

⚠ **Manual review:** exact license text for every AAR/JAR in the Gradle cache was not individually re-verified in this phase; the table reflects known upstream licenses of the pinned coordinates. F-Droid-class submission will require the full `scancode`/metadata pass (see `docs/DISTRIBUTION.md`).

## Fonts / assets

No custom font files are bundled beyond Material/Platform defaults (expo assets). If images/fonts are added later, record them here with their license.

## Native build outputs

Release APK contains: `lib/arm64-v8a/*.so`, `lib/armeabi-v7a/*.so` (Hermes, ReactAndroid, Watermelon JSI, app code) and `assets/index.android.bundle` (Metro bundle of first-party + MIT/Apache-2.0 JS listed above). No proprietary binaries identified.
