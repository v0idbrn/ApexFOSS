# Volume Audit (§18) — Performed Volume, Prescribed Volume, Units, Conservation

**Status:** complete · **Date:** 2026-09-26 · **Scope:** every code path that computes,
aggregates, converts or displays resistance volume ("training load") in ApexFOSS.

**Audit scenario:** 3 sets × 40 kg × 5 reps = **600 kg·reps** external-load volume
(600 000 gram-reps in storage units). Invariants proven:

1. RIR never inflates volume.
2. Prescribed volume (3 × 40 × 5–8) is never silently mixed with performed volume.
3. Units are conserved through every aggregation level and converted exactly once at display.

Automated evidence: `src/analytics/volumeAudit.test.ts` (29 tests).

---

## §18.1 Calculation map

Every entry lists: inputs → formula → output units → callers. "gram-reps" = integer
gram × reps (storage unit for resistance volume).

### A. Performed volume (external load) — the only thing ever summed

| # | Function | Location | Inputs | Formula | Output | Units |
|---|----------|----------|--------|---------|--------|-------|
| A1 | `calculateSetLoad` | `src/analytics/load.ts:83` (formula `:90`) | `SetLoadInput {weightGrams, reps, durationMs, isCompleted}` (`load.ts:8`) | `completed && weightGrams>0 && reps>0 ? weightGrams × reps : 0` (`:87,:90`); duration: `durationMs>0 ? durationMs : 0` (`:88,:91`) | `SetLoad.resistanceGramReps`, `durationMs`, `hasResistance`, `hasDuration` | gram-reps / ms |
| A2 | `calculateExerciseLoad` | `load.ts:121` | exercise name + `SetLoadInput[]` | `Σ calculateSetLoad(s)` over sets; `addToAggregate` (`:107`) counts only `isCompleted` | `ExerciseLoad` (`resistanceGramReps`, `durationMs`, set counts) | gram-reps / ms |
| A3 | `calculateSessionLoad` | `load.ts:139` | `SessionLoadInput` (exercises → sets) | `Σ` exercise loads (`:145-149`) | `SessionLoad` (+ `exerciseLoads[]`) | gram-reps / ms |
| A4 | `calculateDateRangeLoad` | `load.ts:175` | `DatedSession[]`, `DateRange {startMs,endMs}` | `Σ` session loads (A3) for sessions with `startMs ≤ timestampMs < endMs` (`:178`) | `AggregateLoad` | gram-reps / ms |
| A5 | `gramRepsToKgReps` | `load.ts:196` | gram-reps | `Math.round(g / 100) / 10` | display number | **kg·reps** |
| A6 | `msToSeconds` | `load.ts:201` | ms | `Math.round(ms/1000)` | display number | s |

**Callers of A1 (single source of truth):** `load.ts:124` (A2), `trends.ts:67`
(`calculateWindowTotals`), `muscles.ts:322` (heatmap per-set `resistance +=` at `:324`),
`compare.ts:76` (`sideOfSets`), `data/dashboard.ts:106` (Home dashboard), `athlete.ts:178`
(`setsForExercise`). No other file multiplies `weightGrams × reps` (verified by grep: only
`load.ts:90` in analytics; `records.ts:54` is Epley, `inventory.ts:42` is plate math).

**Callers of A3/A4:** `HistoryDetailScreen.tsx:122`, `WorkoutScreen.tsx:247` (completed-view
summary `:264-268`), `load.ts:179` (A4), `LoadScreen.tsx:101`.

### B. Prescribed volume — **does not exist** (documented N/A)

- Prescription data lives only as routine-step fields: `targetSets`, `targetRepsMin/Max`,
  `targetWeightGrams`, `targetDurationMs`, `targetRir` (`src/types/engine.ts:26-28`,
  `src/data/models.ts:74-78`), surfaced for **display/export only**:
  `loadSessionDetail` (`src/data/history.ts:187-192`), CSV columns
  (`src/export/export.ts:21-24`).
- **No function anywhere in `src/` multiplies prescription fields into kg·reps.**
  Proven by the source-scan test *"source scan: volume modules consume no prescription
  fields and no prescribed-volume function exists"* — it asserts zero matches for
  `prescri|rir|targetReps|targetSets|targetWeight` in the volume modules
  (`load.ts`, `trends.ts`, `athlete.ts`, `compare.ts`, `muscles.ts`, `records.ts`,
  `data/dashboard.ts`) and zero matches for `prescribedVolume|plannedVolume|targetVolume|
  prescriptionVolume|prescri… volume` across all non-test `src/**` sources, with a
  positive control proving the scanner detects prescription language where it exists
  (`autoregulation.ts`).
- Related-but-not-volume: `plannedSets` (`src/workout/sessionProgress.ts:20`) counts
  *planned sets* (no load units); RIR autoregulation (`src/analytics/autoregulation.ts`)
  adjusts the next set's **weight** from RIR deltas and is never read by any volume path;
  `analytics.ts` builds `SetLoadInput` exclusively from performed `set_logs`
  (`src/data/analytics.ts:62-70, 109-120`).
- Consequence: performed and prescribed quantities are structurally unable to mix —
  only performed logs can enter A1–A4. The audit scenario's "prescribed 960 kg phantom"
  (40 × 8 × 3) is provably absent: performed 5+6+8 reps → **760 000 gram-reps = 760 kg·reps**
  (test *"performed volume uses actual reps 5+6+8 → 760_000 gram-reps, never prescribed 960_000"*).

### C. Training load — windows, trends, ratio, rolling summaries

| Function | Location | Inputs | Formula | Output | Units |
|----------|----------|--------|---------|--------|-------|
| `startOfLocalDay` | `load.ts:59` | ts | local midnight | ms | ms |
| `dateRange` | `load.ts:71` | kind (`today`/`7d`/`28d`), now | local calendar window, `endMs = now` (exclusive) | `DateRange` | ms |
| `dayWindow` / `currentWindow` / `previousWindow` | `trends.ts:23/:33/:38` | now, days, endOffset | local-midnight window `[start, end)`; previous is adjacent (`previous.endMs === current.startMs`) | `DayWindow` | ms |
| `calculateWindowTotals` | `trends.ts:52` (per-set loop `:64-78`, `calculateSetLoad` at `:67`) | `DatedSession[]`, `DayWindow` | Σ A1 for completed sets in window; `sessionCount` of in-window sessions | `WindowTotals` | gram-reps / ms |
| `compareWindows` | `trends.ts:93` | two `WindowTotals` | `absoluteChange = current − previous`; `percentChange = round(Δ/prev×1000)/10`, `null` if prev = 0 | `WindowComparison` | gram-reps / % |
| `calculateLoadRatio` | `trends.ts:126` | acute7 gram-reps, prev28 gram-reps, prev28 session count | `acute ÷ (prev28 ÷ 4)`, ratio rounded 2 dp; `no_baseline` / `zero_baseline` guards (`:135-147`) — never Infinity/NaN | `LoadRatio` | ratio (dimensionless) |
| `rollingSummary` | `athlete.ts:38` | sessions, now, days | `currentWindow` → `calculateWindowTotals` (`:40`) + wall-clock (`:41-45`) | `RollingSummary` (gram-reps, ms, avgs) | gram-reps / ms / derived |
| `weeklySeries` | `athlete.ts:91` (window at `:95`) | sessions, now, weeks | `count` non-overlapping 7-day windows via `dayWindow(now,7,7·i)`, oldest → newest | `WeeklyPoint[]` | gram-reps / week |
| `descriptiveDelta` | `athlete.ts:122` | two numbers | `current − previous`; `%` null when previous ≤ 0 | `DescriptiveDelta` | same as input |
| `durationStats` | `athlete.ts:139` | sessions, window | min/avg/max of `endedAt − startedAt` | `DurationStats` | ms |

**Callers:** `LoadScreen.tsx:101, 107-112, 114-118, 119, 120`; `CompareScreen.tsx:150`.

### D. Muscle load

| Function | Location | Inputs | Formula | Output | Units |
|----------|----------|--------|---------|--------|-------|
| `emptyMuscleLoadMap` | `muscles.ts:154` | — | 17 × 0 | `MuscleLoadMap` | gram-reps |
| `distributeBasisPoints` | `muscles.ts:200` (largest-remainder `allocateExact` `:166`) | total gram-reps, `Contributions` (bp weights summing to 10000, `:46`) | integer largest-remainder split: `parts Σ === total` for any positive integer total | per-muscle parts | gram-reps |
| `addExerciseLoad` | `muscles.ts:273` | target map, name, load, sets | accumulate `+=` | per-muscle exercise rollup | gram-reps |
| `toSortedExerciseLoads` | `muscles.ts:284` | map | sort load desc, name tie-break | `MuscleExerciseLoad[]` | gram-reps |
| `calculateMuscleHeatmap` | `muscles.ts:297` | `MuscleSessionInput[]` (per-step `contributions` resolved in `data/analytics.ts:158`), range | per set: `calculateSetLoad` → `resistance +=` (`:322-326`); steps with `resistance ≤ 0` skipped (`:329`); mapped steps split via `distributeBasisPoints` (`:345`); unmapped kept verbatim (`:334-339`); region shares `allocateExact(10000, region loads)` (`:379-385`) | `MuscleHeatmap` (total/mapped/unmapped/regions) | gram-reps; shares bp |

**Invariants guaranteed by D:** `mapped + unmapped = total` (`:334,:341`); `Σ region loads =
mapped` (every part of every mapped step lands in exactly one region, `:350`); `Σ shareBp =
10000` exactly when ≥ 1 region has load, else 0 (`:379-385`); `Σ region.exercises = region
load` (`:357`). `shareBp` is a share of **mapped** load (`:245-246`).

**Caller:** `MuscleScreen.tsx:67`.

### E. Weekly aggregation (Home dashboard)

| Function | Location | Formula | Notes |
|----------|----------|---------|-------|
| `sevenDayBuckets` | `data/dashboard.ts:55` | 7 empty local-day buckets, oldest → newest | `dayStartMs` via `startOfLocalDay` |
| `loadDashboard` | `data/dashboard.ts:71` | fetch ≤ `WEEK_TAKE = 120` newest completed sessions (`:13`, `:75-78`); per-session Σ via `calculateSetLoad` (`:102-116`); week membership `[todayStart−6d, todayStart+24h)` (`:118-121`, `:144`); week Σ (`:145-148`); daily bucket fill by `startOfLocalDay(ts)` (`:149-153`) | gram-reps; only `isCompleted === 1` logs (`:103`); active sessions excluded by query |
| Weekly chart source | `athlete.ts:91` via `LoadScreen.tsx:120` | 8 × 7-day windows | gram-reps/week |

**Caller:** `HomeScreen.tsx:57` → displayed at `:144` (week volume), `:160-164` (daily bars).

### F. Historical aggregation / records / comparison

| Function | Location | Formula | Units |
|----------|----------|---------|-------|
| `calculateDateRangeLoad` (A4) | `load.ts:175` | Σ session loads in local-calendar range | gram-reps |
| `calculateWindowTotals` (C) | `trends.ts:52` | Σ set loads in window | gram-reps |
| `compareSessions` / `sideOfSets` | `compare.ts:103 / :64` | per-side Σ A1 (`:76-77`), best weight/reps, `estimate1rmGrams` (`:83`); `volume = descriptiveDelta(current, previous)` (`:140`); per-exercise `volumeDeltaGramReps` (`:119`) | gram-reps, grams |
| `prEvents` / `exercisePrs` | `records.ts:94 / :118` | running maxima over completed sets (bests, never sums) | grams / reps / ms / mm |
| `estimate1rmGrams` | `records.ts:51` | Epley `weight × (1 + reps ÷ 30)` (`:54`) | **grams (1RM estimate — not volume, never added into any volume total)** |

---

## §18.2 Units pipeline (grams → kg → calc → aggregation → UI)

1. **Input:** user enters kg → `kgToGrams` (`src/utils/units.ts:3`, `Math.round(kg*1000)`) →
   persisted as integer `set_logs.weightGrams` (g). Reps/duration/distance: reps, ms, mm.
   No floats persisted (`units.ts:1`, DECISIONS D-019 `docs/DECISIONS.md:547-556`).
2. **Calculation:** `calculateSetLoad` multiplies integer grams × integer reps → integer
   gram-reps (`load.ts:90`). RIR, distance, equipment and prescription fields are absent
   from the signature (`load.ts:8-15`).
3. **Aggregation:** only integer addition (A2→A3→A4, C windows, D heatmap) — no
   intermediate unit conversion anywhere, so `Σ sets = Σ exercises = Σ sessions =
   Σ windows = Σ date ranges` by construction. Muscle splitting uses integer
   largest-remainder math (`muscles.ts:166-193`), preserving exact totals.
4. **Display:** exactly one conversion at the render edge:
   `gramRepsToKgReps = Math.round(g/100)/10` (`load.ts:196`) → **kg·reps**
   (one decimal). Weight-only values use `formatKg`/`/1000` (`units.ts:13`,
   `CompareScreen.tsx:90,112`); volume deltas use `/1000` (`CompareScreen.tsx:80,219`) —
   same kg math, see §18.6 O3.
5. **Double-conversion guard:** test *"40000 g × 5 reps × 3 sets converts once to 600
   kg·reps, never 0.6"* proves `gramRepsToKgReps(600 000) = 600`, while a second
   application collapses it to `0.6` — therefore conversion must occur exactly once.
   Verified: every render site (`HomeScreen:144,164`, `LoadScreen:61,64,171,212,216,250,262`,
   `MuscleScreen:121,160,183,201`, `CompareScreen:63,64,193`, `HistoryDetailScreen:208`,
   `WorkoutScreen:844`) converts raw gram-reps once and never feeds a converted value back.

## §18.3 Conservation rules

| Rule | Statement | Where guaranteed | Test |
|------|-----------|------------------|------|
| C-1 | Set sums = exercise sums = session sums (performed volume only; incomplete sets excluded) | `load.ts:84, 107-118, 145-149` | `volumeAudit.test.ts` — "session A/B: set sums = exercise sums = session sum" |
| C-2 | Session sums = date-range sums = window sums = rolling/weekly sums | `load.ts:175-193`, `trends.ts:52-81`, `athlete.ts:38-47, 91-110` | "Σ sessions = date-range sum = 28d window sum = rollingSummary sum", "adjacent 7d windows … weeklySeries buckets sum to the total" |
| C-3 | Resistance (gram-reps) and duration (ms) never convert into each other; timed sets add 0 kg (D-019) | `load.ts:87-93`, `muscles.ts:328-329` | "empty and duration-only inputs never fabricate tonnage", "timed-only and bodyweight-only steps contribute zero volume" |
| C-4 | Adjacent windows partition time: half-open `[start, end)`, `previous.endMs === current.startMs` — no double count, no loss | `load.ts:79,178`, `trends.ts:23-40` | "weekly aggregation across the week boundary …", "adjacent 7d windows …" |
| C-5 | Muscle parts sum exactly to the source load; region shares sum exactly to 10000 bp (when any region has load) | `muscles.ts:163-213, 379-385` | "muscle heatmap total equals window totals; mapped + unmapped = total; region shares sum to exactly 10000 bp", "distributeBasisPoints parts sum exactly…" |
| C-6 | RIR is not an input to any load formula | `load.ts:8-15` (no field), `load.ts:90` | 4 RIR tests (§18.4) |
| C-7 | Display conversion is applied once and never re-enters storage values | `load.ts:196` + render sites | "converts once to 600 kg·reps, never 0.6" |

## §18.4 Scenario results (ground truth)

| Claim | Expected | Actual code path | Result |
|-------|----------|------------------|--------|
| 3 × 40 kg × 5 reps | 600 kg·reps | A1 → A2 → A3: `40 000 × 5 × 3 = 600 000` gram-reps → A5 → **600** | ✅ (tests: ground truth #1-#2) |
| Same with RIR 2 per set | still 600 kg·reps | `rir` never read: `40 000 × 5 × 3 = 600 000` at set/exercise/session/date-range/window/rolling/heatmap/compare levels | ✅ (tests: ground truth #3-#4, reject #1-#3) |
| RIR reject patterns | no result = `w×reps×RIR` (1 200 000) or `w×(reps+RIR)` (840 000) | every tested function returns exactly 600 000; per-set 200 000 ≠ 280 000, ≠ 400 000 | ✅ |
| Prescribed 3 × 40 × 5–8 vs actual 5+6+8 | performed = 760 kg, NOT 960 kg | `40 000 × (5+6+8) = 760 000` gram-reps = 760 kg·reps; phantom `40 000 × 8 × 3 = 960 000` absent | ✅ |
| Prescribed volume function | does not exist | source scan (§18.1-B) | ✅ N/A |
| Multi-session conservation | all levels equal | fixture: 2 sessions × 2 exercises, variable weights/reps, +1 incomplete +1 timed set → 5 220 000 gram-reps at every level | ✅ |
| Muscle conservation | see C-5 | mapped 4 010 000 + unmapped 1 210 000 = 5 220 000; `Σ shareBp = 10000` | ✅ |

## §18.5 Edge matrix coverage

| Edge case | Test (in `src/analytics/volumeAudit.test.ts`) | Property asserted |
|-----------|-----------------------------------------------|-------------------|
| One set | *a single set contributes exactly its own load* | 200 000 gram-reps = 200 kg·reps, 1 resistance set |
| Variable reps | *variable reps and variable weight sum exactly* | 5+6+8 style mix → exact Σ |
| Variable weight | same | 40k/42k/38k × reps → 798 000 exactly |
| Zero / empty set | *empty and duration-only inputs never fabricate tonnage* | `[] → 0`; timed sets: resistance 0, duration 90 000 ms, `resistanceSetCount = 0` |
| Duration-only window | same | window resistance 0, duration 60 000 |
| Bodyweight / no equipment | *bodyweight / no-equipment sets … hasResistance false* | `weightGrams: null` or `0` → `hasResistance false`, 0 gram-reps; incomplete set → 0 |
| Bodyweight in heatmap | *timed-only and bodyweight-only steps contribute zero volume* | total 0, no regions, `totalExerciseCount 0` |
| Large values | *large values (500 kg × 20 reps × 10 sets) stay exact integers* | 100 000 000 gram-reps, `Number.isInteger`, display 100 000, muscle split conserves |
| Week boundary | *weekly aggregation across the week boundary splits sessions* | fixed-clock `currentWindow/previousWindow(now, 7)`: days 0+6 vs 7+13, adjacent windows, each session counted exactly once (clock patterned on `trends.test.ts` `localNoon`) |
| Month boundary | *historical aggregation across a month boundary* | fixed clock 2026-09-26: 28d window (starts Aug 30) keeps 2026-09-20, drops 2026-08-15; wide range keeps both; 8 weekly buckets Σ conserved |
| Dashboard: zero data | *dashboard with zero data: seven empty buckets* | all buckets 0, no fabricated volume |
| Dashboard: single data point | *dashboard single data point* | week = daily-bucket Σ = recent-entry = 600 000 |
| Unit conversion | *converts once to 600 kg·reps, never 0.6* | single application; double application = 0.6 (guard); round-trip ×1000 exact |
| RIR (4 tests) | ground truth #3-#4, reject #1-#3 | see §18.4 |
| Prescribed vs performed (2 tests) | prescribed vs performed describe | see §18.4 |
| Conservation (6 tests) | unit conservation describe | see §18.3 |
| Muscle conservation (3 tests) | muscle describe | see §18.3 |

## §18.6 Observations (non-blocking; no volume totals affected)

- **O1 — `avgLoadPerSetGramReps` doc-comment vs denominator.** The contract comment says
  "resistanceGramReps ÷ completed **resistance** sets" (`src/analytics/athlete.ts:24-25`)
  while the implementation divides by `completedSetCount` — all completed sets, including
  timed ones (`athlete.ts:59`). With mixed sessions the two readings differ (600 000 ÷ 4 =
  150 000 vs ÷ 3 = 200 000). This is a *per-set average*, not a volume total: no volume
  aggregation uses it, and it is currently not rendered anywhere (LoadScreen only renders
  `sessionsPerWeek`/`avgSetsPerSession`, `LoadScreen.tsx:237,242`). Current behavior is
  pinned by the test *"documents rollingSummary.avgLoadPerSet denominator: all completed
  sets (see VOLUME_AUDIT §18.6)"*. **Recommendation:** align the comment with the behavior
  (or switch the denominator to `resistanceSetCount` if/when the metric ships to UI).
  Not classified as a volume bug: every volume total in §18.1 is unaffected.
- **O2 — dashboard week end boundary.** `data/dashboard.ts:144` uses a fixed
  `todayStart + 24·3600·1000` end bound, whereas trends/load windows derive boundaries with
  `setDate` (`trends.ts:26-28`). On DST-transition local days the dashboard week window can
  drift by ≤ 1 hour (same class of drift tolerated in `trends.test.ts:85-92`). No volume is
  fabricated or double-counted in either direction; noted for future alignment.
- **O3 — mixed kg formatting for volume deltas.** `CompareScreen.tsx:80,219` format volume
  deltas as `value / 1000`, other sites use `gramRepsToKgReps` (1-decimal rounding). Same
  kg·reps math, cosmetic rounding difference only. `CompareScreen.test.tsx:96-97` asserts
  the kg·reps presentation.
- **O4 — locale dictionaries.** The working tree (pre-existing i18n workstream, not part of
  this audit) adds `strings.en.ts`/`strings.es.ts` behind the `strings.ts` proxy. Both
  locales use *Volume*/*Volumen* + `kg·reps` (`strings.es.ts:54,204,268,281,434,461-464`).

## §18.7 UI terminology check

Grep of UI + strings for volume presentation:

| Surface | Label | Unit | Site |
|---------|-------|------|------|
| Home week metric | `home.weekVolume` = "Volume" | `strings.load.kgReps` = "kg·reps" | `HomeScreen.tsx:143-145`; `strings.ts:49` |
| Home daily chart | `home.chartCaption` = "Daily volume · kg·reps" | in caption | `strings.ts:52`; conversion in `format` `HomeScreen.tsx:164` |
| Session summary (workout) | `history.volume` = "Volume" | kg·reps | `WorkoutScreen.tsx:843-845`; `strings.ts:199` |
| History detail | `history.sessionLoad` = "Session load" + "Volume"-scoped lines | kg·reps | `HistoryDetailScreen.tsx:208` |
| Compare | `compare.volume` = "Volume" | `compare.kgRepsUnit` = "kg·reps" | `CompareScreen.tsx:74-80`; `strings.ts:262,275` |
| Training load | `load.title` = "Training load"; totals under `load.completedSets`/`load.resistance` | kg·reps | `LoadScreen.tsx:167-174`; `strings.ts:426` |
| Weekly chart | `load.rhythm.weekly*` = "Weekly volume … kg·reps" | kg·reps | `strings.ts:454-456`; `LoadScreen.tsx:262-265` |
| Density | `load.rhythm.density` = "Work / minute" | `densityUnit` = "kg·reps/min" | `strings.ts:452-453`; `LoadScreen.tsx:250-252` |
| Muscle heatmap | `muscles.mappedLoad` (scoped: *mapped* load) | kg·reps | `MuscleScreen.tsx:118-121` |

Findings:

- **No "Tonnage" label exists anywhere** (repo-wide grep: only code comments in
  `load.ts:4,195` and test names use the word).
- **No volume figure is ever labeled with bare "kg"** — volume pairs always carry
  "kg·reps"; bare "kg" is used only for weight/1RM (`CompareScreen.tsx:90,112`,
  `RecordsScreen.tsx:34`, `history` set rows).
- Volume is always computed from **performed** sets only; the label "Volume" therefore
  always means *performed external-load volume*, never prescribed or target volume.
- **Verdict on terminology:** the current terminology — label **"Volume"** + unit
  **"kg·reps"** (ES: "Volumen" + "kg·reps") — is accurate, internally consistent and
  unambiguous about units. It is **appropriate**; no label is actively misleading.
  Per the audit rules, **no strings were changed** (`src/constants/strings.ts` untouched by
  this audit). Optional UX improvement (not required): a one-line help text defining
  Volume = Σ(weight × reps) of completed sets.

---

## Verification

- `npx jest src/analytics/volumeAudit.test.ts` → **1 suite, 29/29 tests pass**.
- `npx jest --silent` → **53 suites, 722 tests, 0 failed** (stated baseline 673/49 plus a
  pre-existing, not-audit-authored i18n/settings workstream in the working tree adding
  20 tests / 3 suites; this audit adds 29 tests / 1 suite).
- `npm run typecheck` (`tsc --noEmit`) → exit 0.
- Files changed by this audit: `docs/VOLUME_AUDIT.md` (new), `src/analytics/volumeAudit.test.ts`
  (new). No production code, no strings, no UI files modified.

VERDICT: NO BUG — calculation is correct; UX/terminology improvement recommended
