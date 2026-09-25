# Changelog

Notable changes to ApexFOSS. Versions follow a simple pre-1.0 convention; a date appears only when a version is actually tagged and released. The project follows nothing beyond this file — planned work lives in `docs/DECISIONS.md` and `docs/DISTRIBUTION.md`, not here.

## 0.1.0 — unreleased

First audited snapshot of ApexFOSS: an **Android-only, local-first workout application**. No store, channel, or GitHub Release submission has been made; this entry describes what the codebase contains, not a published artifact.

### Training programming
- Exercise library (name, category, equipment, metric flags) with starter presets.
- Routine editor: blocks (**normal, superset, contrast, circuit, interval**), steps, set prescriptions, rounds, and block transitions (**immediate, rest, auto-advance**).
- Per-phase tempo notation (eccentric / pause bottom / concentric / pause top) and **RIR targets** per prescription.
- Interval programming with **HIIT, EMOM, and glycolytic** modes.

### Workout execution
- Pure, deterministic TypeScript execution engine: `(definition, cursor, event) → { cursor', effects[] }`.
- Persistent sessions with an immutable routine snapshot; execution state written after every action and **recovered after process death**.
- Set logging for weight, reps, duration, and distance with an **athlete numpad**; **undo last set**, skip set / skip rest.
- Rest and auto timers based on **absolute expiry timestamps** — they keep running while backgrounded and are restored from the database, never from UI state.
- Local rest-timer **notifications** (fixed template text, no sensitive content) as advisory alerts; the database remains the source of truth.

### Interval and tempo training
- **Interval trainer** with prep/work/rest phases, rounds, and deterministic catch-up after interruption.
- **Tempo trainer** for paced reps with haptic phase cues.
- Keep-awake held only while a trainer is active.

### Athlete tools and analytics
- **Training load** view with **7- and 28-day trends** (volume and session counts).
- **Muscle distribution** map across major muscle groups.
- **Readiness tap test** (10-second tap count, stored locally).
- **RIR autoregulation**: deterministic next-set load recommendations from target vs. actual RIR.
- **Load inventory solver**: computes (or rejects) a target barbell load from the plates you own.
- Workout history list and detail views.

### Portability and data
- **CSV export** of training history with spreadsheet formula-injection guarding.
- **Routine sharing** as portable JSON (`.apexroutine`) via share sheet, **QR code**, and `apexfoss://` deep links (transport only — validate → preview → confirm).
- **Full offline backup** (`.apexbackup`, versioned schema) with checksum, structural validation, **atomic restore with compensating rollback**, and byte-size ceilings on all imports.
- **Trust, Safety & Legal** center: local data counts, privacy/terms/health/security/limitation summaries, and a complete **local data wipe** with destructive confirmation (logical deletion, not forensic erasure).

### Privacy, security, and legal posture
- No accounts, no servers, no analytics, no telemetry, no ads, no subscriptions.
- **Release build ships without the INTERNET permission** (manifest-merger removal, verified on the built APK); debug builds keep it for Metro.
- Local-first storage in WatermelonDB over SQLite (app-private, not additionally encrypted beyond device encryption — documented limitation).
- Published documentation: privacy notice, data map, health & fitness scope, draft terms of use, security policy, security audit, known limitations, distribution plan, third-party licenses, decision log. Legal documents are **drafts pending review**; the **license is undecided** (D-038).

### Platform and build
- Android only: `com.apexfoss.app`, minSdk 24, targetSdk 36, ABIs `arm64-v8a` + `armeabi-v7a`, versionCode 1.
- Expo SDK 55 / React Native 0.83.10 / TypeScript 5.9 / WatermelonDB 0.28 (JSI) / NativeWind 4; database **schema v3** with additive migrations (v1 → v2 → v3).
- CNG build (`expo prebuild`) with in-repo config plugins; release signing injected from a keystore kept **outside** the repository.
- Test suite: **480 Jest tests across 29 suites** plus a clean `tsc --noEmit`.

### Not included (by design)
iOS, Health Connect, wearables, cloud sync, accounts, social features, AI coaching, camera/video analysis, ads and analytics. See `docs/KNOWN_LIMITATIONS.md` for the full honest list.
