# Phase 2M — Training Intelligence Foundation

Technical audit of existing training intelligence signals, data flow, and pure-analytics boundary. Prepared for future Phase 3 implementation without coupling to React Native, WatermelonDB, Zustand, or UI.

---

## 1. Current Architecture

### 1.1 Data Pipeline

```
Routine Definition (types/engine.ts)
    ↓ (serialized to definition_json at session start)
WorkoutSession (WatermelonDB) — definition_json + cursor_json are immutable snapshots
    ↓ (engine dispatch → effects → applyEffects)
SetLog (WatermelonDB) — weightGrams, reps, durationMs, distanceMm, rir, blockIndex, stepIndex, round, setIndex, isCompleted
    ↓ (loadAnalyticsSnapshot batches 4 queries)
AnalyticsSnapshot (src/data/analytics.ts) — normalized sessions + exercises + resolved muscle mapping
    ↓ (pure functions)
src/analytics/* — deterministic calculations
    ↓
UI (screens, components)
```

**Key invariant**: `definition_json` and `cursor_json` are canonical. Derived caches (`current_block_index`, `timer_expires_at`, etc.) exist only for queries; cursor_json wins on divergence.

### 1.2 Pure Analytics Boundary

| Module | Classification | Coupling |
|--------|---------------|----------|
| `src/analytics/load.ts` | **PURE** | Domain types only (`SetLoadInput`, `DatedSession`) |
| `src/analytics/records.ts` | **PURE** | Domain types only (`DatedSession`, `SetLoadInput`) |
| `src/analytics/muscles.ts` | **PURE** | Domain types only (`SetLoadInput`, `MuscleStepInput`) |
| `src/analytics/trends.ts` | **PURE** | Domain types only (`DatedSession`) |
| `src/analytics/athlete.ts` | **PURE** | Domain types only (`DatedSession`) |
| `src/analytics/autoregulation.ts` | **PURE** | Domain types only (config + currentWeightGrams + actualRir) |
| `src/analytics/substitutions.ts` | **PURE** | Domain types only (`SubstitutionExercise`, `Contributions`) |
| `src/analytics/compare.ts` | **PURE** | Domain types only (`DatedSession`, `SetLoadInput`) |
| `src/analytics/inventory.ts` | **PURE** | Domain types only (`LoadItem`, `InventorySolveInput`) |
| `src/engine/index.ts` | **PURE** | Domain types only (`RoutineDefinition`, `ExecutionCursor`, `EngineEvent`) |
| `src/engine/cursor.ts` | **PURE** | Domain types only (`ExecutionCursor`, `RoutineDefinition`) |
| `src/data/analytics.ts` | **INFRASTRUCTURE COUPLED** | WatermelonDB, models, `muscles` catalog |
| `src/data/actions.ts` | **INFRASTRUCTURE COUPLED** | WatermelonDB, models, engine types |
| `src/data/history.ts` | **INFRASTRUCTURE COUPLED** | WatermelonDB, models |
| `src/export/export.ts` | **PURE** | Domain types only (`HistoryDetail`) |

**No analytics module imports React, React Native, WatermelonDB, Zustand, navigation, or UI components.**

### 1.3 Domain Types (Stable Contracts)

**Engine Types** (`src/types/engine.ts`):
- `RoutineDefinition` — immutable, serializable
- `ExecutionCursor` — positional state + timer + interval runtime
- `Prescription` — targetSets, targetRepsMin/Max, targetDurationMs, targetWeightGrams, targetRir, tempo
- `SetPayload` — actual logged values (weightGrams, reps, durationMs, distanceMm, rir)
- `EngineEvent` / `Effect` — deterministic transitions

**Analytics Types** (scattered across `src/analytics/*`):
- `SetLoadInput` — completed-set data for calculations
- `DatedSession` — session with exercises + sets, timestampMs for range filtering
- `ExercisePr` / `PrEvent` — personal records
- `SessionLoad` / `ExerciseLoad` — aggregate volume
- `MuscleSessionInput` / `MuscleHeatmap` — muscle load distribution
- `WindowTotals` / `WindowComparison` / `LoadRatio` — trend windows
- `AutoregConfig` / `AutoregRecommendation` — RIR-based next-set suggestion
- `RankedSubstitution` — exercise substitution ranking
- `SessionComparison` — side-by-side descriptive deltas
- `RollingSummary` / `WeeklyPoint` — descriptive statistics

---

## 2. Comparability Analysis

### 2.1 Currently Comparable (Stable Signals)

| Signal | Available | Unit | Source |
|--------|-----------|------|--------|
| Exercise identity (name) | ✅ | string | `exerciseName` in definition_json + SetLog |
| Exercise identity (stable seed id) | ✅ | string | `exerciseId` in definition_json steps → Exercise table |
| Prescription target | ✅ | grams/reps/ms/rir | `definition_json` steps → Prescription |
| Actual load (weight × reps) | ✅ | gram-reps | SetLog.weightGrams × reps |
| Actual reps | ✅ | integer | SetLog.reps |
| Actual RIR | ✅ | integer | SetLog.rir (nullable) |
| Actual tempo | ✅ | ms per phase | definition_json steps → Prescription.tempo |
| Actual duration | ✅ | ms | SetLog.durationMs |
| Timestamps | ✅ | ms epoch | `startedAt`, `endedAt`, `completedAt` |
| Session identity | ✅ | UUID | `WorkoutSession.id` |
| Routine identity | ✅ | UUID | `Routine.id` in `routine_id` FK |
| Block/step identity | ✅ | string | `blockIndex`, `stepIndex`, `step.id` in definition_json |
| Equipment context | ✅ | string | Exercise.equipment (via Exercise table) |
| Substitution compatibility | ✅ | score | `rankSubstitutions()` using pattern/equipment/muscles |
| PR / e1RM | ✅ | grams | `records.ts` → Epley on weight×reps |
| Volume (resistance) | ✅ | gram-reps | `load.ts` → `calculateSetLoad()` |
| Volume (duration) | ✅ | ms | `load.ts` → `calculateSetLoad()` |
| Muscle distribution | ✅ | basis points | `muscles.ts` → contributions map |
| Session comparison | ✅ | deltas | `compare.ts` → `compareSessions()` |
| Readiness (tap test) | ✅ | count | `ReadinessTest.tapCount` |

### 2.2 Not Currently Comparable (Missing / Unstable)

| Signal | Status | Why |
|--------|--------|-----|
| **Exercise versioning** | ❌ | `RoutineDefinition` snapshots exerciseName but not exerciseId in step; Exercise table can be edited/deleted; no exercise revision history |
| **Prescription versioning** | ❌ | Prescription rows are mutable (upsertPrescription); only current state persists; snapshots captured in definition_json at session start only |
| **Set-level RIR consistency** | ⚠️ | RIR is nullable; not all sets log RIR; no validation that actual RIR matches target RIR |
| **Tempo actual vs target** | ❌ | Only target tempo stored; no actual tempo measurement |
| **Skipped/missed work** | ⚠️ | `isCompleted` flag exists; SKIP_STEP event exists; but no aggregate "missed volume" signal |
| **Rest duration actual vs target** | ❌ | Timer uses absolute expiresAt; actual rest duration not logged separately |
| **Interval block completion** | ⚠️ | IntervalSpec in definition_json; interval runtime in cursor_json; no aggregate interval volume metric |
| **Equipment substitution at set level** | ❌ | Equipment is per-exercise; no set-level equipment override |
| **Load progression per exercise** | ⚠️ | Can compute via `exercisePrs` + session history; no dedicated "progression signal" |
| **Session incompleteness reason** | ❌ | `session_status` = 'active'/'completed'; no "abandoned", "interrupted", "partial" distinction |
| **Fatigue / readiness correlation** | ❌ | ReadinessTest exists but not linked to sessions |
| **Exercise substitution at set level** | ❌ | Substitutions ranked at exercise level; no set-level substitution signal |

### 2.3 Comparability Rules (What Phase 3 Would Need)

For rigorous future comparison, the following must be true:
1. **Same exercise** → `exerciseId` matches AND `exerciseName` matches (seed id preferred)
2. **Same exercise, different variant** → same `exerciseId` but different `exerciseName` (not tracked)
3. **Substitution compatible** → `rankSubstitutions()` score > 0 with reasons documented
4. **Same prescription target** → `targetWeightGrams`, `targetRepsMin/Max`, `targetDurationMs`, `targetRir` all match
5. **Same equipment context** → `Exercise.equipment` class matches (via `equipmentClassOf()`)
6. **Different rep range** → `targetRepsMin/Max` differ → not directly comparable for volume
7. **Different tempo** → tempo phases differ → not directly comparable for time-under-tension
8. **Different RIR target** → `targetRir` differs → not directly comparable for autoregulation
9. **Different load** → actual `weightGrams` differs → volume comparable but intensity differs
10. **Session incomplete** → `isCompleted` = 0 on sets; `session_status` = 'active' → exclude or flag

---

## 3. Existing Intelligence Signals

### 3.1 Personal Records (`src/analytics/records.ts`)
- **Metrics**: weight (grams), reps, duration (ms), distance (mm), estimated 1RM (Epley)
- **Chronological events**: `prEvents()` → every record-breaking moment with previous value
- **Final bests**: `exercisePrs()` → per-exercise bests, alphabetical
- **History**: `prHistory()` → chronological events for one exercise/metric
- **Units**: grams, reps, ms, mm (integers)
- **Epley formula**: `weightGrams × (1 + reps / 30)` → rounded grams

### 3.2 Volume & Load (`src/analytics/load.ts`, `src/analytics/athlete.ts`)
- **Resistance volume**: `weightGrams × reps` (gram-reps) — completed sets only
- **Duration work**: `durationMs` — timed sets only
- **Aggregates**: per-set, per-exercise, per-session, per-date-range
- **Trend windows**: 7-day acute vs 28-day chronic (non-overlapping local-calendar)
- **Load ratio (ACWR-style)**: `acuteWeeklyGramReps / (previous28GramReps / 4)` with status codes
- **Rolling summaries**: 7/28-day session count, volume, wall time, density, avg load/set
- **Weekly series**: bucketed oldest→newest

### 3.3 Muscle Analytics (`src/analytics/muscles.ts`)
- **17 controlled muscle groups** (vocabulary, not anatomy)
- **Contributions**: basis points summing to 10000 per exercise
- **Resolution**: seed id → record key (name|category|equipment|metricFlags) → null
- **Distribution**: integer largest-remainder allocation (conservation holds)
- **Heatmap**: mapped vs unmapped resistance, set counts, share basis points, contributing exercises

### 3.4 Session Comparison (`src/analytics/compare.ts`)
- **Side-by-side**: baseline (older) vs current (newer)
- **Metrics**: volume (gram-reps), completed sets, wall duration
- **Per-exercise**: presence (both/baseline/current), volume delta, percent change (null if baseline=0)
- **Exercise union**: alphabetical

### 3.5 Autoregulation (`src/analytics/autoregulation.ts`)
- **Input**: currentWeightGrams, actualRir, config (targetRir, stepGrams, min/max)
- **Output**: direction (hold/increase/decrease), deltaGrams, recommendedWeightGrams, reason code
- **Deterministic rules**: actual < target → increase; actual > target → decrease; clamp overrides reason
- **Configurable**: enabled, stepGrams (default 2.5kg), min/max weight

### 3.6 Substitutions (`src/analytics/substitutions.ts`)
- **Three signals**: movement pattern (keyword heuristics), equipment class, muscle overlap (basis points)
- **Weights**: pattern 400, equipment 250, muscles 300, category 50
- **Output**: ranked list with score and matched reasons

### 3.7 Inventory / Plate Calculator (`src/analytics/inventory.ts`)
- **Bounded knapsack DP** for closest achievable load
- **Per-side plates** support (2× weightGrams)
- **Tie-breaking**: exact > closest; smaller |diff|; achieved ≥ target; fewer units; ascending item index

### 3.8 Readiness (`src/analytics/readiness.ts`)
- **Tap test**: 10-second tap count stored locally
- **History**: `listReadinessTests()` newest first

---

## 4. Pure Analytics Boundary Classification

| Category | Modules |
|----------|---------|
| **PURE** (no deps, domain types only) | `load.ts`, `records.ts`, `muscles.ts`, `trends.ts`, `athlete.ts`, `autoregulation.ts`, `substitutions.ts`, `compare.ts`, `inventory.ts`, `engine/index.ts`, `engine/cursor.ts` |
| **PURE BUT COUPLED TO DOMAIN TYPES** | All above — they import `src/types/engine` and each other's types |
| **INFRASTRUCTURE COUPLED** | `data/analytics.ts` (WatermelonDB), `data/actions.ts` (WatermelonDB), `data/history.ts` (WatermelonDB), `data/serialize.ts` |
| **UI COUPLED** | None in analytics/engine |
| **DUPLICATED** | `msToSeconds` was in both `load.ts` and `utils/units.ts` — consolidated in Phase 2L |

**No analytics module reaches into React, WatermelonDB, Zustand, or UI.**

---

## 5. PR / e1RM / Volume Contracts

### 5.1 PR Contract
- **Input**: `DatedSession[]` (completed sessions with exercises + sets)
- **Output**: `ExercisePr[]` (final bests per exercise) + `PrEvent[]` (chronological events)
- **Metric units**: grams (weight), reps (count), ms (duration), mm (distance)
- **e1RM**: Epley `weightGrams × (1 + reps/30)` → rounded grams
- **Tie-breaking**: earlier timestamp wins (strictly greater value required)

### 5.2 Volume Contract
- **Resistance volume**: `weightGrams × reps` (gram-reps) for completed sets with both present
- **Duration volume**: `durationMs` for completed timed sets
- **No conversion**: duration never converted to fake kg-reps
- **Interval/timed sets**: excluded from resistance volume (hasDuration only)

### 5.3 Muscle Distribution Contract
- **Vocabulary**: 17 fixed muscle groups
- **Contributions**: basis points (0-10000) per exercise (from seed data)
- **Allocation**: integer largest-remainder per set → exact sum conservation
- **Unmapped**: tracked separately, never guessed

---

## 6. Future Intelligence Boundary (Conceptual)

### 6.1 Minimal Contract (Not Implemented)

```typescript
// CONCEPTUAL — NOT IMPLEMENTED
interface TrainingInsight {
  type: 'progression_opportunity' | 'performance_change' | 'missed_work' | 'pr' | 'regression' | 'insufficient_data' | 'no_recommendation';
  exerciseName: string;
  sessionId?: string;
  metric?: 'volume' | 'intensity' | 'frequency' | 'e1rm' | 'readiness';
  currentValue: number;
  referenceValue: number;
  delta: number;
  confidence: 'high' | 'medium' | 'low'; // based on data completeness
  reason: string; // human-readable explanation
  actionable?: {
    suggestedWeightGrams?: number;
    suggestedReps?: number;
    suggestedRir?: number;
  };
}

interface AnalyzeTrainingStateInput {
  sessions: DatedSession[];           // completed sessions only
  currentRoutine?: RoutineDefinition; // optional: current active routine
  equipment?: LoadItem[];             // optional: for inventory-aware suggestions
  readinessHistory?: ReadinessTest[]; // optional: tap test history
  autoregConfig?: AutoregConfig;      // optional: autoregulation policy
  now: number;                        // for window calculations
}

function analyzeTrainingState(input: AnalyzeTrainingStateInput): TrainingInsight[]
```

### 6.2 What This Boundary Would Need (Currently Available)
- ✅ `DatedSession[]` from `loadAnalyticsSnapshot()`
- ✅ `RoutineDefinition` from current session or routine draft
- ✅ `LoadItem[]` from `EquipmentItem` table
- ✅ `ReadinessTest[]` from `listReadinessTests()`
- ✅ `AutoregConfig` from user settings (not yet persisted)
- ✅ All pure analytics functions for signal extraction

### 6.3 What Would Be Missing for Full Intelligence
- Exercise versioning / revision history
- Set-level RIR completeness validation
- Skipped/missed work aggregate signals
- Fatigue/readiness correlation data
- User goals / periodization context

---

## 7. Changes Made in Phase 2M

### 7.1 Code Changes

**None.** Phase 2M is documentation-only per YAGNI. All existing pure analytics functions are already reusable for Phase 3.

### 7.2 Documentation Added
- `docs/TRAINING_INTELLIGENCE_FOUNDATION.md` (this file)

---

## 8. Tests

| Metric | Value |
|--------|-------|
| Jest tests | 825 |
| Test suites | 58 |
| TypeScript `tsc --noEmit` | exit 0 |

All existing tests pass. No tests added (no code changed).

---

## 9. Git

| Property | Value |
|----------|-------|
| Commit | `docs: establish training intelligence foundation` |
| Files added | `docs/TRAINING_INTELLIGENCE_FOUNDATION.md` |
| Working tree | Clean |
| `origin/main` | Synchronized |

---

## 10. Explicit Status

- **Phase 2L**: CLOSED (commit `2643672`)
- **Phase 2M**: COMPLETE (this documentation)
- **Phase 3**: NOT IMPLEMENTED

---

## 11. Constraints Phase 3 Must Preserve

1. **Offline-first** — no mandatory network
2. **No accounts/backend** — local-first data ownership
3. **No telemetry/ads/subscriptions** — privacy by design
4. **No INTERNET permission** — verified via apksigner/aapt
5. **Immutable session snapshots** — `definition_json` and `cursor_json` canonical
6. **Pure TypeScript engine** — `(definition, cursor, event) → { cursor', effects[] }`
7. **Integer internal units** — grams, ms, mm
8. **Canonical timer expiration** — absolute timestamps, never UI state
9. **WatermelonDB persistence** — SQLite with schema migrations
10. **Zustand for ephemeral only** — not persistent
11. **UI does not interpret execution transitions** — pure view layer
12. **Deterministic analytics** — pure functions, no randomness
13. **Versioned backups** — `.apexbackup` with checksum + atomic restore
14. **Security boundaries** — proper isolation, no data leakage
15. **Accessibility** — semantic labels, roles, touch targets
16. **i18n EN/ES structural parity** — 497+ keys, neutral tú register
17. **Android-first scope** — minSdk 24, targetSdk 36, arm64-v8a + armeabi-v7a

---

## 12. YAGNI Decisions (Explicitly NOT Done)

- ❌ No new database migrations or schema changes
- ❌ No new domain types for future intelligence (e.g., `TrainingInsight`, `AnalyzeTrainingStateInput`)
- ❌ No exercise versioning/revision history
- ❌ No set-level equipment override
- ❌ No actual tempo measurement
- ❌ No rest duration logging
- ❌ No fatigue/readiness correlation engine
- ❌ No periodization/goal context
- ❌ No `analyzeTrainingState()` implementation
- ❌ No automatic progression / double progression / plateau detection
- ❌ No workout generator / AI recommendations
- ❌ No new runtime dependencies
- ❌ No mass refactoring of analytics modules

The existing pure analytics functions are sufficient for Phase 3 to compose intelligence without architectural changes.