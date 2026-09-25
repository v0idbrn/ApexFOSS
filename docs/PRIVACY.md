# ApexFOSS Privacy Notice

**Status: draft — requires human/legal review before public distribution.**
**Last updated: 2026-09-25 (Phase 2G).**

This notice describes how the ApexFOSS Android application handles information. It is written to be accurate about what the software actually does; where something depends on the user's device or choices, that is stated explicitly.

## Short version

ApexFOSS is a **local-first** application. It has **no user accounts, no project-operated servers, no analytics, no advertising, no telemetry and no subscriptions**. Your workouts, routines, history and settings are stored **on your device**. They leave the device only when **you** export or share them, or — depending on your device settings — when your **operating system's backup feature** copies app data to your cloud backup provider.

"Local-first" is a description of the architecture, not a claim of zero data processing: see [Who processes what](#who-processes-what).

## What the app stores

See `docs/DATA_MAP.md` for the complete table. In summary:

- Exercise definitions and routines you create
- Workout sessions, set logs, rest-timer state and readiness tests
- App preferences and in-progress state (e.g. an active session cursor)
- Notification scheduling state (rest timers) managed by the operating system

The database is a local SQLite file inside the app's private storage. It is protected by your device's full-disk/file encryption and your lock screen. The database itself is **not** additionally encrypted by the app (documented limitation, `docs/KNOWN_LIMITATIONS.md`).

## What the app does NOT collect

The project does not collect, transmit or sell:

- Personal identifiers (no name, email, phone, account, advertising ID use)
- Health records from other services (no Health Connect, no wearables, no heart-rate/sleep/GPS data)
- Usage analytics, crash reports or diagnostics
- Device inventory beyond what Android requires to install an APK
- Passwords or payment data (the app has no accounts or payments)

## Who processes what

| Channel | What | Who processes it | When |
|---|---|---|---|
| Local storage | Entire database | Your device only | Always |
| App export (share intent) | Files you choose to export | Any app you share them with (e.g. your file manager, messaging app, cloud drive) | Only when you tap export and pick a target |
| QR code display | Encodeable routine data | Anyone who can see or photograph the screen (QR is integrity-protected, **not encrypted** — treat it as visible data) | Only when you open the QR screen |
| OS Auto Backup (if enabled on your device) | App data, potentially including the database | Your device vendor's / Google's backup transport for your account | Automatic, per your device settings; `allowBackup=true` is set in the app manifest (decision D-034) |
| Play Store / F-Droid / GitHub distribution | The APK itself | The distribution platform you install from | Install time |
| Push notifications | **None** — the app never registers for push; notifications are scheduled locally | n/a | n/a |
| Network calls by the app | **None** — the release build does not even hold the INTERNET permission (verified in `docs/SECURITY_AUDIT.md`) | n/a | n/a |

## Permissions (plain language)

- **Post notifications** — to alert you when a rest timer ends (requested only when you start using timers).
- **Vibrate** — rest-timer haptics.
- **Run at boot (receive boot completed)** — re-schedule pending rest notifications after a reboot.
- **Storage (Android 12 and below only)** — legacy share/export flows on older systems; not used on Android 13+.
- **Display over other apps** — inherited from the React Native toolchain; the app never requests it at runtime (kept pending device verification; see security audit).
- **Internet (debug builds only)** — to talk to the development server while developing. Release builds do not have it.

## Children

The app is general fitness software. It is not directed at children, and it does not knowingly collect any data from anyone, including children. Because it collects nothing, there is no children's data handling to describe beyond this statement.

## Changes

If this notice changes, the updated version will be committed to the repository alongside the change that caused it. The version history of this file is the record of changes.

## Contact

There is no support email or contact form at this time. The project is developed in public: use the repository's issue tracker for questions, and the process in `SECURITY.md` for security reports. **No contact identity is invented here on purpose — the project owner should insert a reviewed contact channel before distribution.**
