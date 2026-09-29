# Google Play Store — Distribution Readiness

**Status: preparation only — NO submission, NO registration, NO upload has been made. Nothing here is a claim of compliance or approval.**
**Last verified: 2026-09-29 (distribution-readiness pass).**
**Policy basis:** official Play target-API and 16KB pages documentation, checked September 2026 (see §6). Time-sensitive rules must be re-checked at submission time.

Related: `docs/DISTRIBUTION.md` (channel overview), `docs/DISTRIBUTION_MATRIX.md` (cross-channel status table), `docs/DATA_MAP.md` (factual data inventory), `docs/STORE_ASSETS.md` (listing assets), `fastlane/metadata/android/` (draft listing copy).

## 1. Technical

Values verified from `app.json`, the generated `android/` project, the Gradle build log, and the locally built release APK (`android/app/build/outputs/apk/release/app-release.apk`, SHA-256 `E3DDA7729288FA442FA53DA133F3268B60F8215FD4162C36A8657B6377ABF706`).

| Item | Value | Evidence |
|---|---|---|
| Package / applicationId | `com.apexfoss.app` | `app.json`, `android/app/build.gradle`, aapt badging |
| versionName | `1.0.0` | `app.json`, `build.gradle`, aapt badging |
| versionCode | `2` | `app.json`, `build.gradle`, aapt badging |
| minSdk | 24 (Android 7.0) | Expo root-project log, aapt badging |
| targetSdk | 36 (Android 16) | Expo root-project log, aapt badging |
| compileSdk / buildTools | 36 / 36.0.0 | Gradle configure log |
| NDK / Kotlin / Gradle / JDK | 27.1.12297006 / 2.1.20 / 9.0.0 / 17 (Adoptium 17.0.20.1) | Gradle configure log, `gradlew --version` |
| Node / npm | v24.15.0 / 12.0.2 | local toolchain |
| Expo / RN | SDK 55 (~55.0.31) / 0.83.10 | `package.json` |
| ABIs | `arm64-v8a` + `armeabi-v7a` | `app.json` buildArchs, aapt `native-code` (64-bit requirement satisfied) |
| Debuggable | No (release) | aapt badging shows no `debuggable` flag |
| INTERNET permission | Absent in release | manifest-merger `tools:node="remove"` (`plugins/withNetworkHardening`), aapt `uses-permission` list, `apksigner` build |
| Release signing | External keystore, injected at prebuild (`plugins/withApexSigning.js`); secrets outside repo | `docs/DEVELOPMENT.md`; release APK `apksigner verify` → `CN=ApexFOSS` |
| Release APK command | `npm run build:apk` (`gradlew assembleRelease` in `android/`) | `package.json`, verified build |
| Release AAB command | `gradlew bundleRelease` in `android/` → `app/build/outputs/bundle/release/app-release.aab` | validated this pass (see §3) |

### Requirement findings (checked September 2026)

1. **Target API — PASS.** Since 31 August 2026, new apps and updates must target API 36+. ApexFOSS targets 36 today, so it is submittable on this axis. Re-check at submission: the floor rises over time.
2. **AAB for new apps — READY.** Play requires the Android App Bundle for new apps; `bundleRelease` builds it from this repo (validated §3). Upload the AAB, not the APK.
3. **64-bit — PASS.** `arm64-v8a` is included.
4. **16 KB page size — BLOCKED (one library).** Since 1 November 2025, apps targeting API 35+ must have 16 KB-aligned native code on 64-bit. Verification performed this pass with the NDK's `llvm-readelf` on every `lib/arm64-v8a/*.so` from the release APK: **18 of 19 libraries report `LOAD` alignment `0x4000` (compliant); `libwatermelondb-jsi.so` reports `0x1000` (4 KB, non-compliant).** That library is compiled from source during the Gradle build (`@nozbe/watermelondb@0.28.0`, `native/android-jsi`), not a prebuilt blob, so the fix is a toolchain/linker-flag change (`-Wl,-z,max-page-size=16384` or NDK r28+ defaults) or a WatermelonDB upgrade once upstream ships an aligned build — then re-verify with `llvm-readelf` and on a 16 KB device/emulator image. Play Console's App Bundle Explorer also reports 16 KB compatibility at upload time. `armeabi-v7a` (32-bit) is unaffected by this rule.
5. **minSdk 24** — fine (Play install floor is far lower); raising `targetSdk` does not raise `minSdk`.

## 2. Store listing (all MANUAL Play Console actions)

No listing content lives in Play yet. Draft copy lives in `fastlane/metadata/android/` (en-US + es-AR); graphics status in `docs/STORE_ASSETS.md`.

| Field | Proposed value / status | In repo? | Manual action remains |
|---|---|---|---|
| App name | ApexFOSS | fastlane draft | Enter in Console |
| Short description (≤80) | Draft in fastlane | fastlane draft | Enter in Console |
| Full description (≤4000) | Draft in fastlane | fastlane draft | Enter in Console |
| App category | Health & Fitness (proposed, not submitted) | — | Select in Console |
| Tags | e.g. workout, strength-training (proposed) | — | Select in Console |
| Contact email | **Not provisioned** (same gap as `SECURITY.md`) | No | Provision + enter |
| Privacy policy URL | **No hosted URL yet** (`docs/PRIVACY.md` exists in repo; Play requires a public URL) | Partial | Host + enter |
| High-res icon 512×512 | Downscalable from `assets/icon.png` (1024×1024) | Source yes | Upload |
| Feature graphic 1024×500 | **Missing** | No | Create + upload |
| Phone screenshots (≥2) | **Missing — must be real captures** | No | Capture + upload |
| Content rating (IARC) | Questionnaire, manual | — | Complete honestly |
| Target audience | Adults (fitness training); no children-directed features — confirm at submission | — | Declare |
| Ads declaration | No ads | Code-evident | Declare "No" |
| App access | No login, no restricted sections; full access without credentials | Code-evident | Declare |
| Financial features | External donation links only (browser; no in-app billing, no Play Billing) — see §4 | Code-evident | Declare per current form wording |
| Health declaration | General fitness logging/timing; no diagnosis/treatment/monitoring; not medical software (`docs/HEALTH_AND_FITNESS.md`) | Docs | Declare |
| Release track | Internal/closed testing first (recommended), then production | — | Create releases |

## 3. AAB validation (this pass)

`gradlew bundleRelease` completed `BUILD SUCCESSFUL` from this repo using the maintainer's external signing config (not committed). The AAB is a local validation artifact at `android/app/build/outputs/bundle/release/app-release.aab` and is **not committed**.

Checks performed on the built AAB (`android/app/build/outputs/bundle/release/app-release.aab`, 32,011,779 B, 1258 entries, `BUILD SUCCESSFUL`):
- [x] package `com.apexfoss.app` / versionName `1.0.0` (base manifest string pool; `versionCode` 2 pinned in `build.gradle`, same pipeline as the verified APK)
- [x] base manifest: no INTERNET permission string, no debuggable flag
- [x] Signature valid: `jarsigner -verify` → `jar verified` (self-signed-cert PKIX warning is expected; same `CN=ApexFOSS` config as the APK)
- [x] ABI splits present for `arm64-v8a` + `armeabi-v7a`; dex files + `base/assets/index.android.bundle` present
- [ ] **16 KB re-check:** the AAB contains the same native libraries as the APK — `libwatermelondb-jsi.so` alignment still `0x1000` until the §1(4) fix lands. Re-run the `llvm-readelf` check on every AAB rebuild.

Play App Signing enrollment (upload key = current `CN=ApexFOSS` keystore vs. Google-managed key) is undecided — decide before first upload; losing the upload key means losing update identity.

## 4. Privacy / Data Safety (from code, not claims)

Source of truth: `docs/DATA_MAP.md` (row-level inventory) + `docs/PRIVACY.md`. Play's Data Safety form asks about data **collected** (transmitted off-device) and **shared**. Findings from the actual implementation:

| Play data type | Status in ApexFOSS | Basis |
|---|---|---|
| Account / personal info | Not collected, not shared | No accounts; no network |
| Health & fitness (workouts, body metrics) | Local only; **not collected** | SQLite on device; leaves only via user-initiated export |
| Device identifiers, location, contacts, photos/media | Not accessed, not collected | No such APIs used |
| App activity / performance, diagnostics, crash reporting | None exist | No analytics/crash SDK in tree; `grep` clean |
| Files and docs | User-selected import files read locally only | `expo-document-picker` → local validate → preview → confirm |
| User-initiated sharing (CSV/JSON exports, routine packages, backups) | Leaves device **only when the user completes a share** to a target of their choosing | `DATA_MAP.md` `USER-INITIATED SHARING`; this is user-directed disclosure, not app collection |
| QR display / deep-link intake | QR visible to cameras (user-triggered); deep links validated, never auto-imported | `DATA_MAP.md`; checksum integrity, not encrypted |
| OS Auto Backup | May copy app data to the user's backup provider if enabled on device (D-034/F-04) | `allowBackup=true`, no extraction rules — confirm Play's current guidance for this answer at submission |
| Notifications | Local-only scheduling (`expo-notifications`); **no push tokens, no FCM registration** (no `google-services.json`, no network) | Code + manifest + `DATA_MAP.md` |
| External support links (Sponsors/PayPal/Mercado Pago) | **Not ApexFOSS data collection.** The app transmits nothing; it opens the OS browser on explicit tap (release build has no INTERNET). Any data the payment site collects is governed by that site's policy, not this app's | `src/constants/support.ts`, `MoreScreen.tsx`, More screen test |

Permissions → justification (for the permissions declaration):
- `POST_NOTIFICATIONS` — rest-timer completion alerts (local only).
- `VIBRATE` — haptic cues.
- `RECEIVE_BOOT_COMPLETED` — re-schedule local rest-timer notifications after reboot.
- `READ/WRITE_EXTERNAL_STORAGE` (maxSdkVersion 32) — legacy share/import file flows.
- `SYSTEM_ALERT_WINDOW` — inherited from the React Native toolchain, never requested at runtime (D-035); Play scrutinizes this permission — preferred path is device-verified removal before submission.
- Badge/launcher permissions (`READ_APP_BADGE`, OEM badge permissions), `BIND_GET_INSTALL_REFERRER_SERVICE`, `c2dm RECEIVE` — merged in by Expo/RN libraries (`expo-notifications` FCM classes, install-referrer API); no runtime use. Document if reviewers ask (audit F-14).

## 5. Content declarations (prepare, do not submit)

- Target audience: adults; no children-directed features or ads. Confirm exact questionnaire wording at submission.
- Content rating: complete the IARC questionnaire honestly (fitness content, no objectionable material expected).
- Ads: none — declare accordingly.
- Financial features: no in-app purchases, no Play Billing; voluntary donation links open the external browser. Answer per the form's current wording; do not present the links as in-app payments.
- Health: general fitness only; `docs/HEALTH_AND_FITNESS.md` is the prepared answer for any medical-device-policy probe (D-040/D-042).
- Regulated/government functionality: none.
- App access: no credentials needed; all functionality available without login.

## 6. Policy sources checked (September 2026)

- Play target-API requirements: from 31 August 2026, phone/tablet/foldable new apps and updates must target API 36+ (support.google.com/googleplay/android-developer/answer/11926878; developer.android.com/google/play/requirements/target-sdk).
- 16 KB page-size compatibility: required since 1 November 2025 for new apps and updates targeting API 35+; AGP 8.5.1+/NDK r28+ path; Play Console App Bundle Explorer reports compatibility (developer.android.com/guide/practices/page-sizes).

## 7. Remaining manual actions (owner, at submission time)

1. Fix or upgrade `libwatermelondb-jsi.so` to 16 KB ELF alignment (§1.4) and re-verify.
2. Decide Play App Signing enrollment; safeguard the upload key.
3. Provision contact email + hosted privacy-policy URL.
4. Complete store listing, content rating, target-audience, Data Safety, permissions and financial/health declarations in Play Console.
5. Decide `SYSTEM_ALERT_WINDOW` (remove with device verification, or justify).
6. Upload AAB to internal/closed testing first; confirm 16 KB report in App Bundle Explorer.
7. Re-check time-sensitive policy (target-API floor, 16 KB rule) on submission day.
