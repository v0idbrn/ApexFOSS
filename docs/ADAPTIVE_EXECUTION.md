# Adaptive Execution (Phase 3C)

Records what the athlete **actually did** without ever rewriting what the
program **asked for**. Prescription lives frozen in `definition_json`;
performance lives in `set_logs`. Two nullable `set_logs` columns (schema v7)
carry the relationship between them.

## Model: three layers, never merged

| Layer | Source | Example |
|---|---|---|
| Prescription (programmed) | `definition_json` steps, immutable snapshot | `60 kg × 10` |
| Actual (performed) | `set_logs` value columns | `55 kg × 10` |
| Execution metadata | `set_logs.execution_type` + `override_reason` | `modified` + `load_reduced` |

`definition_json` is never mutated by execution. `set_logs` value columns
always hold actuals — including for unmodified sets.

## Execution types (closed vocabulary)

`normal` · `modified` · `extra` · `drop` · `skipped`

- `normal` — actual matches prescription (compared on weight/reps/duration/RIR;
  reps match anywhere inside a prescribed range).
- `modified` — at least one of weight/reps/duration/RIR differs. Computed
  deterministically at write time by `classifySetExecution()`; never inferred
  from UI state.
- `extra` — set beyond the prescribed set count (position `targetSets + n`).
- `drop` — extra set performed as an immediate lower-load continuation.
- `skipped` — prescribed position not performed. Stored as a row with
  `isCompleted = 0` and null values so adherence can distinguish
  *not scheduled* (no row) from *scheduled but skipped* (row) from
  *voided by undo* (row, no skipped marker).

Legacy rows (`execution_type` null): completed → `normal`, voided → voided.

## Override reasons (closed vocabulary, optional, explicit only)

`load_reduced` · `load_increased` · `reps_reduced` · `reps_increased` ·
`fatigue` · `pain_discomfort` · `equipment_unavailable` · `time_constraint` ·
`other`

The athlete may state a reason; the system never infers one (a 60→55 kg
reduction records `load_reduced`, never `fatigue`, unless stated). Unknown
values normalize to null on write and fail closed on backup validation.

## Engine (pure, deterministic)

- `COMPLETE_SET` — unchanged semantics; values flow to `LOG_SET`.
- `SKIP_SET` — records the current position as skipped (`LOG_SKIPPED_SET`),
  then advances exactly like a completed set (same rest timing). Undo restores
  the skipped position.
- `SKIP_STEP` — records the skipped-away-from set, then advances the step.
  Undo restores it (behavior change from Phase 2L, covered by tests).
- `LOG_EXTRA_SET { set, executionType: 'extra' | 'drop' }` — logs at
  `targetSets + extras + 1` using `cursor.extraCounts` (position-scoped
  counters, so replay is deterministic), keeps cursor position, starts no
  timer. Also accepted on completed cursors: finishing the prescribed work
  and *then* adding a set is the primary extra-set flow.
- `UNDO_LAST` — unchanged (voids last row, restores position); also preserves
  `extraCounts` so later extras never collide.
- UI emits intents; the engine decides transitions; the application layer
  (`applyEffects`) persists. No rules live in components.

## Workout UI

- Weight/reps/RIR/duration remain inline-editable via the athlete numpad
  (unchanged); differing values are logged as-is (cases: less/more
  weight, fewer/more reps, partial sets).
- The optional reason chip row appears only when the entered values differ
  from the prescription (same pure classifier the persistence layer uses).
- `Omitir serie` (skip current set), `Serie extra`, `Drop set` sit in one
  compact secondary row; timer/step skip (`Omitir`) is unchanged. All buttons
  carry accessible labels; extra/drop require valid inputs like `COMPLETAR`.
- Correcting a just-logged set = `Deshacer` (void) + re-enter; no history
  editor was added (deliberate scope cut).

## History

- Performed rows show actuals with markers (`modified`/`extra`/`drop set`)
  and the stated reason in parentheses; plain legacy rows render unchanged.
- Skipped positions render as a compact `Omitidas: R1S2, …` line per step.
- `totalCompletedSets` counts performed sets only; voided rows stay invisible.
- CSV export is unchanged by design: it exports performed work only, so
  skipped positions never appear there (adherence data lives in backups).

## Analytics contract (unchanged code, verified by regression tests)

- Volume/load use **actuals** (`calculateSetLoad` over completed rows);
  skipped rows contribute nothing; extra/drop rows contribute as real work.
- Progression analyzes actual performances; prescription is context for
  comparability only.
- Muscle, trends, compare, records: no changes; all key on completion.

## Persistence, backup, migration

- Schema v7: `set_logs.execution_type` + `set_logs.override_reason`
  (nullable text). Migration `v6 → v7` adds both columns; old rows read null.
- Backup `BackupSetLog` gains both fields as **optional**: older backups
  validate and restore with nulls; new values are closed-enum validated
  before the checksum; restore maps `?? null`.

## YAGNI decisions (explicitly not built)

- No per-set prescription duplication (definition snapshot already has it).
- No parent linkage for drop sets (ordering by round/setIndex suffices).
- No history editor beyond undo-then-reenter.
- No measured actual tempo (target tempo only, as before).
- No fatigue/recovery/adherence engine (data now supports them; engines deferred).
- No distance logging in workout UI (payload already supports it; out of scope).

## Constraints preserved (verified)

Offline-first · no accounts/backend · no telemetry · no INTERNET permission ·
immutable snapshots · pure engine · integer units (grams/ms/mm) · canonical
timer expiry · WatermelonDB migrations · UI as pure view layer · deterministic
analytics · versioned backups · EN/ES parity (new keys in both dictionaries) ·
accessibility labels on every new control.
