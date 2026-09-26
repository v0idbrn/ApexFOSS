# ApexFOSS Athlete Platform (Phase 2J)

**Status: maintained with the code (Phase 2J, 2026-09-25).** This document describes the athlete-facing surface added in Phase 2J: premium UX foundations, dashboard, workout UX, deterministic analytics, engine tooling, equipment inventory, substitutions, and notes — plus what is deliberately *not* claimed.

Governing decisions: `docs/DECISIONS.md` D-046 … D-049. Honest gaps: `docs/KNOWN_LIMITATIONS.md` #21, #23, #24, #25.

## Principles (Phase 2J)

1. **Pure math, thin screens.** Every calculation lives in pure modules (`src/analytics/*`, `src/engine/*`) over explicit inputs; screens fetch rows, call the function, render. All of it is Jest-testable with no device.
2. **Deterministic and explainable.** Same inputs → same outputs, always. Where a ranking or diagnostic exists, the UI shows *why* (reason labels, issue codes) — no black boxes (D-047).
3. **One design system.** Tokens + shared components only; the palette is frozen and pinned by `src/security/palette.test.ts` (D-046).
4. **Local-first unchanged.** Everything here runs offline; new data (inventory, notes) travels through the existing backup/restore machinery — no new persistence path.

## Surfaces

### Design system and motion (`src/theme`, `src/ui/components.tsx`, `src/ui/motion.tsx`)
- Theme tokens derived from the frozen palette (`#020101 … #B21F29`, D-032), consumed through NativeWind classes.
- Component kit: `Card` (tones), `Badge`, `MetricCard`, `ListRow`, `SectionHeader`, `Button`, `TextField`, `Progress`, `EmptyState` / `ErrorState` / `LoadingState`.
- Entrance motion: short fade + 8dp rise, interruptible, **disabled when the system reduce-motion setting is on**; no decorative loops, no new dependencies. Applied to the primary content area of every main screen (single wrap per screen, so branch switches do not re-trigger the fade).

### Athlete dashboard (`src/data/dashboard.ts`, HomeScreen)
- Today's planned session, weekly volume/time, streak, recent sessions, shortcuts to athlete tools; empty states when history is too short to summarize.

### Workout execution UX (`src/ui/screens/WorkoutScreen.tsx`, `src/workout/sessionProgress.ts`)
- Progress header (done/planned sets, block/round), rest-timer card with pause-aware remaining time, completion flash after a logged set.
- **Post-workout summary**: duration / sets / volume plus the session note field (see *Notes* below).

### Rolling analytics (`src/analytics/athlete.ts`, LoadScreen)
- 7- and 28-day rolling summaries (resistance volume, duration work, session counts) and a weekly **rhythm** chart; all arithmetic over logged rows.

### Personal records (`src/analytics/records.ts`, RecordsScreen)
- Best set and estimated 1RM (Epley) per exercise from completed logs, with the session that set it; safe against empty/one-rep histories.

### Session comparison (`src/analytics/compare.ts`, CompareScreen)
- Pick any two completed sessions → side-by-side deltas (total volume, sets, duration) and per-exercise matched rows; no baseline yet → explicit empty state.

### Routine preview and integrity (`src/engine/simulator.ts`, `src/engine/integrity.ts`, RoutinePreviewScreen)
- **Preview**: `definitionFromDraft` converts an in-progress editor draft into a definition and the simulator walks it block-by-block — per-exercise set counts, planned rest, truncation and empty states. Draft stays in memory; nothing is persisted by previewing.
- **Integrity checks** (advisory, shown in preview): `empty_routine`, `no_work_steps`, `invalid_rounds`, `missing_interval_spec`, `orphan_transition`, `transition_cycle`, `zero_target_sets`, `duplicate_step_id` — severities error/warning with block/step context. Cycle detection mirrors the frozen engine semantics (unbounded loops can only exist among non-last steps), so a "clean" result means the engine would actually terminate (see KNOWN_LIMITATIONS #24).

### Equipment inventory (`src/data/equipment.ts`, InventoryScreen, schema v4)
- The plates/pieces you own (name, weight, quantity, per-side) persist across sessions in `equipment_items`; the load-inventory solver reads the saved list.
- Validation is forgiving by design: non-positive weights / quantities below 1 are dropped, names fall back to the weight, and the UI re-syncs from the returned list so drops are visible.
- Included in `.apexbackup` (create → validate → restore round-trip covered by tests).

### Exercise substitutions (`src/analytics/substitutions.ts`, SubstitutionList, ExerciseEditor)
- Ranked alternatives for the exercise being edited, with matched reasons surfaced as badges.

| Signal | Weight | How it is derived |
|---|---|---|
| Movement pattern | 400 | documented keyword table over name + category (first match wins; `unknown` never scores) |
| Equipment class | 250 | barbell / dumbbell / kettlebell / cable / machine / band / bodyweight / other |
| Muscle overlap | 300 | shared basis-point contributions from the seeded muscle catalog (0–300 scale) |
| Category | 50 | exact category match |

- Score 0 → dropped; sort by score desc, then name asc, then id asc (fully deterministic); default top 5; self-matches excluded (D-047). Heuristic caveats: KNOWN_LIMITATIONS #23.

### Workout notes (schema v5, `src/data/notes.ts`)
- Session-level free text (trimmed, blank → `null`, capped at **2000 characters**).
- Written on the post-workout summary (saved best-effort when tapping Done — never blocks navigation) and edited from History → Session with an explicit Save + confirmation.
- Flows through `loadSessionDetail` → History detail, the history **JSON** export, and `.apexbackup` (`BackupSession.note`, optional — pre-v5 backups restore as `null`). The CSV schema is untouched (D-048).

## Data model additions

| Schema | Change | Migration |
|---|---|---|
| v4 | `equipment_items` table (name, weight_grams, quantity, per_side, timestamps) | new table; older installs start with an empty inventory |
| v5 | optional `workout_sessions.note` | `addColumns`; older rows read `null` |

Both are additive; old backups (without `equipmentItems` / `note`) still validate and restore.

## Testing and CI

- **673 Jest tests / 49 suites**, `tsc --noEmit` clean (engine, analytics, data, portability, export, security, UI screens).
- Light CI (`.github/workflows/ci.yml`, D-049): `npm ci` → typecheck → tests on every push/PR to `main`. No emulator or APK build in CI.
- **Device/visual validation (spec §28) was not performed in Phase 2J — the phase was executed without ADB per explicit instruction.** All UI claims above rest on component tests; treat visual behavior as needing validation on real hardware (KNOWN_LIMITATIONS #21). *Phase 2K later delivered a partial physical-device pass on a Samsung SM-A045M (Android 14) covering launch/routine/workout/resume flows; the analytics surfaces above (dashboard, training load, muscle distribution, PRs, compare) were **not** exercised on hardware from a real completed session — KNOWN_LIMITATIONS #21 lists the exact matrix.*
