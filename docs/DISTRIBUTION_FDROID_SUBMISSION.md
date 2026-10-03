# F-Droid + IzzyOnDroid Submission Pack (ApexFOSS 1.1.0)

**Status: PREPARED — nothing submitted. No MR filed, no issue opened, no acceptance claimed.**
**Last updated: 2026-09-30.**

## 1. F-Droid — draft `fdroiddata` metadata

File to create as `metadata/com.apexfoss.app.yml` in a fork of
`fdroiddata` (GitLab). Drafted from the verified repo state; run
`fdroid lint` + `fdroid rewritemeta` + a trial build before submitting.

```yaml
Categories:
  - Sports & Health
License: GPL-3.0-or-later
AuthorName: v0idbrn
WebSite: https://github.com/v0idbrn/ApexFOSS
SourceCode: https://github.com/v0idbrn/ApexFOSS.git
IssueTracker: https://github.com/v0idbrn/ApexFOSS/issues
Changelog: https://github.com/v0idbrn/ApexFOSS/blob/main/CHANGELOG.md
Donate:
  - https://github.com/sponsors/v0idbrn
  - https://paypal.me/amelie615
  - https://link.mercadopago.com.ar/openv0id

AutoUpdateMode: Version v%v
UpdateCheckMode: Tags
CurrentVersion: 1.1.0
CurrentVersionCode: 3

Builds:
  - versionName: 1.1.0
    versionCode: 3
    commit: v1.1.0
    subdir: android
    sudo:
      - apt-get update
      - apt-get install -y nodejs npm openjdk-17-jdk
    init:
      - sdkmanager "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006"
      - npm install
    prebuild:
      - APEX_SKIP_SIGNING=1 npx expo prebuild -p android --clean
    gradle:
      - yes
    output: app/build/outputs/apk/release/app-release.apk
```

Notes and open verifications (do not silently "fix" — confirm during MR CI):

- `output` points at the universal release APK (both ARM ABIs, ~41 MB). The Play AAB also builds from this repo if reviewers prefer bundles.
- `subdir: android` requires the CNG prebuild step above — `android/` is generated, never committed. `APEX_SKIP_SIGNING=1` is the validated sign-less path (D-055); maintainer signing is untouched.
- **F-DROID BLOCKER — requires separate implementation:** F-Droid policy explicitly forbids Firebase/GMS and demands a flavour without them. `firebase-messaging:25.0.1` arrives via `expo-notifications` (dead code here: never initialized, no INTERNET, no token APIs in `src/`; FCM imports are confined to push-only classes, local scheduling untouched). Build-graph finding: Expo modules resolve as prebuilt Maven AARs (`host.exp.exponent:expo.modules.notifications`), and no `firebase`/`play-services`/`gms` artifact appears in the app's `releaseRuntimeClasspath` — but the FCM service classes + `c2dm` manifest entries still ship inside the APK, which is what reviewers will flag. The fix is an F-Droid flavour of the notifications module without `firebase-messaging` **plus device validation that rest-timer alerts still fire**. Do not file the MR before that flavour exists — reviewers will demand it.
- Node/npm and NDK provisioning on the buildserver must be confirmed by the trial build (`fdroid build`); adjust `sudo`/`init` to what the runners actually provide.
- `SCREENSHOTS: PENDING DEVICE SESSION` — no captures, no mockups, no generated images. When a device is available, capture portrait EN (minimum): Home, Routines, Train, active workout with rest timer, Progress, History or 28-day report, More/About with Support section, Portability/backup screen. Landscape/tablet only if tablet layout is ever claimed (it is not).

## 2. F-Droid — submission steps (manual, owner)

1. Create a GitLab account (if none exists).
2. Fork `fdroiddata`, clone, branch from `master` (e.g. `com.apexfoss.app`).
3. Add the metadata file above as `metadata/com.apexfoss.app.yml`.
4. Install `fdroidserver` locally (`pip install fdroidserver`); run `fdroid lint` and `fdroid rewritemeta`, fix findings.
5. Trial-build if feasible; push the branch; open a merge request titled `New App: com.apexfoss.app`.
6. Track reviewer questions; typical timeline ranges from days to weeks.
7. After merge, the build server picks it up automatically (24–48 h to appear, signing step is manual on their side).

Alternative (slower): file a Request-For-Packaging ticket instead of an MR. The MR path above is preferred.

## 3. IzzyOnDroid — status and next step

Eligibility (checked against the published inclusion policy):

| Requirement | ApexFOSS state |
|---|---|
| FOSS (OSI/FSF-approved) license | PASS — GPL-3.0-or-later, `LICENSE` at root |
| Code freely accessible (GitHub) | PASS |
| Unique package/display name | PASS (`com.apexfoss.app` / ApexFOSS) |
| Release-signed APK, not debuggable/testOnly | PASS (maintainer `CN=ApexFOSS` key; verified non-debuggable) |
| APK from project (GitHub tagged releases preferred) | READY once the v1.1.0 GitHub Release exists |
| Fastlane metadata (short/full/icon/screenshots) | PARTIAL — texts + `icon.png` present; **screenshots missing** (no device) |
| No self-updater, no ads/trackers | PASS (no updater; zero trackers; offline) |
| Health-data app with no ATS elements | PASS (fitness data, no analytics/tracking SDKs) |
| No `usesCleartextTraffic` abuse | PASS (not set) |
| **APK ≤ 30 MB guideline** | **CAVEAT — universal APK is 41.4 MB** (measured 1.1.0: arm64 libs 16.1 MB + armeabi libs 11.1 MB + dex 8.1 MB + assets 1.9 MB; an arm64-only split would still be ~30 MB, i.e. borderline). Mitigations: request an exception with justification (offline-first, old-device support via armeabi-v7a), or drop armeabi-v7a in a store-specific artifact only if reviewers require it (would abandon Android 7 32-bit devices — a product decision, not taken here) |

Next step (manual, owner): open a suggestion issue in the IzzyOnDroid Maintenance Repo (Codeberg) using their app-suggestion template, linking the repo + the v1.1.0 GitHub Release + this assessment. Do not claim acceptance before a maintainer confirms.

## 4. Obtainium — user installation path (no integration needed)

Obtainium tracks the GitHub Releases page directly; nothing is added to ApexFOSS for it.

1. Install Obtainium (from its GitHub releases or F-Droid/IzzyOnDroid).
2. In Obtainium: **Add app** → paste `https://github.com/v0idbrn/ApexFOSS` (source auto-detected as GitHub).
3. Obtainium lists the v1.1.0 release assets; install `app-release.apk` (universal, both ARM ABIs).
4. Updates: Obtainium notifies/installs on new GitHub releases (enable "include prereleases" if the release is flagged as such).

Warnings to surface to users:

- Signature continuity: the GitHub APK is developer-signed (`CN=ApexFOSS`). Do NOT mix with a future F-Droid build (different signer) — switching sources requires uninstall + reinstall (data loss without a prior `.apexbackup` export).
- Obtainium performs no tracker scan and no review; users trust the developer directly (the repo is public and the release notes carry the SHA-256).
- Version comparison works with `v1.1.0`-style tags; keep that tag convention for every release.

## 5. F-Droid blocker — RESOLVED on device (2026-10-03)

The §1 blocker ("flavour without Firebase **plus device validation that rest-timer alerts still fire**") is closed. History above is preserved; this section records the resolution.

**Solution.** `-PapexFdroid=true` invocation-scoped flavour (no product flavors: autolinking evaluates once per Gradle invocation): `plugins/withFdroidNotificationFlavor.js` excludes `expo-notifications` from autolinking, so no Firebase/FCM enters the APK; new local module `modules/apex-notifications` (`ApexNotifications`) schedules via `AlarmManager.setAlarmClock` + manifest `AlarmReceiver`, runtime-selected by a sentinel probe (`src/notifications/backend.ts`). Normal build unchanged.

**Root cause found on device (D-058).** Bridge, adapter, registration and receiver were all proven working; `setAlarmClock()` threw `SecurityException: needs SCHEDULE_EXACT_ALARM` because the permission was never declared and is denied by default on API 34 for newly installed target-34+ apps. Fix: `SCHEDULE_EXACT_ALARM` in the module manifest + `canScheduleExactAlarms()` gate (in-app countdown authoritative) + one-time redirect to system Alarms & reminders on reminder enable.

**APK forensics (clean release build, `android/app/build/outputs/apk/release/app-release.apk`).** `apkanalyzer dex packages --defined-only`: `com.google.firebase` 0, `com.google.android.gms` 0, `com.google.android.c2dm` 0, `FirebaseMessaging` 0, `expo.modules.notifications` 0, `google.protobuf` 0; `expo.modules.apexnotifications` present. Manifest: only `expo.modules.apexnotifications.AlarmReceiver`, no `MESSAGING_EVENT`. Badging: `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `VIBRATE` present; `INTERNET`, `c2dm`, `RECEIVE_BOOT_COMPLETED` absent. `zipalign -c -P 16 4`: exit 0 (16 KB PASS).

**Device validation (Galaxy A04 SM-A045M, Android 14/API 34, arm64-v8a).** After granting Alarms & reminders: one-shot scheduled from JS fired in 8 s (`AlarmReceiver.onReceive`, active `NotificationRecord` on `apex-notifications-default`); real workout rest (90 s, backgrounded) posted its expiry notification and the cursor recovered on foreground; daily reminder alarm armed for the configured 21:30 with channel created; cancel path verified. Jest + typecheck green at commit time (see commit message).

**Limitations (carry into the MR notes).** (1) Local alerts need the one-time exact-alarm grant; without it the in-app countdown still runs but no system notification fires. (2) No `RECEIVE_BOOT_COMPLETED` by design — reboot clears alarms until the next app open (reminders resync then). (3) `com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE` + `installreferrer:2.2` come from `expo-application` (not Firebase/GMS); zero `expo-application` API usage in `src/`.
