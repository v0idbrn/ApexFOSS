# F-Droid — Distribution Readiness

**Status: preparation only — NO submission, NO merge request to `fdroiddata`, NO tag has been made. Nothing here is a claim of acceptance.**
**Last verified: 2026-09-29 (distribution-readiness pass).**
**F-Droid builds from source** — everything below is about whether this repository can be built by F-Droid's infrastructure, not about the APK the maintainer builds locally.

Related: `docs/DISTRIBUTION.md` (channel overview), `docs/DISTRIBUTION_MATRIX.md` (cross-channel status), `docs/FDROID_METADATA_REFERENCE.yml` (draft submission reference), `docs/THIRD_PARTY_LICENSES.md` (npm license inventory).

## 1. Identity

| Item | Value |
|---|---|
| App name | ApexFOSS |
| Package ID | `com.apexfoss.app` |
| Current version | 1.0.0 (`versionCode` 2) |
| License | GPL-3.0-or-later (`LICENSE` at repo root, SPDX in `package.json`) |
| Source repository | https://github.com/v0idbrn/ApexFOSS.git (public) |
| Tag strategy (intended) | `v1.0.0` per release — **not created yet** (created only after RC validation) |

## 2. Build

| Item | Requirement / finding |
|---|---|
| Build system | Gradle (AGP via Expo version catalog) + Node/npm for JS bundle. `android/` is **generated, not committed** (`git ls-files android` → 0 files): F-Droid must run `npm install` + `expo prebuild` (CNG) before Gradle. |
| Gradle | 9.0.0 (wrapper pinned in `android/gradle/wrapper/gradle-wrapper.properties`) |
| JDK | 17 (verified: Eclipse Adoptium 17.0.20.1) |
| Android SDK | compileSdk 36, targetSdk 36, minSdk 24, buildTools 36.0.0 (verified in Gradle configure log) |
| NDK | 27.1.12297006 (verified in Gradle configure log; compiles WatermelonDB JSI from C++ source) |
| Node / npm | v24.15.0 / 12.0.2 locally; F-Droid recipe must pin working versions |
| CMake | Present in local SDK (`cmake/`); used by native modules |
| Repositories used | `google()`, `mavenCentral()`, `https://www.jitpack.io` (`android/build.gradle`) |
| Generated native files | `android/` regenerates via `npm run prebuild`; fails fast without the external signing config — **F-Droid must build unsigned/debug or with its own signing** (see §5, signing) |
| Largest engineering item | Reproducing the Expo CNG + Metro/Hermes pipeline inside F-Droid's build environment (pre-existing finding, `docs/DISTRIBUTION.md` §F-Droid). Needs a trial recipe; **not verified in this pass** (no fdroidserver run performed). |

## 3. Dependencies (auditable)

npm runtime licenses verified from installed `package.json` files on 2026-09-29. Gradle artifacts: coordinates verified in module `build.gradle` files; licenses as declared upstream (re-verify at submission).

### npm (direct runtime)

| Dependency | Purpose | License | F-Droid concern |
|---|---|---|---|
| `@morrowdigital/watermelondb-expo-plugin` ^2.3.3 | Expo config plugin for WatermelonDB | MIT (verified) | None (build-time only) |
| `@nozbe/watermelondb` 0.28.0 | Local SQLite database + JSI adapter | MIT (verified) | Native part compiles from C++ source in-tree (`native/android-jsi/src`) — source-built, good |
| `@nozbe/simdjson` (transitive) | JSON parsing for WatermelonDB sync engine | Apache-2.0 (verified) | None |
| `expo` ~55.0.31 | Expo framework modules | MIT (verified) | None |
| `expo-build-properties` ~55.0.18 | Native build configuration (ABIs, etc.) | MIT (verified) | None (build-time) |
| `expo-dev-client` ~55.0.40 | Dev client / launcher | MIT (verified) | Low: dev-launcher code ships but is inert in signed release builds (no dev activity in manifest); F-Droid may ask — answerable |
| `expo-document-picker` ~55.0.17 | User-selected file import | MIT (verified) | None |
| `expo-file-system` ~55.0.26 | Local file access for export/share | MIT (verified) | None |
| `expo-keep-awake` ~55.0.8 | Screen-on during trainers | MIT (verified) | None |
| `expo-notifications` ~55.0.27 | **Local** rest-timer notifications | MIT (verified) | See §4 (firebase-messaging) |
| `expo-system-ui` ~55.0.22 | System UI appearance | MIT (verified) | None |
| `nativewind` ^4.2.1 | Styling (build-time mostly) | MIT (verified) | None |
| `react` 19.2.0 / `react-native` 0.83.10 | UI framework | MIT (verified) | Hermes compiler is a prebuilt host binary via npm (`hermes-compiler` package) — build-tool blob, not shipped in APK; standard RN-on-F-Droid consideration, needs recipe-level handling |
| `react-native-safe-area-context` / `react-native-screens` | Navigation/layout primitives | MIT (verified) | None |
| `zustand` ^5.0.8 | Ephemeral UI state | MIT (verified) | None |

Full transitive inventory method: `docs/THIRD_PARTY_LICENSES.md` (pinned by `package-lock.json`).

### Gradle (notable, from module build files)

| Artifact | Purpose | License (upstream-declared, re-verify at submission) | F-Droid concern |
|---|---|---|---|
| `com.google.firebase:firebase-messaging:25.0.1` (via expo-notifications) | Push-messaging client | Apache-2.0 | **Needs reviewer judgment:** SDK is open-source but GMS-tied; the app never initializes it (no `google-services.json`, no INTERNET, no token code — `grep` clean, `DATA_MAP.md`). Dead code in this app, but F-Droid may require a flavor/patch removing it |
| `com.android.installreferrer:installreferrer:2.2` (via expo-application, transitive) | Install referrer API | Apache-2.0 | Low (open-source client, unused) |
| Fresco (`com.facebook.fresco:*`, RN image pipeline) | Image loading | Apache-2.0 (upstream) | None known |
| `com.facebook.react:hermes-android` | Hermes JS engine | MIT (upstream) | None (compiled/shipped per RN release process) |
| `io.github.react-native-community:jsc-android` (fallback) | JSC fallback | MIT (upstream) | None (unused when Hermes enabled) |
| `libc++_shared.so` (NDK) | C++ runtime | Apache-2.0 with LLVM exception (upstream) | None |
| Kotlin stdlib / AGP toolchain | Build | Apache-2.0 (upstream) | None |

## 4. Non-free / proprietary concerns

| Concern | Finding | Impact / action |
|---|---|---|
| Firebase / GMS runtime | `firebase-messaging` classes merged (manifest shows `c2dm RECEIVE`); **never initialized, never usable** (no INTERNET, no config, no code path). Open-source SDK, but GMS-tied functionality | Uncertain — present honestly to F-Droid reviewers; possible ask: strip via patch/flavor. Do NOT remove speculatively without reviewer evidence |
| `SYSTEM_ALERT_WINDOW` | Inherited from RN toolchain manifest, never requested at runtime (D-035) | Same class of question for Play; device-verified removal preferred before any submission |
| Prebuilt host binaries | `hermesc` (Hermes compiler) via npm; Gradle wrapper distribution; Android SDK/NDK build-tools | Build-environment inputs, not app content; standard for RN apps — recipe must account for them |
| Prebuilt blobs shipped in APK | **None found:** all 19 `arm64-v8a` `.so` files are compiled during the Gradle build (RN/Hermes from Maven sources, WatermelonDB JSI from in-tree C++ source) | Good for F-Droid |
| Trackers / ads / crash reporting / auth / cloud | **None** — verified by dependency inventory + source `grep` + offline architecture | None |
| Expo Updates / OTA | Disabled (`ENABLED=false` in manifest) — no remote-code path | Good (F-Droid forbids self-updating) |

## 5. Signing (F-Droid builds sign themselves)

- The maintainer's release keystore lives **outside the repo** (`~/.apexfoss/`, injected by `plugins/withApexSigning.js`); F-Droid never needs it and must never receive it.
- `npm run prebuild` fails fast without the external signing config — the F-Droid recipe must either provide its own config or the plugin must tolerate a sign-less (F-Droid-signed) build. **Recipe-level detail to resolve during the trial build; do not weaken the maintainer flow to accommodate it.**
- No committed keystores, passwords, `.env`, or local paths (verified every pass; automated guard proposed in `docs/DISTRIBUTION_MATRIX.md`).

## 6. AntiFeatures (assessment, F-Droid decides)

| AntiFeature | Applicable? | Reasoning |
|---|---|---|
| `NonFreeNet` | No | No network use; no non-free service required for any feature (support links are user-opened browser pages, not app services) |
| `Tracking` | No | No analytics/crash/ad SDKs; no identifiers leave the device |
| `Ads` | No | No ads |
| `NonFreeAddons/Deps` | No | All shipped native code compiled from FOSS sources during build |
| `UpstreamNonFree` | No | No proprietary blobs in `src/` or shipped artifacts |
| `NoSourceSince` | No | Full source public; `android/` regenerable via CNG |

## 7. Remaining manual actions / blockers

1. **Trial F-Droid recipe** (largest item): prove `npm install` → `expo prebuild` → Gradle build inside F-Droid's environment; resolve signing-config tolerance, Node availability, and hermesc handling.
2. **firebase-messaging reviewer judgment:** keep the evidence pack ready (no INTERNET, no init, `DATA_MAP.md`); strip only if reviewers require it.
3. **Create tag `v1.0.0`** only after RC validation (F-Droid builds from tags).
4. **Submit `fdroiddata` merge request** — explicitly out of scope for this pass.
5. Re-verify time-sensitive items (licenses of Gradle artifacts, fdroiddata build practices) on submission day.
