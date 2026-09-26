# ApexFOSS Data Map

**Status: maintained with the code (Phase 2J). Columns follow spec §19 (data map).**
**Categories:** every row is tagged `LOCAL STORAGE` (on device), `DEVELOPER COLLECTION` (received by the project), `THIRD-PARTY PROCESSING` (received by someone who is not the project), or `USER-INITIATED SHARING` (leaves the device only because the user acted).

> This map does **not** claim "zero data". It claims specific, verifiable behaviors.

| Data | Source | Stored where | Purpose | Leaves device? | Developer receives? | Export? | Delete? | Retention | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Exercise definitions (name, category, equipment, metric flags) | User input; app starter presets | Local SQLite (`apexfoss.db`), table `exercises` — `LOCAL STORAGE` | Author training | Only if the user exports/shares — `USER-INITIATED SHARING` | **No** — `DEVELOPER COLLECTION`: none | Yes (routine package JSON / QR / share intent) | Per-item delete, or Trust Center "Delete all local data" | Until deleted by user or wiped | Starter presets are app content and re-seed after a full wipe |
| Routines (blocks, steps, prescriptions, tempo, transitions, intervals) | User input; imported packages | Local SQLite, tables `routines`, `routine_blocks`, `routine_block_steps`, `routine_exercise_prescriptions`, `block_transitions` — `LOCAL STORAGE` | Author training | Only if the user exports/shares — `USER-INITIATED SHARING` | **No** | Yes (routine package JSON / QR / share intent) | Per-item delete, or full wipe | Until deleted by user or wiped | Imported packages pass validate → preview → explicit confirm → atomic write |
| Workout sessions + definition snapshots | User starting/completing workouts | Local SQLite, `workout_sessions` (incl. `definition_json`, `cursor_json`, optional `note`) — `LOCAL STORAGE` | Record training history, resume sessions | Only if the user exports history — `USER-INITIATED SHARING` | **No** | Yes (CSV / JSON history export; note travels in JSON and backups) | Full wipe (no per-session delete UI yet) | Until user deletes or wipes | `cursor.timer.expiresAt` is the canonical timer source; `note` is free text the user wrote (max 2000 chars) |
| Session exercises (bridge rows) | Derived at session start | Local SQLite, `session_exercises` — `LOCAL STORAGE` | Map logs to frozen definitions | No | **No** | Included in JSON history export | Full wipe | Until wiped | |
| Set logs (weight, reps, duration, RIR, completed flag) | User during workout | Local SQLite, `set_logs` — `LOCAL STORAGE` | History, analytics | Only via history export — `USER-INITIATED SHARING` | **No** | Yes (CSV / JSON) | Full wipe | Until wiped | CSV export neutralizes spreadsheet formula characters |
| Readiness tests (tap-test duration/count) | User tapping the screen | Local SQLite, `readiness_tests` — `LOCAL STORAGE` | Local readiness score | Only via history export if included — `USER-INITIATED SHARING` | **No** | JSON export where history is exported | Full wipe | Until wiped | Not a medical measurement |
| Equipment inventory (plate/piece name, weight, quantity, per-side flag) | User entering the equipment they own | Local SQLite, `equipment_items` — `LOCAL STORAGE` | Feed the load-inventory solver with real plates | Only via full backup if the user exports it — `USER-INITIATED SHARING` | **No** | Yes (`.apexbackup` includes it since schema v4) | Full wipe | Until user edits or wipes | App content only — no purchase history, no device scanning |
| Active session / rest timer state | App runtime | Local SQLite (`cursor_json`) + in-memory zustand mirrors — `LOCAL STORAGE` | Resume after restart; countdown UI | No | **No** | No | Cleared by full wipe (mirrors cleared too) | Until session ends / wipe | Notification is advisory; DB state is canonical |
| Rest-timer notifications | App (local scheduling via `expo-notifications`) | OS notification scheduler — `LOCAL STORAGE` (OS-managed) | "Rest is over" alert | No — no push, no FCM registration, no tokens | **No** | No | Auto-cancelled by full wipe / timer clear | Until fired or cancelled | Fixed text template; no workout data in the notification |
| App settings / UI state (dev menu, editor drafts) | User interaction | In-memory + minimal local persistence — `LOCAL STORAGE` | App function | No | **No** | No | Full wipe / app data clear (OS) | Session or until wiped | |
| Routine export files / backup files | User-triggered export | Written to app cache/share stream, handed to a share target — `USER-INITIATED SHARING` | User backup/portability | **Yes, when the user completes a share** | **No** (the project never sees it) | That *is* the export | User deletes the shared file | Until user or OS removes it | Sharing target (drive/messenger/file manager) is a third party *of the user's choosing* — `THIRD-PARTY PROCESSING` by that target |
| QR code shown on screen | User-triggered encode | Rendered pixels only — `LOCAL STORAGE` | Pair-free transfer | **Visible to cameras/screenshots** — treat as disclosed data | **No** | QR payload = routine package transport | n/a (not stored) | While screen shows it | Integrity-checked (SHA-256), **not encrypted** |
| Deep-link payload (`apexfoss://import?d=…`) | Another app / browser sending an intent | In-memory, take-once — `LOCAL STORAGE` | Import entry point | No | **No** | No | Consumed on read | Until read or app restart | Size-capped; never auto-imports; requires preview + confirm |
| OS Auto Backup of app data | Android backup framework | User's cloud backup account — `THIRD-PARTY PROCESSING` (the OS/vendor backup provider, not the project) | Device backup | **Yes, if enabled on the device** | **No** | n/a | User can delete backups in OS settings; `allowBackup=true` is set (D-034) | Per the backup provider's policy | Scope = OS default (no `dataExtractionRules` configured); documented in SECURITY_AUDIT F-04 |
| Install-time platform data | Play Store / F-Droid / GitHub / device | Distribution platform — `THIRD-PARTY PROCESSING` | Delivering the APK | Platform-dependent (store account, IP, etc. — governed by that platform's privacy policy) | **No** | n/a | Per platform controls | Per platform | The project operates no servers |
| Crash reports / analytics / telemetry | — | **Nothing exists** | — | No | **No** | n/a | n/a | n/a | No SDK for analytics/crash reporting is present in the dependency tree used at runtime |
| Accounts, payments, ads, subscriptions | — | **Nothing exists** | — | No | **No** | n/a | n/a | n/a | Explicitly out of scope for the product (spec) |

## Summary counts (verifiable statements)

- **`DEVELOPER COLLECTION` rows: none.** The project receives no data from users, through any channel.
- **Network capability of the release build: none** (INTERNET permission removed and verified absent — `docs/SECURITY_AUDIT.md` §1).
- **Data that can leave the device:** (a) user-initiated exports/shares, (b) QR visibility, (c) OS Auto Backup if the user's device has it enabled.

## How deletion works

1. **Per-item deletion** exists for exercises and routines (with dependent-row cleanup).
2. **Full local wipe:** Home → *Trust, Safety & Legal* → *Data & Storage* → **Delete all local data** → destructive confirmation. This permanently destroys every row in every table, cancels scheduled notifications and clears runtime mirrors. Starter exercise presets re-seed on next launch (app content, not user data). Not a forensic secure-erase (F-11).
3. **Exports:** files you created live wherever you put them; the app cannot delete a copy you shared to another service.
