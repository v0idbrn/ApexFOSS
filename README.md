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
  <img src="https://img.shields.io/badge/tests-1227%20%2F%2093%20suites-4ade80" alt="1227 tests in 93 suites" />
</p>

<p align="center">
  <a href="README.es.md">Español</a> ·
  <a href="#features">Features</a> ·
  <a href="#privacy-by-design">Privacy</a> ·
  <a href="#installation">Install</a> ·
  <a href="#support-apexfoss">Support</a> ·
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
- **Local file import** of `.apexroutine` and `.apexbackup` files via system file picker (Phase 5A).
- **Enhanced import review** showing matched/unmatched exercises, checksum validation, and schema/version conflicts before confirmation (Phase 5B).
- **Inbound share intents** — open `.apexroutine` or `.apexbackup` from any file manager or share sheet directly into the import/restore flow (Phase 5C).
- **Training reports** with period selector (7d/28d/all), volume, PRs/e1RM, adherence, body metrics, goals, and trends, exportable as CSV (Phase 5D).
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

ApexFOSS is **not on any app store yet** (no Play Store, no F-Droid). It **is** published as a signed APK on [GitHub Releases](https://github.com/v0idbrn/ApexFOSS/releases) (v1.1.0, pre-release while device validation is pending) — see [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md). Status: release candidate — preparing for Google Play (internal testing first) and F-Droid submission preparation; track readiness in [docs/DISTRIBUTION_MATRIX.md](docs/DISTRIBUTION_MATRIX.md).

- **Recommended:** install `app-release.apk` from the [v1.1.0 GitHub Release](https://github.com/v0idbrn/ApexFOSS/releases/tag/v1.1.0), by opening it on your Android device. One universal APK for ARM (`arm64-v8a` + `armeabi-v7a`), requiring **Android 7.0+** (minSdk 24, targetSdk 36). `x86`/`x86_64` (emulator-oriented) are not part of the current compatibility target.
- **Updates via Obtainium (optional):** add `https://github.com/v0idbrn/ApexFOSS` as a GitHub source in Obtainium (enable “include prereleases” for the 1.1.0 line). Do not mix with a future F-Droid build — different signers require reinstalling to switch.
- **Building from source** is optional and documented for developers in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
- **Validation status:** the 1.1.0 build is release-built with automated tests passing; final physical-device validation and friend testing are still pending — see [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) #21. An earlier partial device pass (Phase 2K, Samsung SM-A045M, Android 14) is historical evidence, not final validation.

## Testing

```bash
npm test                # 1227 tests across 93 suites — engine, persistence, timers,
                        # migrations, analytics, portability, export, security, UI
npm run typecheck       # TypeScript passes with no errors
```

- Debug and release APKs build locally (`npm run build:apk`), and the release APK's permission set has been audited (see [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)).
- GitHub Actions CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs typecheck + tests on every push and pull request to `main`.
- The suite runs on Jest with no device attached. **Physical validation is pending for 1.1.0**: the final build still needs an on-device smoke pass and real-world friend testing. A partial historical device pass (Phase 2K, Samsung SM-A045M, Android 14) covered install/launch, Home, routine authoring → preview/integrity, workout launch, session resume with timer catch-up, and cold-restart persistence; the rest of the matrix — full timer pause/resume, completed-session flows, Trust Center, EN/ES — was **not** exercised on hardware; see [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) #21.

## Project status

Current state, in precise terms:

- **Implemented:** everything listed under [Features](#features).
- **Tested:** 1227 Jest tests / 93 suites pass; TypeScript type-check passes; CI runs both on every push.
- **Release-built:** debug and release APKs build locally; the signed 1.1.0 release APK is built and verified (package `com.apexfoss.app`, versionCode 3, no INTERNET permission, not debuggable).
- **Physically validated:** partial historical pass only (Phase 2K); **device validation for 1.1.0 and friend testing pending**.
- **Published:** no — no store, channel, or GitHub Release submission has been made.

- **Version:** 1.1.0 (unreleased), Android only, local database schema version 13.
- **Distribution:** prepared, not submitted ([docs/DISTRIBUTION.md](docs/DISTRIBUTION.md)).
- **Legal:** privacy, health-boundary, and terms documents exist in [docs/](docs/) — terms are a **draft pending legal review**.
- **License:** GPL-3.0-or-later (see below).

## Roadmap

**Implemented** — everything listed under [Features](#features).

**Before public release** — final physical-device validation on the owner's device, several days of friend testing and fixes, legal review of the draft terms, then store/channel publication per [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md). Remaining known gaps: [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

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
| [docs/DISTRIBUTION_PLAYSTORE.md](docs/DISTRIBUTION_PLAYSTORE.md) | Google Play readiness: technical, listing, Data Safety, AAB |
| [docs/DISTRIBUTION_FDROID.md](docs/DISTRIBUTION_FDROID.md) | F-Droid readiness: source build, dependencies, AntiFeatures |
| [docs/DISTRIBUTION_MATRIX.md](docs/DISTRIBUTION_MATRIX.md) | Cross-channel requirement status table |
| [docs/STORE_ASSETS.md](docs/STORE_ASSETS.md) | Store graphics checklist (no fabricated assets) |
| [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md) | Third-party component licenses |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture and product decision log |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Developer setup, builds, and release checklist |

## Support ApexFOSS

ApexFOSS is free and open-source. If you find it useful, you can support its continued development through [GitHub Sponsors](https://github.com/sponsors/v0idbrn), [PayPal](https://paypal.me/amelie615), or [Mercado Pago](https://link.mercadopago.com.ar/openv0id).

Support is entirely voluntary — the app has no paywall, no subscription, no ads, and works fully offline without ever contributing anything.

## Contributing

Issues and pull requests are welcome. Before submitting:

- Run `npm test` and `npm run typecheck` and keep both green.
- Preserve the architecture: the engine stays pure, WatermelonDB stays the source of truth, and nothing new phones home.
- Never commit secrets, signing keys, local SDK paths, or build artifacts.
- Report security issues privately via [SECURITY.md](SECURITY.md), not in public issues.

## License

ApexFOSS is licensed under the **GNU General Public License v3.0 or later** (GPL-3.0-or-later). The full text is in [LICENSE](LICENSE). In short: you may use, study, share, and modify this software, and derivative works must remain free software under the same license. Third-party dependency licenses are listed in [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md); the decision record is in [docs/DECISIONS.md](docs/DECISIONS.md).

## Disclaimer

ApexFOSS is general fitness software, not medical software. It is provided "as is", without warranty of any kind. See [docs/HEALTH_AND_FITNESS.md](docs/HEALTH_AND_FITNESS.md) and [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).
