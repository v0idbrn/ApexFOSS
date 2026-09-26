<p align="center">
  <img src="assets/icon.png" width="112" alt="ApexFOSS icon" />
</p>

<h1 align="center">ApexFOSS</h1>

<p align="center">
  <strong>A free, privacy-focused, offline-first training app for Android.</strong><br />
  Plan your training, run it with a real workout engine, and keep every rep — every byte — on your own device.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Android-3DDC84?logo=android&logoColor=white" alt="Platform: Android" />
  <img src="https://img.shields.io/badge/React_Native-0.83-61DAFB?logo=react&logoColor=black" alt="React Native 0.83" />
  <img src="https://img.shields.io/badge/Expo-SDK_55-000020?logo=expo&logoColor=white" alt="Expo SDK 55" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/tests-663%20%2F%2047%20suites-4ade80" alt="663 tests in 47 suites" />
</p>

<p align="center">
  <a href="README.es.md">Español</a> ·
  <a href="#features">Features</a> ·
  <a href="#privacy-by-design">Privacy</a> ·
  <a href="#installation">Install</a> ·
  <a href="#documentation">Docs</a>
</p>

---

## Why ApexFOSS

- **No accounts, no servers, no ads, no trackers.** Your training data lives in a local SQLite database on your phone — nothing is uploaded anywhere.
- **Works offline by design.** The whole app — planning, execution, timers, history, exports — runs without a network connection. The release build is compiled **without the INTERNET permission** (verified; see [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)).
- **A workout engine, not a UI toy.** Workout execution is a pure, deterministic engine with persistent timers that survive app restarts and process death.
- **A coherent interface.** One shared design system (tokens, components, reduced-motion-aware motion, honest empty states) instead of per-screen styling.
- **Honest documentation.** Known limitations, a written security audit, a data map, and draft legal documents are published next to the code — not marketing claims.

## Features

Everything below is implemented in the current codebase.

### Training programming
- Exercises, routines, blocks, steps, and set prescriptions with rounds and progression.
- Block types: **normal**, **superset**, **contrast**, **circuit**, and **interval** blocks.
- Transitions: **immediate**, **rest** (with timer), and **auto-advance**.
- Per-phase tempo notation (eccentric / pause bottom / concentric / pause top) and **RIR targets** per prescription.
- **Routine preview**: simulate a routine step by step (rounds, sets, planned rest) before running it.
- **Integrity checks**: flag empty routines, missing interval specs, orphan/circular transitions, and invalid rounds.

### Workout execution
- Persistent workout sessions with an immutable routine snapshot; execution state is saved after every action and **recovers automatically after the app is killed**.
- Set logging for weight, reps, duration, and distance, with an **athlete numpad** for fast one-handed input.
- **Undo last set**, skip set / skip rest, and immediate / rest / auto transitions.
- Rest and auto timers based on absolute expiry timestamps: they keep counting while the app is backgrounded and are restored from the database on relaunch.
- Rest-timer **notifications** as alerts — the database remains the source of truth.
- **Workout notes**: jot down how it went on the post-workout summary; edit it later from History (stored with the session).

### Interval & tempo training
- **Interval trainer** with HIIT, EMOM, and glycolytic interval modes (prep / work / rest phases, rounds, catch-up after interruption).
- **Tempo trainer** for paced reps with haptic phase cues.
- Keep-awake handling while a trainer is running.

### Athlete tools
- **Athlete dashboard**: today's session, weekly volume and time, streak, and quick access to the tools below.
- **Training load** view plus **load trends** (7- and 28-day comparisons of volume and sessions) and a **weekly rhythm** chart.
- **Muscle distribution** map across the major muscle groups.
- **Readiness tap test** (10-second tap count, stored locally).
- **RIR autoregulation**: deterministic next-set load recommendations from target vs. actual RIR.
- **Load inventory**: tell it the plates you own and it solves — or rejects — a target barbell load. The inventory **persists** between sessions.
- **Personal records**: best sets and estimated 1RM per exercise, tracked from your logged history.
- **Session comparison**: pick two sessions and see volume, sets, and per-exercise load side by side.
- **Exercise substitutions**: ranked alternatives for the current exercise, with the matched reasons shown (movement pattern, equipment, muscles) — transparent heuristics, no black box.

### Data portability
- **CSV export** of training history (spreadsheet-safe).
- **Routine sharing** as portable JSON (`.apexroutine`), via share sheet or **QR code**, with deep links on the `apexfoss://` scheme.
- **Full offline backup** (`.apexbackup`, versioned schema) with validation and **atomic restore with rollback** — a failed restore leaves your data intact.
- In-app **Trust, Safety & Legal** center: privacy summary, terms, health boundary, local data counts, and a complete local wipe.

## Privacy by design

- **Local-first storage.** All app data (exercises, routines, sessions, set logs, readiness tests) stays in a local SQLite database (WatermelonDB) on your device.
- **No account, no backend, no analytics, no telemetry.** The project operates no servers and sends no app data anywhere.
- **You control your data.** Export everything as CSV or JSON, share routines deliberately, or delete everything from inside the app.
- **Exports leave your device by your action only** — a file you export can be shared, so treat exports with care.

Full details: [docs/PRIVACY.md](docs/PRIVACY.md) · data inventory: [docs/DATA_MAP.md](docs/DATA_MAP.md)

## Security & trust

Security is treated as an engineering concern, **not a guarantee**. Current state:

- The release build ships **without the INTERNET permission** and is not debuggable (verified with `aapt`/`apksigner`; see [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)).
- Import boundaries: size caps and schema validation on routine/backup imports; CSV exports are guarded against spreadsheet formula injection.
- Local data deletion covers every app record, with confirmation before wiping.
- Known gaps are documented rather than hidden: [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

Report vulnerabilities per [SECURITY.md](SECURITY.md). Component licenses: [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md).

## Health & fitness

ApexFOSS provides **general fitness and training organization tools**. It is not a medical device and does not provide medical advice, diagnosis, or treatment, and it does not predict or prevent injuries. See [docs/HEALTH_AND_FITNESS.md](docs/HEALTH_AND_FITNESS.md).

## Architecture

```
UI (React Native / NativeWind)
  → application state (Zustand, visual mirror only)
    → workout execution engine (pure TypeScript)
      → domain actions (WatermelonDB models / writer)
        → SQLite (local source of truth)
```

- **Programming vs. execution are separated.** Routines are authored data; starting a workout snapshots the routine into the session.
- The engine is a pure function: `(definition, cursor, event) → { cursor', effects[] }`. The UI never interprets transitions itself.
- Execution truth lives in `cursor_json` (including the timer's absolute `expiresAt`); `session_status` / `timer_expires_at` are derived caches only.
- Notifications are alerts, not state: timers are recovered from the database, never from in-memory UI state.

## Installation

ApexFOSS is **not published on any app store** yet (no Play Store, no F-Droid, no pre-built release downloads). The way to install it is to build the APK yourself. Distribution considerations are tracked in [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).

### Users (build your own APK)

Requirements: Node.js with npm, a JDK (17 or newer), and an Android SDK.

```bash
git clone https://github.com/v0idbrn/ApexFOSS.git
cd ApexFOSS
npm install
npm run prebuild        # regenerate android/ from app.json + plugins (CNG)
npm run build:apk       # release APK → android/app/build/outputs/apk/release/
adb install android/app/build/outputs/apk/release/app-release.apk
```

### Developers

```bash
npm install
npm run prebuild        # android/ is generated, not hand-maintained
npm run start           # Metro dev server (dev client)
npm run android         # build & run on a connected device or emulator
npm test                # Jest test suite
npm run typecheck       # tsc --noEmit
```

`npm run android` requires a connected device or emulator.

### Release signing

The repository contains no secrets. Release signing is injected at prebuild time by a config plugin (`plugins/withApexSigning.js`) that reads `~/.apexfoss/apexfoss-signing.properties` (keys: `storeFile`, `storePassword`, `keyAlias`, `keyPassword`) pointing to a keystore stored **outside the repository**. `npm run prebuild` fails fast when that file is missing, so create your own keystore and properties file first if you want to produce a release APK.

## Testing

```bash
npm test                # 663 tests across 47 suites — engine, persistence, timers,
                        # migrations, analytics, portability, export, security, UI
npm run typecheck       # TypeScript passes with no errors
```

- Debug and release APKs build locally (`npm run build:apk`), and the release APK's permission set has been audited (see [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)).
- GitHub Actions CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs typecheck + tests on every push and pull request to `main`.
- The suite runs on Jest with no device attached. **Systematic physical-device testing has not yet been done** — treat device behaviour as needing validation on your own hardware.

## Project status

- **Version:** 0.1.0 (pre-release), Android only, local database schema version 5.
- **Quality gates:** 663 Jest tests / 47 suites pass; TypeScript type-check passes; debug and release APKs build locally; release signing verified.
- **Distribution:** no store or channel submissions have been made.
- **Legal:** privacy, health-boundary, and terms documents exist in [docs/](docs/) — terms are a **draft pending legal review**.
- **License:** not yet declared (see below).

## Roadmap

**Implemented** — everything listed under [Features](#features).

**Needed before a public release** — resolve the license decision (D-038), complete legal review of the draft terms, physical-device validation, store/channel preparation per [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md), and the outstanding items in [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

**Not currently planned** — iOS, Health Connect, wearable integrations, cloud sync or accounts, AI features, social features, camera-based input, and in-app analytics.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/PRIVACY.md](docs/PRIVACY.md) | Full privacy policy |
| [docs/DATA_MAP.md](docs/DATA_MAP.md) | Exact inventory of data collected and stored |
| [docs/HEALTH_AND_FITNESS.md](docs/HEALTH_AND_FITNESS.md) | Health & fitness boundary |
| [docs/TERMS_OF_USE.md](docs/TERMS_OF_USE.md) | Terms of use (draft, pending legal review) |
| [SECURITY.md](SECURITY.md) | How to report vulnerabilities |
| [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) | Security audit findings and release-APK verification |
| [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) | Honest list of known gaps |
| [docs/ATHLETE_PLATFORM.md](docs/ATHLETE_PLATFORM.md) | Phase 2J athlete-platform surface (dashboard, analytics, engine tools) |
| [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) | Distribution channels, blockers, and requirements |
| [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md) | Third-party component licenses |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture and product decision log |

## Contributing

Issues and pull requests are welcome. Before submitting:

- Run `npm test` and `npm run typecheck` and keep both green.
- Preserve the architecture: the engine stays pure, WatermelonDB stays the source of truth, and nothing new phones home.
- Never commit secrets, signing keys, local SDK paths, or build artifacts.
- Report security issues privately via [SECURITY.md](SECURITY.md), not in public issues.

## License

**The license is pending a project-owner decision (D-038).** No `LICENSE` file exists yet, so the source code is visible but not yet licensed for reuse — do not assume MIT, Apache-2.0, or any other terms. Third-party dependency licenses are listed in [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md); the decision log is in [docs/DECISIONS.md](docs/DECISIONS.md).

## Disclaimer

ApexFOSS is general fitness software, not medical software. It is provided "as is", without warranty of any kind. See [docs/HEALTH_AND_FITNESS.md](docs/HEALTH_AND_FITNESS.md) and [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).
