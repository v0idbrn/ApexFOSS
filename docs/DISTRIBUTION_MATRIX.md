# Distribution Matrix — Channels & Requirements

**Status: GitHub Release v1.1.0 published (pre-release); no store presence. Last updated: 2026-09-30.**
**Channel states:** published · submitted · ready · blocked · deferred.

## Channels

| Canal | Estado | Requisitos | Próximo paso | Bloqueador |
|---|---|---|---|---|
| GitHub Releases | published (v1.1.0 pre-release + APK + SHA-256) | tag + notes + asset | Done — maintain per release | none |
| Obtainium | ready (tracks the published release) | nothing in-app | Done (user path documented) | none |
| F-Droid | ready (submission pack prepared) | `fdroiddata` MR + trial build + screenshots | Owner files MR (GitLab) with `docs/DISTRIBUTION_FDROID_SUBMISSION.md` §1 | GitLab-side MR + screenshots + reviewer process |
| IzzyOnDroid | ready (pack prepared) | GitHub Release + fastlane complete + issue filed | Publish release, capture screenshots, file Codeberg suggestion issue | Screenshots; ~41 MB vs 30 MB guideline; maintainer-filed issue |
| Uptodown | deferred (prepared) | free account + APK upload by owner | Owner registers + uploads | Owner account action |
| Aptoide | deferred | Manual path needs subscription (not on Play) | Revisit once on Google Play (then automatic) | Subscription cost; not on Play |
| Huawei AppGallery | deferred | Huawei ID + review + metadata | Revisit on user demand | Identity verification + review overhead |
| Samsung Galaxy Store | do not use | Commercial seller status + business docs | — (incompatible with solo FOSS) | Business-entity requirements |
| APKPure | do not use | No submission path (Play mirror) | — | No path without Play listing |
| Google Play | deferred | $25 + ID + testing + Console forms | Owner authorizes fee/identity (NOT authorized) | Economic/contractual owner actions |

## Requirements (Play Store vs F-Droid)

**Statuses:** `PASS` (verified) · `READY` (prepared, no blocker) · `MANUAL ACTION` (owner/Console step) · `BLOCKED` (must fix first) · `NEEDS VERIFICATION` (unproven).

| Requirement | Play Store | F-Droid | Status | Evidence / Action |
|---|---|---|---|---|
| Package ID `com.apexfoss.app` | PASS | PASS | PASS | `app.json`, `build.gradle`, aapt/AAB checks |
| License GPL-3.0-or-later | n/a (Play accepts any) | PASS | PASS | `LICENSE`, SPDX field, `docs/THIRD_PARTY_LICENSES.md` |
| Version 1.1.0 / code 3 | READY | READY | READY | Pinned; release tags intentionally not created yet |
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
| Git tag `v1.1.0` | READY (created for release) | READY (F-Droid builds from tags) | DONE | tag `v1.1.0` → release commit |
| Changelog / release notes | READY (`CHANGELOG.md` + fastlane `2.txt`/`3.txt`) | READY | READY | — |
| GitHub Release published | PUBLISHED (v1.1.0 pre-release + APK + notes) | n/a | DONE | https://github.com/v0idbrn/ApexFOSS/releases/tag/v1.1.0 |
| Submission (upload / MR) | **NOT DONE (out of scope)** | **NOT DONE (out of scope)** | MANUAL ACTION | Internal/closed testing first |

**Bottom line:** GitHub Release v1.1.0 is published (pre-release, device validation pending). F-Droid and IzzyOnDroid packs are prepared; their submissions are manual reviewer processes. Play/Uptodown/Aptoide/Huawei/Samsung assessed in `docs/DISTRIBUTION_CHANNELS.md` — all deferred or out except the GitHub/Obtainium path. No other technical blocker remains on the repository side.
