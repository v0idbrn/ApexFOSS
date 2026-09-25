# ApexFOSS Security Audit — Phase 2G

- **Date:** 2026-09-25
- **Scope:** full repository static security/privacy/licensing audit + release build verification (spec Phase 2G §2–§26)
- **Method:** source inspection (src/, android/, plugins/, package.json), config-plugin and manifest analysis, unit tests, static analysis of the built release APK (`aapt dump badging`, `apksigner`, APK content scan), `npm audit` data.
- **Environment note:** **No device was connected during this phase.** Device validation is explicitly not an acceptance criterion for Phase 2G; every runtime claim below is backed by static analysis or unit tests instead, and open items are listed under *Unresolved / manual review*.

**Severity scale used in this document**

| Severity | Meaning |
|---|---|
| CRITICAL | Direct data exfiltration, remote code execution, or full account/device compromise with no precondition. |
| HIGH | Significant security boundary bypass reachable in normal use. |
| MEDIUM | Security/privacy weakness with meaningful preconditions or limited impact; requires mitigation or explicit disclosure. |
| LOW | Hardening gap, defense-in-depth issue, or accepted risk with narrow exploitability. |
| INFORMATIONAL | Observation, kept-as-is surface, or positive control worth recording (no action required). |

All findings below were **verified to exist** before being reported (audit-first rule). Nothing was added "for security theater": every mitigation is tied to a concrete reachable surface.

---

## 1. Network and data egress

### Evidence reviewed
- Static search of `src/` for network APIs: no `fetch`, `XMLHttpRequest`, `WebSocket`, `axios`, `http.*`, `navigator.sendBeacon`, `expo-updates` fetches. The only `.fetch()` matches are WatermelonDB query `.fetch()` (local database).
- `expo-updates` is disabled: `expo.modules.updates.ENABLED = false` (verified in the release merged manifest) — no remote JS/code download path.
- Notifications are **local-scheduled** (`expo-notifications` date triggers); no push tokens are requested, no FCM registration occurs, no `google-services.json` exists anywhere in the repository.
- Exports/shares go through Android share intents (user-initiated), not network.

### Action taken
- **INTERNET permission removed from the release manifest** by the new config plugin `plugins/withNetworkHardening.js` (decision D-033), which writes a manifest-merger `tools:node="remove"` marker. A plain strip is not sufficient because `expo-file-system`'s own Android manifest re-declares INTERNET at Gradle merge time (verified: `node_modules/expo-file-system/android/src/main/AndroidManifest.xml`).
- Debug builds keep INTERNET through `android/app/src/debug/AndroidManifest.xml` (explicit `tools:node="merge"`, higher priority than main) so Metro and expo-dev-client keep working.

### Verification (release APK, static)
```
aapt dump badging app-release.apk
→ uses-permission list contains NO android.permission.INTERNET   ✅
aapt dump badging app-debug.apk
→ uses-permission: name='android.permission.INTERNET'           ✅ (debug only)
```

### Findings
- **F-01 (MEDIUM, remediated):** Release builds before Phase 2G shipped with INTERNET. Mitigated as above and verified on the actual release APK.
- **F-02 (MEDIUM, remediated):** Library-level re-declaration of INTERNET (`expo-file-system`) would silently undo a naive strip. Mitigated with the merger-level removal marker (this is why the plugin exists).
- **F-03 (INFORMATIONAL):** `ACCESS_NETWORK_STATE` remains in the release manifest (library-declared). It only allows checking connectivity state; it cannot open sockets. Kept.

### Residual risk
A future dependency update could introduce network code that fails at runtime with `SecurityException` instead of being obvious at review time. The release-manifest removal makes that failure **loud**, which is the desired behavior for this app.

---

## 2. Storage and data at rest

### Evidence reviewed
- Production adapter: `SQLiteAdapter({ dbName: 'apexfoss', jsi: true })` (src/data/index.ts). The database file lives in app-private storage (`/data/data/com.apexfoss.app/databases/apexfoss.db` + journal files).
- **No encryption-at-rest** (no SQLCipher/`secure-store` layer): data is protected by Android file-based encryption (FBE) and the device lock screen only.
- `android:allowBackup="true"` in the merged manifest, with **no** `dataExtractionRules`/`fullBackupContent` restrictions, so OS Auto Backup scope is whatever the OS default is for the device (typically includes the database).

### Findings
- **F-04 (LOW, disclosed, decision D-034):** Auto Backup sends app data to the user's configured cloud backup provider — that provider is third-party processing of a copy of local data. Disclosed in `docs/PRIVACY.md` / `docs/DATA_MAP.md`. Deliberately **not** blind-disabled (spec §0): disabling would silently stop user backups.
- **F-05 (LOW, accepted, documented):** Database is not encrypted beyond device encryption. Threat model: an attacker with the unlocked device or a forensic image of an unencrypted backup channel can read workout data. Data class is fitness history only (no credentials, no health-device records). Documented in `docs/KNOWN_LIMITATIONS.md`.

### Positive controls
- App-private storage only; no database copies in shared/external storage.
- Exports are only created on explicit user action.

---

## 3. Input validation and untrusted data

Every external input in this app follows: **EXTERNAL INPUT → VALIDATE → PREVIEW → EXPLICIT CONFIRMATION → ATOMIC WRITE** (spec §9). Surfaces: pasted routine JSON, pasted backup JSON, QR payload text, `apexfoss://import?d=` deep links, in-app typed text (already covered by strict validators: `reqStr`/`reqInt` with finite/integer/min/max checks and structural caps `MAX_BLOCKS`/`MAX_STEPS`/`MAX_EXERCISES`).

### Changes made this phase (decisions D-036)
1. **Byte-size ceilings before `JSON.parse`:**
   - `MAX_ROUTINE_JSON_BYTES = 5_000_000` (parseRoutinePackage)
   - `MAX_BACKUP_JSON_BYTES = 33_554_432` (parseBackup)
   Measured in UTF-8 bytes (`utf8ByteLength`), checked **before** parsing so hostile multi-MB pastes are rejected without allocating the parsed object tree.
2. **Deep-link branch unified:** `PortabilityScreen` no longer uses an ad-hoc unbounded regex (`/[?&]d=([A-Za-z0-9_-]+)/`) to decode pasted deep links; it now calls `parseImportDeepLink`, which enforces the scheme/host/charset checks plus the `MAX_PORTABLE_PAYLOAD_BYTES + 64` transport cap.
3. **No new validation dependency added** (no Zod/Valibot): the existing strict validators plus the new caps fully cover the demonstrated risks; adding a schema library would enlarge the attack surface of a frozen stack without closing a concrete hole.

### Findings
- **F-06 (MEDIUM, remediated):** Unbounded `JSON.parse` on pasted input (resource-exhaustion / DoS of the app process). Fixed + boundary tests (`src/security/inputBoundaries.test.ts`: exact-cap, over-cap, UTF-8 byte semantics).
- **F-07 (LOW, remediated):** Ad-hoc deep-link decode path bypassed the hardened parser. Fixed + tests.
- **F-08 (INFORMATIONAL):** Checksums (`semanticChecksum` = SHA-256 over canonical JSON) are **corruption/integrity detection only — not authentication, signature or encryption** (spec §10). A hostile package with a self-computed valid checksum still passes this check — that is by design; structural validation, size caps, preview and explicit confirmation are the security boundary. Stated explicitly in `docs/KNOWN_LIMITATIONS.md`.

### Threat notes verified by tests
- Prototype-pollution payloads in deep links or backups are rejected as invalid input and leave `Object.prototype` untouched.
- All deep-link hostile cases (wrong scheme/host, missing param, bad charset, oversized payload, non-string) return typed failures instead of throwing uncontrolled.

---

## 4. Export and import flows

### Evidence reviewed
- Routine import: preview (`previewRoutineImport` is read-only) → Alert with name/block/step counts → explicit confirm → `importRoutinePackage` performs a single `db.write` with compensating rollback on mid-write failure (tests: *rollback on mid-write failure leaves no partial rows*, *preview does not mutate database*).
- Backup restore: full-replace policy inside one write with snapshot-based rollback (tests: *rejects corrupt checksum without mutating db*, *rollback on restore failure leaves original data*).
- CSV export: RFC 4180 escaping.

### Change made this phase
- **CSV formula-injection guard** in `escapeCsvField` (spec §13): values starting with `=`, `+`, `@`, TAB or CR (or `-` not followed by a digit) are prefixed with an apostrophe, which spreadsheet apps render as literal text. Legitimate negative numbers are untouched. JSON export keeps raw fidelity (guard is CSV-only).

### Findings
- **F-09 (LOW, remediated):** Imported routine/exercise names are attacker-controllable content once a package is imported; re-exported to CSV they could execute formulas when opened in a spreadsheet. Fixed + tests (`src/security/exportSecurity.test.ts`).

---

## 5. Local data deletion (spec §14)

### Implemented this phase (decision D-037)
- `wipeAllLocalData(db)` / `deleteAllLocalData(db)` (src/data/deletion.ts): destroys **every row of every table** via `destroyPermanently()` (real row removal — no Watermelon tombstones left behind), clears the rest-timer notification (cancel-all), clears the zustand timer mirror and the active-session mirror. Starter exercises re-seed on next launch (app content, documented).
- Exposed in the in-app **Trust, Safety & Legal** center behind `confirmDestructive` (destructive confirmation dialog with explicit "cannot be undone" copy + "create a backup first" hint).

### Findings
- **F-10 (MEDIUM, remediated):** No mechanism existed to delete *all* local data in one confirmed action (bulk data-subject style deletion). Implemented + tested (wipe-to-empty across all 10 tables, counts returned, restart/reseed behavior, runtime-mirror cleanup, notification cancellation).
- **F-11 (LOW, disclosed):** This is **not forensic erasure**: flash pages may retain old data until reused by the OS. Copy and docs deliberately avoid "secure wipe" claims.

---

## 6. Android application surface

### 6.1 Permissions in the release APK (verified with `aapt dump badging`)

| Permission | Origin | Verdict |
|---|---|---|
| `INTERNET` | — | **ABSENT in release** (F-01). Present in debug only. |
| `READ/WRITE_EXTERNAL_STORAGE` (maxSdk 32) | expo-file-system / prebuild | Kept: inert on API 33+ (target 36); conservative for API ≤32 share flows. INFORMATIONAL. |
| `SYSTEM_ALERT_WINDOW` | `react-native/ReactAndroid` library manifest | Kept (D-035): never requested at runtime by app code; no device connected to verify removal is safe → manual-review item. |
| `VIBRATE` | timer/rest haptics | Kept (needed). |
| `RECEIVE_BOOT_COMPLETED` | expo-notifications (re-schedule local notifications after reboot) | Kept (needed; receiver is `exported="false"`). |
| `POST_NOTIFICATIONS` | expo-notifications | Kept (runtime-requested for rest alerts). |
| `ACCESS_NETWORK_STATE` | libraries | Kept (state checks only; no socket capability). |
| `WAKE_LOCK`, `c2dm.RECEIVE`, `BIND_GET_INSTALL_REFERRER_SERVICE` | libraries (Play/Firebase/notifications) | INFORMATIONAL; dormant (see F-14). |
| Launcher badge permissions (Samsung/HTC/Sony/Huawei/Oppo/…), `ShortcutBadger` | expo-notifications | INFORMATIONAL: icon badge display only, no data leaves the device. |
| `com.apexfoss.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | androidx | INFORMATIONAL: signature-level self-protection. |

### 6.2 Exported components (release merged manifest)

- **MainActivity — `exported="true"`:** required for the launcher and for `apexfoss://` / `exp+apexfoss://` deep links. Threat consideration: any app can send an intent — mitigated because the deep-link path only stores a size-capped transport payload (take-once, never auto-imports) and still requires the full validate→preview→confirm flow (tests in `src/security/inputBoundaries.test.ts`).
- **FileSystemFileProvider — `exported="false"`, `grantUriPermissions="true"`:** standard FileProvider; accessible only through URI grants the app issues for its own share actions.
- **NotificationsService receiver — `exported="false"`:** restores local notifications on boot; receives system broadcasts.
- **NotificationForwarderActivity — `exported="false"`**, Firebase/Google components as below.
- **FirebaseInstanceIdReceiver — `exported="true"`**, guarded by `com.google.android.c2dm.permission.SEND`.
- **ProfileInstallReceiver — `exported="true"`**, guarded by `android.permission.DUMP` (signature-level).

### Findings
- **F-12 (INFORMATIONAL):** `android:allowBackup="true"` with no backup-scope rules → see F-04.
- **F-13 (INFORMATIONAL):** Deep-link entry point is exported by necessity; the import pipeline behind it is validated, capped, previewed and confirmed (covered by tests).
- **F-14 (LOW, neutralized by configuration + permissions):** `expo-notifications` pulls in the Firebase Cloud Messaging stack (`firebase-messaging` 25.0.1), and its components (FirebaseMessagingService, FirebaseInitProvider, datatransport/CCT logging services) are merged into the APK. However: (a) **no `google-services.json` exists**, so there is no Firebase project configured; (b) **the release APK has no INTERNET permission**, so any attempt by these components to reach the network fails with `SecurityException`; (c) the app never requests push tokens. Push/telemetry is therefore **non-functional by three independent controls**. Documented rather than claimed as "absent", because the code is present.
- **F-15 (INFORMATIONAL):** Cleartext traffic: release manifest contains no `usesCleartextTraffic` override (platform default = disabled for targetSdk ≥ 28). `usesCleartextTraffic="true"` exists **only** in the debug source-set manifest (Metro dev server), which is debug-only by construction.

---

## 7. Notifications and timers

- Notification content is a **fixed template** (`title` from engine event names, body `"Rest is over — next set."`), alert-only, no sound/badge, **no sensitive text** (no routine names, no set data) (D-040 adjacent; verified in src/notifications/index.ts).
- `cursor.timer.expiresAt` remains the single canonical timer; notifications are advisory only; after process death the notification cancel path clears leftovers so a stale alert cannot double-fire (D-031 preserved; unchanged this phase).
- Permission is requested lazily when a rest timer is actually scheduled — not on app start.

### Findings
- **F-16 (INFORMATIONAL):** No changes needed; behavior audited and pinned by existing + new tests (`deleteAllLocalData` cancels scheduled notifications).

---

## 8. Build, signing and release hygiene

### Verified on the actual Phase 2G release APK
| Check | Result |
|---|---|
| Package / version | `com.apexfoss.app`, versionCode 1, versionName 0.1.0 |
| SDKs | minSdk 24, targetSdk/compileSdk 36 |
| ABIs | `arm64-v8a`, `armeabi-v7a` only (per `gradle.properties` `reactNativeArchitectures`) |
| Debuggable | release **not** debuggable (debug APK is, as expected) |
| Signing | `apksigner verify` exit 0; signer `CN=ApexFOSS, OU=ApexFOSS, O=ApexFOSS, C=AR` |
| Keystore location | `~/.apexfoss/apexfoss-signing.properties` (outside the repository; injected at Gradle configure time by `plugins/withApexSigning.js`) |
| Machine paths in APK | none found (`F:\Gigs…` scan: clean) |
| `.env` / secrets in APK | none found (scan of bundle/JSON/XML/properties entries: clean) |
| Metro/dev server addresses | no `:8081`, no `ws://`, no `127.0.0.1`; the bare word "localhost" appears inside minified library JS strings with no port or configuration attached (INFORMATIONAL) |
| URL-like strings in JS bundle | only inert documentation/asset hosts (`docs.expo.dev`, `github.com`, `reactnative.dev`, `classic-assets.eascdn.net`, `exp.host`, `expo.fyi`) — no API endpoints |
| expo-updates | `ENABLED=false` (no remote-code path) |
| Debug artifacts in release | none (no `__DEV__`-gated Metro bundle, no debug keystore path leakage found) |

### Findings
- **F-17 (INFORMATIONAL):** Positive controls confirmed (external keystore, no secrets in repo/APK, single-arch ABIs, non-debuggable release).
- **F-18 (LOW, unresolved):** **No `LICENSE` file exists** while `README.md` describes the project as open source — a licensing inconsistency the codebase cannot resolve by itself (D-038, owner decision). Also tracked in `docs/KNOWN_LIMITATIONS.md`.
  - *Status update (Phase 2I, 2026-09-25):* the README wording cited above was corrected in Phase 2H (commit `b56b8b3`) — both READMEs now state "license: pending" and make no open-source claim. The core finding (no `LICENSE` file, owner decision D-038) **remains open**.

---

## 9. Dependencies and supply chain

- `npm audit` (report captured this cycle): **12 moderate, 0 high, 0 critical**, across 1040 audited dependencies. All are indirect chains:
  - `@babel/runtime < 7.26.10` (GHSA-968p-4wvh-cqc8, regex complexity in generated code) reachable under `@nozbe/watermelondb` — npm's suggested "fix" is a **semver-major downgrade** of WatermelonDB to 0.25.5 (unacceptable).
  - `@expo/cli` / `@expo/config*` / metro/prebuild tooling chains — npm's suggested fix is a downgrade to **expo 46** (unacceptable).
- No production code executes Babel-generated regexes over untrusted input at runtime (Babel runtime helpers are used for transpilation output, not user input processing), and the Expo CLI advisories concern build-time tooling, not the shipped APK.

### Findings
- **F-19 (LOW, deferred, decision D-039):** No dependency upgrades performed. Controlled upgrades of the frozen Expo 55 / RN 0.83 / WatermelonDB 0.28 stack are out of scope for Phase 2G; `npm audit fix --force` would downgrade core dependencies. Rationale and future action documented in DECISIONS.md.
- **F-20 (INFORMATIONAL):** No new runtime dependencies were introduced by Phase 2G (palette, deletion, Trust Center, caps are all in-repo code).

---

## 10. Test coverage for security boundaries

New suites this phase (53 new tests; total suite: 480 tests / 29 suites, all green; `tsc --noEmit` clean):

| Suite | Covers |
|---|---|
| `src/security/inputBoundaries.test.ts` | size caps (exact/over/UTF-8 bytes), deep-link hostile inputs (scheme/host/charset/oversize/non-string), take-once pending deep link, proto-pollution attempts |
| `src/security/exportSecurity.test.ts` | CSV formula-injection guard, RFC 4180 regressions, JSON raw-fidelity |
| `src/security/palette.test.ts` | exact six-color token pinning, tailwind config parity, WCAG contrast floors |
| `src/data/deletion.test.ts` | counts, full wipe of all 10 tables, returned counts, empty-db no-op, runtime-mirror cleanup, notification cancel, restart + reseed |
| `src/ui/screens/TrustScreen.test.tsx` | all required sections, zeroed counts, destructive confirmation contract, failure path, Home entry navigation |

Pre-existing boundary coverage retained: routine/backup structural validation, checksum tamper, dangling references, atomic import rollback, backup restore rollback, QR capacity limits.

---

## Unresolved / manual review

Items that **cannot be closed statically in Phase 2G** (no device connected; owner input required):

1. **Device validation of `SYSTEM_ALERT_WINDOW` removal** (D-035): permission kept because it originates in React Native's own library manifest and its runtime effect could not be observed without a device. Candidate for a future phase: attempt removal and verify dev-menu/overlay behavior.
2. **Runtime notification permission flow** (Android 13+ POST_NOTIFICATIONS dialog) — logic reviewed statically (lazy request), not observed on a device.
3. **Deep-link receive on a real device** (another app → `apexfoss://import?d=…`) — parser path fully unit-tested, end-to-end intent delivery not observed.
4. **Auto Backup actual scope per Android version/provider** (F-04) — depends on OS defaults since no extraction rules are configured; document-then-decide whether to add explicit `dataExtractionRules` in a future phase.
5. **Licensing decision** (F-18 / D-038): add LICENSE or stop claiming "open source" — owner/legal decision; placeholders prepared in docs.
6. **npm moderate advisories** (F-19 / D-039): re-evaluate on the next planned dependency maintenance window.
7. **`TERMS_OF_USE.md` and privacy copy are drafts** requiring human/legal review before any public distribution; no regulatory classification or store-compliance claims are made anywhere in this repository.

---

## Verification commands used

```
npx tsc --noEmit                                  → PASS
npx jest                                          → 480 passed, 29 suites
npx expo prebuild -p android --clean              → regenerated android/ with all config plugins
gradlew assembleDebug assembleRelease             → BUILD SUCCESSFUL
aapt dump badging app-release.apk                 → no INTERNET, not debuggable, ABIs, versions
aapt dump badging app-debug.apk                   → INTERNET present (debug), debuggable
apksigner verify app-release.apk                  → exit 0, CN=ApexFOSS
APK content scan (bundle/json/xml/properties)     → no machine paths, no .env, no Metro, no keystore refs
```

**Device validation skipped: no device connected.**
