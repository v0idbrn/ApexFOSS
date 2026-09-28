# Changelog

Notable changes to ApexFOSS. Versions follow a simple pre-1.0 convention; a date appears only when a version is actually tagged and released. The project follows nothing beyond this file — planned work lives in `docs/DECISIONS.md` and `docs/DISTRIBUTION.md`, not here.

## 1.0.0 — unreleased

Product-completion and release-hardening pass on top of the 0.1.0 snapshot: training intelligence, program planning, portability, reports, and the final hardening fixes. No store, channel, or GitHub Release submission has been made; this entry describes what the codebase contains, not a published artifact.

### Training intelligence (Phase 3)
- **Deterministic progression engine** (Phase 3A): comparable-session evidence, upper-bound classification, and opportunity signals with no invented increments — suggested next loads come only from real data (equipment inventory solver) or are withheld with `weightIncrementSource: 'none'`.
- **Adaptive execution** (Phase 3C), **session adherence analytics**, and **performance trend / plateau signals** (Phase 3D).

### Program planning (Phase 4)
- **Program structure** (4A), **mesocycle phases** (4B), **flexible next-up scheduling** (4C), and **strength goals with derived progress** (4D).
- **Body weight and waist logging** (4E), extended in 1.0.0 to a **general body-metrics model (schema v12)**: `measurement_type` / `side` / `value` / `unit` with legacy `weight_grams`/`waist_mm` preserved, bilateral measurements (left/right), per-identity latest values and deltas, i18n labels (EN/ES), and backup/export compatibility both ways (v11 backups restore, v12 backups normalize on export).
- **Routine templates** (4F): structure-only skeletons (exercise slots, no invented prescriptions) resolved against the local library.

### Portability and reports (Phase 5)
- **Local file import** (5A), **improved import review** (5B), **inbound portability files** (5C): checksum/version/conflict review before confirm, with per-routine export selection when multiple routines exist.
- **Training reports** (5D): period-scoped report (volume, adherence, e1RM trends, PRs, goals) with CSV export bounded to the same period; the analytics layer is a pure `buildReport` function and DB loading lives in the data layer.

### Hardening fixes (1.0.0)
- **Full local wipe now covers every training table**: programs, mesocycles, routine content, goals, body metrics, and equipment inventory are deleted alongside sessions and analytics (app settings locale preserved by design).
- **Exercise deletion guard**: exercises referenced by routine steps can no longer be deleted silently — the previously unreachable "in use" confirmation is wired up.
- **Report correctness**: wall-clock duration from session timestamps, real planned/performed/skipped/modified adherence (no fabricated execution type), per-exercise volume no longer double-filtered, average set counts over completed sets.
- Version references aligned to **1.0.0** (`versionCode` 2, database **schema v12**, backup `appVersion`, Trust Center about strings).
- Test suite: **1131 Jest tests across 85 suites** plus a clean `tsc --noEmit`, with light CI on `main`.

## 0.1.0 — unreleased

First audited snapshot of ApexFOSS: an **Android-only, local-first workout application**. No store, channel, or GitHub Release submission has been made; this entry describes what the codebase contains, not a published artifact.

### Training programming
- Exercise library (name, category, equipment, metric flags) with starter presets.
- Routine editor: blocks (**normal, superset, contrast, circuit, interval**), steps, set prescriptions, rounds, and block transitions (**immediate, rest, auto-advance**).
- Per-phase tempo notation (eccentric / pause bottom / concentric / pause top) and **RIR targets** per prescription.
- Interval programming with **HIIT, EMOM, and glycolytic** modes.
- **Routine preview**: deterministic simulation of rounds, sets, and planned rest before a routine is ever run.
- **Routine integrity checks**: advisory diagnostics for empty routines, invalid rounds, missing interval specs, orphan/circular transitions, duplicate step ids, and zero target sets.

### Workout execution
- Pure, deterministic TypeScript execution engine: `(definition, cursor, event) → { cursor', effects[] }`.
- Persistent sessions with an immutable routine snapshot; execution state written after every action and **recovered after process death**.
- Set logging for weight, reps, duration, and distance with an **athlete numpad**; **undo last set**, skip set / skip rest.
- Rest and auto timers based on **absolute expiry timestamps** — they keep running while backgrounded and are restored from the database, never from UI state.
- Local rest-timer **notifications** (fixed template text, no sensitive content) as advisory alerts; the database remains the source of truth.
- **Post-workout session notes** (schema v5): written on the summary screen, editable later from History, included in backups and the history JSON export.

### Interval and tempo training
- **Interval trainer** with prep/work/rest phases, rounds, and deterministic catch-up after interruption.
- **Tempo trainer** for paced reps with haptic phase cues.
- Keep-awake held only while a trainer is active.

### Athlete tools and analytics
- **Athlete dashboard**: today's session, weekly volume/time, streak, recent sessions, and athlete-tool shortcuts.
- **Training load** view with **7- and 28-day trends** (volume and session counts) and a weekly **rhythm** chart.
- **Muscle distribution** map across major muscle groups.
- **Readiness tap test** (10-second tap count, stored locally).
- **RIR autoregulation**: deterministic next-set load recommendations from target vs. actual RIR.
- **Load inventory solver**: computes (or rejects) a target barbell load from the plates you own; the inventory **persists** (schema v4 `equipment_items`) and travels in backups.
- **Personal records**: best sets and estimated 1RM per exercise, derived from logged history.
- **Session comparison**: side-by-side volume/sets/per-exercise load between two sessions.
- **Exercise substitutions**: deterministic ranking (movement pattern, equipment class, muscle overlap, category) with the matched reasons surfaced — weights documented in `src/analytics/substitutions.ts`.
- Workout history list and detail views (with session notes).

### Interface and quality
- **Shared design system**: palette-constrained theme tokens, cards, badges, metric cards, list rows, empty/error/loading states — screens stopped styling ad hoc.
- **Reduce-motion-aware entrance motion** (`src/ui/motion.tsx`) applied consistently to primary content areas; no decorative loops, no new dependencies.
- **Standardized empty states** across data screens (and equipment/muscle/load placeholders).
- **Light CI**: GitHub Actions runs `tsc --noEmit` + Jest on every push/PR to `main`.

### Portability and data
- **CSV export** of training history with spreadsheet formula-injection guarding.
- **Routine sharing** as portable JSON (`.apexroutine`) via share sheet, **QR code**, and `apexfoss://` deep links (transport only — validate → preview → confirm).
- **Full offline backup** (`.apexbackup`, versioned schema) with checksum, structural validation, **atomic restore with compensating rollback**, and byte-size ceilings on all imports — including the equipment inventory (v4) and session notes (v5).
- **Trust, Safety & Legal** center: local data counts, privacy/terms/health/security/limitation summaries, and a complete **local data wipe** with destructive confirmation (logical deletion, not forensic erasure).

### Privacy, security, and legal posture
- No accounts, no servers, no analytics, no telemetry, no ads, no subscriptions.
- **Release build ships without the INTERNET permission** (manifest-merger removal, verified on the built APK); debug builds keep it for Metro.
- Local-first storage in WatermelonDB over SQLite (app-private, not additionally encrypted beyond device encryption — documented limitation).
- Published documentation: privacy notice, data map, health & fitness scope, draft terms of use, security policy, security audit, known limitations, distribution plan, third-party licenses, decision log. Legal documents are **drafts pending review**; the **license is undecided** (D-038).

### Platform and build
- Android only: `com.apexfoss.app`, minSdk 24, targetSdk 36, ABIs `arm64-v8a` + `armeabi-v7a`, versionCode 1.
- Expo SDK 55 / React Native 0.83.10 / TypeScript 5.9 / WatermelonDB 0.28 (JSI) / NativeWind 4; database **schema v5** with additive migrations (v1 → v2 → v3 → v4 → v5).
- CNG build (`expo prebuild`) with in-repo config plugins; release signing injected from a keystore kept **outside** the repository.
- Test suite: **673 Jest tests across 49 suites** plus a clean `tsc --noEmit`, with light CI on `main`.

### Physical device validation (Phase 2K)
- **First on-device validation pass**: the universal release APK was installed and exercised on a Samsung SM-A045M (Android 14 / API 34, `arm64-v8a`) — install/launch, Home rendering/scrolling, routine authoring → preview/integrity ("No problems found."), workout launch (progress header, target/actual, athlete numpad, action controls), active-session resume with timer catch-up, notification permission prompt, and cold-restart data persistence were verified on hardware. The rest of the validation matrix (full timer pause/resume, completed-session flows, Trust Center, full EN/ES pass, post-fix smoke) remains unvalidated — `docs/KNOWN_LIMITATIONS.md` #21.
- **Universal APK boundary confirmed on the built artifact**: one `SINGLE` release APK, 18 native `.so` per ABI with identical `arm64-v8a`/`armeabi-v7a` sets, no `x86`/`x86_64`, `SINGLE` output, v2 signature (signer `CN=ApexFOSS`), no INTERNET permission, not debuggable (`docs/KNOWN_LIMITATIONS.md` #26).
- **UI hardening with regression tests**: removed duplicated Home empty-state copy, canonicalized workout/numpad unit labels (no more `Weight (kg) (kg)` / `Duration (s) (s)` on the athlete numpad), plus a source-scan guard test that fails if unit-suffix duplication reappears in `src/ui`.

### Phase 2L — Premium UX/UI transformation (completed)

- Five‑tab bottom‑navigation shell (Home, Routines, Train, Progress, More) with per‑tab stacks and immersive‑route exemption
- Redesigned HomeScreen: hero/dashboard, weekly metrics, progress snapshot, quick tools
- Redesigned RoutinesListScreen: cards with integrity/duplicate badges, preview/start/edit/delete actions
- Redesigned TrainScreen: active‑session flow, session recap, recent routines
- Redesigned ProgressScreen: weekly metrics, History, Records, Load, Muscle, Compare galleries
- RecordsScreen: kilogram values rounded and grouped (one decimal precision), Epley 1RM formatting fix
- i18n EN/ES: 497‑key dictionary with persisted language setting, grammar‑safe pluralization
- Volume audit: calculation correct; UX/terminology improvement recommendation documented
- Accessibility sweep: empty‑state actions, labeling, `accessibilityRole="header"` on SectionHeader, a11y on History/Records/Compare/Muscle/Load
- Portability bottom‑back navigation fix (pop instead of pushing Home onto More stack)
- Locale facade synchronization (device locale overrides strings facade)
- Spanish About/legal label correction (`'Acerca de la app y legal'`)
- Design‑system semantic color tokens
- Test suite expanded from 673 / 49 to 825 / 58 green (typecheck exit 0)

### Not included (by design)
iOS, Health Connect, wearables, cloud sync, accounts, social features, AI coaching, camera/video analysis, ads and analytics. See `docs/KNOWN_LIMITATIONS.md` for the full honest list.
