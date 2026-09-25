# ApexFOSS

> The Linux of fitness apps. A declarative workout execution engine — offline-first, local-first, open source, no accounts, no paywalls.

**MVP deadline: Monday 2026-09-28 (Android APK).**

## Stack (frozen)

- React Native + **Expo SDK 55** (CNG — no Expo Go) · TypeScript
- **WatermelonDB 0.28.x** over SQLite (JSI) — local source of truth
- Zustand — ephemeral/visual state only
- NativeWind (dark AMOLED) · expo-notifications · Jest
- Build: local Gradle (`assembleRelease`), EAS as fallback

## Architecture

```
UI → Application Layer (zustand mirror) → Workout Execution Engine (pure TS)
   → Domain (WatermelonDB models + writer actions) → SQLite
```

- **Source of truth:** `workout_sessions.definition_json` (immutable routine snapshot) + `cursor_json` (canonical execution state incl. timer).
- `session_status` / `timer_expires_at` are derived caches only; on any divergence `cursor_json` wins.
- The engine is pure: `(definition, cursor, event) → { cursor', effects[] }`. The UI never interprets transitions.
- Timer truth: `cursor_json.timer.expiresAt`. Persisted; restored from DB, never from Zustand.

## Commands

```bash
npm install
npm run prebuild        # CNG: generate android/ from app.json + plugins
npm run android         # dev build on device/emulator
npm test                # Jest (engine, persistence, timer, integration)
npm run build:apk       # assembleRelease → android/app/build/outputs/apk/release/
```

## Repository layout

```
src/
  constants/strings.ts   # every user-visible string lives here
  data/                  # WatermelonDB: schema, models, actions, seed
  domain/                # types + snapshot serializer
  engine/                # pure workout execution engine (no React/DB)
  state/                 # zustand stores (visual mirror only)
  ui/                    # screens + components (NativeWind)
  utils/                 # units (grams/ms/mm), dates, csv
.tooling/                # local JDK + Android SDK (gitignored, never commit)
```

## MVP scope

NORMAL / SUPERSET / CONTRAST-PAP blocks · transitions (IMMEDIATE / REST / AUTO_ADVANCE) · persistent timer surviving process death · set logging (grams/ms/mm integers) · history · CSV export. Cut list: backup, cloud, heatmap, EMOM, analytics — see `docs/PLAN.md`.

## Security, privacy & legal (Phase 2G)

- `SECURITY.md` — how to report vulnerabilities; `docs/SECURITY_AUDIT.md` — full audit + release-APK verification (the release build holds **no INTERNET permission**).
- `docs/PRIVACY.md` + `docs/DATA_MAP.md` — local-first data handling: no accounts, no servers, no analytics, no telemetry.
- `docs/HEALTH_AND_FITNESS.md` — product boundary (general fitness software, **not** medical software).
- `docs/TERMS_OF_USE.md` — **draft, pending legal review**; `docs/DISTRIBUTION.md` — channel notes (no submissions made); `docs/KNOWN_LIMITATIONS.md` — honest limits; `docs/THIRD_PARTY_LICENSES.md` — component licenses.
- **License status:** no `LICENSE` file is declared yet — the "open source" tagline states intent, not a grant; see `docs/KNOWN_LIMITATIONS.md`.
- In-app: Home → **Trust, Safety & Legal** (privacy, terms, health boundary, data counts + full local wipe).
