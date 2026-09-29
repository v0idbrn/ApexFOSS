# Distribution Matrix — Play Store vs F-Droid

**Status: preparation tracker — NOT published on any channel. Last updated: 2026-09-29.**
**Statuses:** `PASS` (verified) · `READY` (prepared, no blocker) · `MANUAL ACTION` (owner/Console step) · `BLOCKED` (must fix first) · `NEEDS VERIFICATION` (unproven).

| Requirement | Play Store | F-Droid | Status | Evidence / Action |
|---|---|---|---|---|
| Package ID `com.apexfoss.app` | PASS | PASS | PASS | `app.json`, `build.gradle`, aapt/AAB checks |
| License GPL-3.0-or-later | n/a (Play accepts any) | PASS | PASS | `LICENSE`, SPDX field, `docs/THIRD_PARTY_LICENSES.md` |
| Version 1.0.0 / code 2 | READY | READY | READY | Pinned; tag `v1.0.0` intentionally not created yet |
| Target SDK 36 | PASS (floor since 31 Aug 2026) | n/a | PASS | Verified Sept 2026 policy + local build |
| Release APK build | READY (upload AAB instead) | READY | READY | `assembleRelease` verified, SHA recorded |
| Release AAB build | PASS (validated this pass) | n/a | PASS | `bundleRelease` OK; `jarsigner` verified; manifest/ABIs checked |
| 64-bit ABIs | PASS | n/a | PASS | `arm64-v8a` included |
| 16 KB page alignment | **PASS** (all 19 arm64 libs `0x4000`, `zipalign -P 16` clean) | n/a | PASS | D-054; `llvm-readelf` evidence; re-check submission build |
| Signing (maintainer) | READY (external keystore, verified) | n/a (F-Droid signs itself) | READY | `apksigner`/`jarsigner`; Play App Signing enrollment undecided |
| F-Droid sign-less build tolerance | READY (proven: skip-prebuild + debug/release builds, no INTERNET in release) | READY | D-055; F-Droid infra run still manual |
| Privacy policy | MANUAL ACTION (hosted URL) | READY (`docs/PRIVACY.md` in repo) | MANUAL ACTION | Host URL + enter in Console |
| Data Safety form | MANUAL ACTION (answers prepared §4) | n/a | MANUAL ACTION | `docs/DISTRIBUTION_PLAYSTORE.md` §4 + `DATA_MAP.md` |
| Content rating (IARC) | MANUAL ACTION | n/a | MANUAL ACTION | Complete honestly at submission |
| Target audience | MANUAL ACTION (adults proposed) | n/a | MANUAL ACTION | Declare at submission |
| Ads / accounts / billing | READY (none exist) | READY | READY | Code-evident; declare "No" |
| Financial-features declaration | MANUAL ACTION (external links only) | n/a | MANUAL ACTION | Prepared distinction in Play doc §4 |
| Health declaration | MANUAL ACTION (general fitness) | n/a | MANUAL ACTION | `docs/HEALTH_AND_FITNESS.md` as prepared answer |
| Contact email | MANUAL ACTION (not provisioned) | MANUAL ACTION (privacy contact, same gap) | MANUAL ACTION | Provision before submission |
| Store metadata (title/desc/changelog) | READY (fastlane draft EN+ES) | READY (same fastlane draft) | READY | `fastlane/metadata/android/{en-US,es-AR}/` |
| Screenshots | MANUAL ACTION (missing, real captures only) | MANUAL ACTION (same) | MANUAL ACTION | `docs/STORE_ASSETS.md` scenarios |
| Feature graphic 1024×500 | MANUAL ACTION (missing) | n/a | MANUAL ACTION | Create from real UI |
| High-res icon 512 | READY (source 1024 exists) | READY | READY | Downscale at upload |
| Source availability | n/a | READY (public repo) | READY | github.com/v0idbrn/ApexFOSS |
| Dependency licensing | n/a | READY with notes | READY | All direct npm deps MIT; Gradle artifacts documented; firebase-messaging reviewer judgment pending |
| Proprietary components shipped | n/a | READY (none found) | READY | All 19 arm64 `.so` compiled during build |
| Telemetry / ads / trackers | READY (none) | READY (none) | READY | Inventory + `grep` clean |
| No INTERNET in release | PASS (verified APK + AAB) | Consistent | PASS | aapt + manifest checks |
| No self-updater / OTA | PASS (`ENABLED=false`) | PASS | PASS | Manifest meta-data |
| Reproducible build | NEEDS VERIFICATION | NEEDS VERIFICATION | NEEDS VERIFICATION | Not established |
| Git tag `v1.0.0` | MANUAL ACTION (after RC) | MANUAL ACTION (F-Droid builds from tags) | MANUAL ACTION | Do not create yet |
| Changelog / release notes | READY (`CHANGELOG.md` + fastlane `2.txt`) | READY | READY | — |
| GitHub Release published | MANUAL ACTION (not published) | n/a | MANUAL ACTION | After tag; include APK + checksums |
| Submission (upload / MR) | **NOT DONE (out of scope)** | **NOT DONE (out of scope)** | MANUAL ACTION | Internal/closed testing first |

**Bottom line:** technically prepared on every axis the repository controls, except the **16 KB `libwatermelondb-jsi.so` blocker** (Play) and the **unproven F-Droid trial recipe**. Everything else remaining is a manual Console/reviewer action, not repository work.
