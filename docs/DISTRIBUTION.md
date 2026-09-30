# ApexFOSS — Distribution

**Status: GitHub Release v1.1.0 published (pre-release); NO store submission (Play/F-Droid) has been made. Nothing here is a claim of compliance or approval.**
**Last updated: 2026-09-30 (distribution expansion).**

Channels under consideration: **GitHub Releases**, **F-Droid**, **Google Play**. Each has different requirements; all require work listed below before an actual release.

Deep readiness docs (this pass): [DISTRIBUTION_PLAYSTORE.md](DISTRIBUTION_PLAYSTORE.md) (technical, listing, Data Safety, AAB validation), [DISTRIBUTION_FDROID.md](DISTRIBUTION_FDROID.md) (source build, dependencies, AntiFeatures), [DISTRIBUTION_MATRIX.md](DISTRIBUTION_MATRIX.md) (cross-channel status table), [STORE_ASSETS.md](STORE_ASSETS.md) (graphics checklist), [FDROID_METADATA_REFERENCE.yml](FDROID_METADATA_REFERENCE.yml) (draft submission reference), `fastlane/metadata/android/` (draft listing copy, en-US + es-AR).

## Common prerequisites (all channels)

- [x] Resolve licensing: add a `LICENSE` file (D-038 — resolved at v1.0.0: **GPL-3.0-or-later**; F-Droid *requires* a recognized FOSS license, Play does not).
- [ ] Legal review: `docs/TERMS_OF_USE.md` (fill identity/contact/governing law), `docs/PRIVACY.md` review, `docs/HEALTH_AND_FITNESS.md` consistency (D-042 scope).
- [ ] Provision a real security contact (see `SECURITY.md`) and a privacy contact.
- [ ] Device validation of Phase 2G surfaces (deep links, notification permission flow, Trust Center) — **skipped this phase: no device connected**.
- [ ] Reproducible/clean release build from a tagged commit: `npm run prebuild`, `assembleRelease`, verify with the audit checklist in `docs/SECURITY_AUDIT.md` (badging, apksigner, content scan).
- [ ] Decide signing-key custody story: the release keystore currently lives at `~/.apexfoss/apexfoss-signing.properties` **outside the repository** (good), but the owner must decide rotation/backup of that key — losing it means losing update identity.

## GitHub Releases (live since v1.1.0)

- v1.1.0 published as pre-release at `https://github.com/v0idbrn/ApexFOSS/releases/tag/v1.1.0` (tag `v1.1.0`, `app-release.apk` + SHA-256 + notes). Per-release process stays: tag → release with APK + checksums + notes.
- No platform privacy form; the repo's own `docs/PRIVACY.md` / `docs/DATA_MAP.md` serve as the privacy surface.
- Known trade-offs: sideload warnings on Android (unknown sources), no auto-update (by design: expo-updates disabled; Obtainium covers update tracking), users trust the signing key published in the release notes (cert fingerprint `5ea2889b…973eb0`).

## Google Play

### Health/privacy surface that Play will probe (spec §22)

Play's health/fitness and data-safety questionnaires will effectively ask:

| Play question area | Honest answer prepared from this repo |
|---|---|
| Is this a medical/health app? Does it diagnose/treat/monitor? | **No.** General fitness logging/timing only — `docs/HEALTH_AND_FITNESS.md`. If Play's medical-device policy team asks anyway, answer from that document; **no regulatory classification is claimed here** (D-040/D-042). |
| Data collected / shared | **None collected, none shared by the app** (no INTERNET permission in release). Data-safety form: "No data collected" *plus* the OS-backup caveat per `docs/DATA_MAP.md` — the form's precise treatment of Auto Backup must be confirmed against Play's current guidance at submission time. |
| Data encrypted in transit / at rest | In transit: app makes no transmissions. At rest: device encryption only (no app-level SQLCipher) — answer per Play's current form wording honestly. |
| Permissions justification | POST_NOTIFICATIONS (rest-timer alerts), VIBRATE (haptics), RECEIVE_BOOT_COMPLETED (re-schedule local notifications), legacy storage ≤ Android 12 (share flows). `SYSTEM_ALERT_WINDOW` inherited from RN — **either justify or remove with device verification (D-035)**; Play scrutinizes this permission heavily. |
| Account/deletion policy | No accounts exist; in-app full deletion exists (Trust Center) + OS-level "delete app data". |
| Target audience | Adults (fitness training); no children-directed features — but the questionnaire answer must be re-checked at submission. |
| Ads/Analytics | None. |

### Play-specific blockers/risks

1. `SYSTEM_ALERT_WINDOW` (D-035) may trigger permission-review scrutiny — preferred path: device-verify removal in a future phase.
2. The FCM/Firebase classes merged in by `expo-notifications` (F-14) exist without `google-services.json` — harmless (no INTERNET anyway) but reviewers may ask; the security audit documents it.
3. Signing: Play App Signing enrollment must be decided (upload key = current `CN=ApexFOSS` keystore vs. Google-managed key).
4. `versionCode` is 3 — every upload needs a bump (process decision; currently manual).
5. **16 KB page alignment — fixed and verified** (`plugins/with16KbPageSize.js`, D-054): `libwatermelondb-jsi.so` now ships with 16 KB ELF alignment like every other arm64 library — see [DISTRIBUTION_PLAYSTORE.md](DISTRIBUTION_PLAYSTORE.md) §1.4. Re-run the binary check on the exact submission build.

## F-Droid

F-Droid accepts only FOSS apps meeting its inclusion policy (spec §23):

1. **License:** must be an approved FOSS license — satisfied: **GPL-3.0-or-later** (`LICENSE`, D-038).
2. **No anti-features:** the app has no ads/tracking/non-FOSS deps *in the source*, but F-Droid also checks the build recipe:
   - dependencies must be buildable from source or prebuilt blobs with source (Fastlane/F-Droid metadata will need all npm/Gradle deps covered by `tidelift`/`scancode` review);
   - `expo prebuild`-generated `android/` code and precompiled JS bundles must be handled by the metadata recipe (likely `srclib`/`excluded` approaches) — **this is the largest engineering item for F-Droid**.
3. **No built-in updater calling home** — satisfied (no expo-updates; no in-app updater).
4. **Anti-feature checks:** none expected (no surveillance, no non-free network service dependence — the app works fully offline).
5. **Version/reproducibility:** F-Droid wants tagged releases with buildable sources; reproducible builds are encouraged (not yet established here).

## Sign-off checklist before ANY public distribution

- [x] LICENSE decided and added (D-038: GPL-3.0-or-later)
- [ ] Legal docs reviewed (identity, contact, governing law filled)
- [ ] Security contact provisioned (`SECURITY.md`)
- [ ] Device validation pass (deep link, notifications, wipe, palette legibility on-screen)
- [ ] Store questionnaires answered from `docs/HEALTH_AND_FITNESS.md` + `docs/DATA_MAP.md` without overclaiming
- [x] Signing certificate fingerprint published with the release (`5ea2889b…973eb0` in the v1.1.0 notes; key custody/rotation story still open)
- [x] Release APK re-audited from the exact tagged commit — v1.1.0: package/version/ABIs, no INTERNET, non-debuggable, `CN=ApexFOSS` signer, 16 KB + `zipalign -P 16` clean (SHA-256 `D054DB9B…6CB7AAF7`)
- [x] Tag `v1.1.0` created; GitHub Release published (pre-release: device validation pending) with APK + SHA-256 + notes

**GitHub Release v1.1.0 is live. No store submission (Play/F-Droid) and no other registration performed.**
