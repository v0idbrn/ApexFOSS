# ApexFOSS — Known Limitations

**Last updated: 2026-09-25 (Phase 2G).** Honest list of what this software does *not* do, *cannot* guarantee, or has deliberately left open. Cross-references: `docs/SECURITY_AUDIT.md` (finding IDs), `docs/DECISIONS.md` (decision IDs).

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
16. **Deep-link and notification flows are unit-tested but not device-tested** in Phase 2G (no device connected).

## Distribution

17. **No store submissions or store-compliance claims** have been made. Health/privacy surface and channel-specific concerns are catalogued in `docs/DISTRIBUTION.md`; each channel requires work before release.
18. **Draft legal documents** (`docs/TERMS_OF_USE.md`, privacy copy) require human/legal review before distribution; contact identity and governing law are deliberately unfilled.

## Engineering state

19. **Frozen stack**: Expo 55 / RN 0.83.10 / WatermelonDB 0.28 (JSI) / NativeWind 4 / schema v3. Upgrades are deliberate, large and out of scope for maintenance phases.
20. **Per-entity deletion exists for exercises/routines; sessions have no per-item delete UI** — full wipe is the only way to remove history (until a future phase adds history deletion UX).
21. **No device validation performed in Phase 2G** — "Device validation skipped: no device connected." (Still none connected in Phase 2I.)
22. **No React error boundary or global crash handler** (Phase 2I): an uncaught render error in a release build exits the app to the launcher with no in-app recovery screen. Data is not corrupted by such a crash — every engine action commits to the database before the UI advances, and timers restore from persisted `cursor_json.expiresAt` on relaunch.
