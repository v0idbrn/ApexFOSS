# ApexFOSS — Known Limitations

**Last updated: 2026-09-26 (Phase 2K).** Honest list of what this software does *not* do, *cannot* guarantee, or has deliberately left open. Cross-references: `docs/SECURITY_AUDIT.md` (finding IDs), `docs/DECISIONS.md` (decision IDs).

## Product scope

1. **Android only.** No iOS, desktop, web or wearable client. RN architecture would allow more platforms, but none are built or tested.
2. **Single-device storage.** No sync, no cloud, no multi-device continuity. Data lives where you installed the app.
3. **No accounts, no subscriptions, no monetization** — and consequently no account recovery: **lose the device without a backup, lose the data.**
4. Out of scope by design (spec): camera/video analysis, jump estimation, Health Connect, wearables, HR/HRV/sleep/GPS, AI/coaching recommendations, LAN/desktop pairing, social features, ads/analytics.

## Accuracy and claims

5. **No accuracy guarantees.** Readiness, load, volume and autoregulation values are arithmetic over user-entered data. They may be wrong (wrong inputs, wrong model assumptions, bugs). No fitness or health outcome is promised.
6. **Not medical software** (`docs/HEALTH_AND_FITNESS.md`): no diagnosis, treatment, monitoring, prediction, or advice. No regulatory classification is claimed anywhere.
7. **"Local-first" ≠ "zero data"** — the precise statement is in `docs/DATA_MAP.md` (OS Auto Backup can copy app data to the user's cloud if enabled).

## Data and security

8. **Database not encrypted at rest beyond device encryption** (no SQLCipher). Anyone who obtains an unlocked device or an unencrypted copy of the file can read workout data (SECURITY_AUDIT F-05).
9. **QR payloads are integrity-checked, not encrypted** (SHA-256 checksum = corruption detection, never authentication/signature/encryption — SECURITY_AUDIT F-08). Pointing a camera at someone's QR screen reveals the routine.
10. **Checksums are not signatures.** A hostile file with a self-computed checksum is still hostile; the real boundary is validation + size caps + preview + explicit confirmation.
11. **Full local wipe is not forensic erasure** (SECURITY_AUDIT F-11): rows are permanently destroyed, but flash pages may retain old data until the OS reuses them.
12. **Auto Backup is enabled with OS-default scope** (`allowBackup=true`, no extraction rules; D-034/F-04). Exact scope depends on the Android version and the user's backup provider.
13. **`SYSTEM_ALERT_WINDOW` permission is present** (inherited from the React Native toolchain) though never requested at runtime; removal is pending device verification (D-035).
14. **No license file yet** — licensing status is undeclared until the owner decides (D-038/F-18); READMEs state "license: pending" accordingly.
15. **12 moderate npm advisories are outstanding** (all indirect; npm's suggested fixes would downgrade core dependencies; D-039/F-19). Revisit at the next dependency-maintenance window.
16. **Deep-link flows and actual notification delivery are unit-tested but not device-tested** (no device in Phase 2G). Phase 2K observed the POST_NOTIFICATIONS permission prompt on hardware (prompt appearance + decline path), but a rest-timer notification actually being delivered, and `apexfoss://` deep links opening from another app, remain unvalidated.

## Distribution

17. **No store submissions or store-compliance claims** have been made. Health/privacy surface and channel-specific concerns are catalogued in `docs/DISTRIBUTION.md`; each channel requires work before release.
18. **Draft legal documents** (`docs/TERMS_OF_USE.md`, privacy copy) require human/legal review before distribution; contact identity and governing law are deliberately unfilled.

## Engineering state

19. **Frozen stack**: Expo 55 / RN 0.83.10 / WatermelonDB 0.28 (JSI) / NativeWind 4 / schema v5. Upgrades are deliberate, large and out of scope for maintenance phases.
20. **Per-entity deletion exists for exercises/routines; sessions have no per-item delete UI** — full wipe is the only way to remove history (until a future phase adds history deletion UX).
21. **Physical-device validation exists but is incomplete (Phase 2K).** The universal release APK was installed and exercised on **one device — Samsung SM-A045M (Galaxy A04e), Android 14 / API 34, `arm64-v8a`, locale es-AR, 720×1600**. Validated on hardware: install + launch, Home rendering/scrolling and Trust-row reachability, routine authoring end-to-end (editor, block/step, exercise picker, prescription fields, save, list), routine preview and integrity check ("No problems found."), workout launch (progress header, round/planned sets, target tile, ACTUAL section, athlete numpad, RIR autoreg toggle, COMPLETE/Skip/Undo/Finish reachability), active-session resume across screen-leave with timer catch-up, the notification permission prompt (declined path), and cold-restart data persistence after process death (no crash, data intact). **Not physically validated** (the device was disconnected before the matrix finished): full timer pause/resume, timer background/return reconciliation, session completion/summary/session notes, History/analytics/PRs/compare fed by a real session, equipment persistence across restart, substitutions interaction, full Trust Center navigation, a full EN/ES pass, and a post-fix smoke of the Phase 2K UI fixes — the V1/V3/V3b fixes are covered by Jest regression tests only.
22. **No React error boundary or global crash handler** (Phase 2I): an uncaught render error in a release build exits the app to the launcher with no in-app recovery screen. Data is not corrupted by such a crash — every engine action commits to the database before the UI advances, and timers restore from persisted `cursor_json.expiresAt` on relaunch.
23. **Exercise substitutions are heuristics, not physiology** (Phase 2J): movement pattern is inferred from name/category/equipment keywords, muscle overlap comes from the app's own per-exercise contributions, and there is no EMG, rental, or clinical data behind the ranking. It suggests; it is never authoritative, and unknown patterns/equipment deliberately score lower rather than guessing.
24. **Routine integrity checks are advisory** (Phase 2J): they run against the same engine semantics as the workout engine, but a routine that "checks clean" is still only validated on the dimensions encoded (rounds, transitions, targets, ids) — not on training appropriateness, safety, or medical fit.
25. **Session notes are single-column, session-level text** (Phase 2J, schema v5): capped at 2000 characters, included in backups and history JSON export but **not** in the CSV export; there is no per-exercise note field and no rich text/search over notes yet.
26. **One universal APK, ARM ABIs only** (Phase 2K): the release build is a single standalone (`SINGLE`) APK containing `arm64-v8a` and `armeabi-v7a` native libraries (18 `.so` per ABI, identical sets); `x86`/`x86_64` are deliberately excluded because the current native dependency stack targets physical ARM devices (x86 is emulator-oriented). Install boundary: Android 7.0+ (minSdk 24, targetSdk 36), verified against one Android 14 handset — broad ARM Android compatibility within those constraints, **not** "runs on every Android phone".
