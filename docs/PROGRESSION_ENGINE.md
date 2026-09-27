# Progression Engine (Phase 3A)

Deterministic, pure, explainable progression analysis. This document is the
authoritative contract for `src/analytics/progression.ts` (exported via
`src/analytics/index.ts`). Architectural context lives in
`docs/TRAINING_INTELLIGENCE_FOUNDATION.md`.

**Purity contract:** TypeScript only — no React, no WatermelonDB, no network,
no IO, no user-facing localized strings. All units are integer internal units
(grams, milliseconds, millimeters, integer timestamps). Deterministic: same
input → same output, always.

---

## Input: `AnalyzeProgressionInput`

| Field | Type | Meaning |
| --- | --- | --- |
| `exerciseName` | `string` | Display name of the exercise being analyzed. |
| `exerciseId` | `string \| null` | Stable exercise ID when available. |
| `sessions` | `DatedSession[]` | Completed sessions (from `loadAnalyticsSnapshot`). |
| `currentPrescription` | `PrescriptionTarget` | Current target: rep range, weight, RIR, tempo. |
| `currentEquipmentClass` | `string` | Equipment class of the current context. |
| `currentExerciseId` | `string \| null` | Current exercise ID (identity matching). |
| `historicalPrescriptions?` | `Map<string, SessionExercisePrescription>` | Per-session, per-exercise prescription context; key `` `${sessionId}|${exerciseName}` `` from definition_json snapshots. |
| `availableExercises?` | `SubstitutionExercise[]` | Catalog for substitution detection. |
| `achievableNextWeightGrams?` | `number \| null` | **Caller-derived** next achievable load from real data (see below). |
| `now` | `number` | Current timestamp (ms). |

## Output: `ProgressionEvidence`

- `state`: `'progress' | 'maintain' | 'insufficient_data'`
- `reason`: stable reason code (below) — the UI localizes it via
  `src/constants/strings.*`; the engine never emits user-facing text.
- `explanation`: developer/debug string (not for UI).
- `baseline`, `current`: comparable performances used.
- `comparableCount`: performances considered.
- `comparability`: `ComparabilityEvidence` (verdict + specific mismatches).
- `atTargetWeight`, `repsVsRange`: double-progression facts.
- `suggestedWeightGrams?`: present **only** when a data-derived increment exists.
- `weightIncrementSource`: `'equipment_inventory' | 'none'`.

---

## Comparability

Identity is matched **ID-first**:

1. **Both IDs present** — equal IDs match (`seed_id`); different IDs never
   match, even with identical display names (same name does not override two
   distinct valid IDs).
2. **ID missing on either side** — safe fallback to exact display-name
   equality (`name_only`). No fuzzy matching, ever.
3. **Substitutions** — a substitute is never the original exercise:
   `SUBSTITUTION_USED` (current), `PREVIOUS_SUBSTITUTION` (history).
4. **Ambiguous identity** — insufficient/non-comparable evidence is returned
   instead of weakening matching.

Additionally required for comparability: same equipment class, same
prescription scheme (rep range + RIR; target weight is deliberately excluded
because it legitimately changes between sessions — that change IS progression),
and non-substitution status on both sides.

---

## Double progression

Conservative, deterministic:

- `achieved < min` → `maintain` / `REPS_BELOW_MIN`
- `min < achieved < max` → `maintain` / `REPS_IN_RANGE`
- `achieved == max` at target weight → `progress` / `REPS_RANGE_COMPLETED`
- `achieved > max` at target weight → `progress` / `REPS_EXCEEDED_RANGE`
- upper bound reached but **not** at target weight → `maintain` (opportunity
  pending weight consolidation)

## Weight increment semantics — NO hardcoded defaults

The engine **never invents an increment** (no `+2.5 kg` fallback). When the
upper rep bound is reached at the target weight, the progression opportunity is
real and reported, but the suggested next weight exists **only** if the caller
provides `achievableNextWeightGrams` — derived from real data via the
persistent equipment inventory (schema v4, `src/data/equipment.ts`) resolved
through `solveLoadInventory` (`src/analytics/inventory.ts`), composed in
`resolveAchievableNextWeightGrams` (`src/analytics/progressionWiring.ts`).

- `achievableNextWeightGrams > targetWeight` → `suggestedWeightGrams` set,
  source `'equipment_inventory'`.
- otherwise/absent → `suggestedWeightGrams` undefined, source `'none'`;
  the UI should ask the athlete what load to attempt next.

Sourcing semantics (implemented, `progressionWiring.ts`): because
`solveLoadInventory` resolves *for* a target (an exactly-reachable target
returns the target itself), the next load above the target needs two probes:
(1) solve(target) — an achieved load strictly above the target wins directly;
(2) otherwise the target is exactly reachable → solve(target + smallest unit
contribution) and accept the result only if it exceeds the target. A
plates-only inventory (no bar registered as a fixed item) cannot exceed a
barbell target and yields no suggestion — conservative by design. With very
sparse, irregular inventories a far-above reachable load may be skipped rather
than mis-suggested.

---

## Phase 3B integration (consumer contract)

The engine is consumed through a strict data path — the UI never reimplements
its rules:

```
workout_sessions + set_logs + definition_json + exercises + equipment_items
  → src/data/progression.ts   (batched loaders, no N+1)
  → src/analytics/progressionWiring.ts (pure: inventory → achievable load,
      latest-prescription selection, ID-first)
  → analyzeProgression() / analyzeStepEvidence()
  → ProgressionEvidence
  → UI (renders verdicts; localizes reason codes via strings.progression.*)
```

Consumers:

- **Progress tab** — `ProgressionOverviewSection`: three transparent groups
  (progressing / maintaining / not-enough-data), one row per analyzed exercise
  with the engine's own reason as the row subtitle. Empty state explains what
  evidence is required.
- **HistoryDetailScreen** — per-step `SessionProgressionSummary` cards when
  the step's immutable prescription is analyzable (rep range + target weight).
- **WorkoutScreen completed view** — post-workout summary cards for the
  trained exercises (best-state first, max 3).

Reason codes are never exposed raw: `progressionReasonLabel` maps every stable
code through `strings.progression.reason.*` (EN/ES parity enforced by the i18n
contract tests). States are distinguished by label + badge tone, never by color
alone.

Validated on device (Samsung Galaxy A04, Android 14, release build): EN/ES
rendering, empty/insufficient states, navigation, zero crashes. The populated
verdict flow is covered by the Jest integration suites (LokiJS DB → engine →
component assertions).

## Reason codes

`REPS_RANGE_COMPLETED`, `REPS_EXCEEDED_RANGE`, `REPS_BELOW_MIN`,
`REPS_IN_RANGE`, `INSUFFICIENT_HISTORY`, `NO_COMPARABLE_PERFORMANCE`,
`PRESCRIPTION_MISMATCH`, `NO_REPS_RANGE`, `NO_CURRENT_WEIGHT`, `NO_RIR_DATA`,
`SUBSTITUTION_USED`, `PREVIOUS_SUBSTITUTION`, `EQUIPMENT_MISMATCH`,
`TEMPO_MISMATCH`.

## Reuse (no duplicated logic)

- e1RM: `estimate1rmGrams` (`records.ts`) — the only formula in the codebase.
- Load computation: `calculateSetLoad` (`load.ts`).
- Substitution ranking: `rankSubstitutions` (`substitutions.ts`).
- Equipment classes: `equipmentClassOf` (`substitutions.ts`).
- Achievable next load: `solveLoadInventory` (`inventory.ts`), wired by the
  caller — not by this engine.

---

## Limitations

- RIR/tempo are carried as fields but currently always `null` (`SetLoadInput`
  does not record them yet); reason codes `NO_RIR_DATA`/`TEMPO_MISMATCH` are
  defined for forward compatibility.
- `historicalPrescriptions` is caller-supplied; without it, historical
  prescriptions default to the current one.
- Identity quality depends on exercise IDs being stable across app versions.

## Deliberately unimplemented (out of Phase 3A scope)

AI/LLM suggestions, workout generation, fatigue or recovery prediction,
plateau detection, calendar scheduling, cloud sync, Health Connect, Wear OS.
No Phase 3B work starts automatically.
