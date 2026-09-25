# Architecture & Tooling Decisions

Deliberate deviations from the frozen MVP v4 plan, with rationale and evidence.
Each entry is immutable history: later changes append, they do not rewrite.

---

## D-001 — WatermelonDB 0.27.1 → 0.28.0 (Day 1, 2026-09-23)

**Status:** Accepted

**Context.** The frozen MVP v4 stack pinned `@nozbe/watermelondb` to **0.27.1**.
Day 1 requires a real signed release APK (T1.4) and native validation of the
database (T1.3). The project runs **React Native 0.83.10** (Expo SDK 55) with
the New Architecture (bridgeless) enabled.

**Problem.** WatermelonDB 0.27.1's Android JSI module is built on
`com.facebook.react.bridge.JSIModulePackage`, an API **removed in React Native
0.81+**. With RN 0.83 the release build fails hard in two places:

1. `:watermelondb-jsi:compileReleaseJavaWithJavac` —
   `error: cannot find symbol  import com.facebook.react.bridge.JSIModulePackage;`
2. `:app:compileReleaseKotlin` —
   `MainApplication.kt:6:34 Unresolved reference 'JSIModulePackage'`
   (the wiring injected by `@morrowdigital/watermelondb-expo-plugin` 2.3.3 uses
   the same removed API).

Evidence: `.tooling/release-build.failed-wmdb027.log`,
`.tooling/release-build.failed-appkotlin.log` (local, gitignored).

**Decision.** Upgrade `@nozbe/watermelondb` to **0.28.0** (2025-04-07), which
ships a bridgeless/New-Architecture compatible JSI layer: the package is a
plain `ReactPackage` whose `WMDatabaseJSIBridge` native module exposes a
synchronous `install()` (reanimated-style). A small config plugin,
`plugins/withWatermelonJsiFix.js`, removes the dead import injected by the
morrow plugin and registers `WatermelonDBJSIPackage` in the app `PackageList`.

**Consequences.**

- Engine, schema, models, writer actions (`DbActions`) and all MVP v4
  semantics are untouched — only the driver version changes.
- Verified on device (Samsung Galaxy A04, SM-A045M, release APK):
  JSI binding active (`globalThis.nativeWatermelonCreateAdapter === true`),
  create/write/read against real SQLite, `cursor_json` roundtrip, persistence
  across process restart (`adb force-stop` + relaunch).
- Full Jest suite (26/26) and `tsc --noEmit` stay green on 0.28.0.
- MVP v4 plan should be updated to pin 0.28.0 going forward.

**Rejected alternatives.**

- *Patching 0.27.1 locally* — maintaining a fork of the native JSI layer is
  exactly the kind of drift the frozen plan tries to avoid.
- *Fallback to `expo-sqlite`* — pre-authorized by the plan, but unnecessary:
  WatermelonDB itself was never broken, only its RN 0.83 compatibility.

---

## D-002 — Minimal stack navigator instead of React Navigation (Day 2, 2026-09-24)

**Status:** Accepted

**Context.** Day 2 introduces the first real screen graph
(Home → Exercises/Routines → editors). The Day 1 app is a single screen with
no navigation dependency installed.

**Decision.** Ship a ~70-line state-based stack navigator
(`src/ui/navigation.tsx`) instead of adding `@react-navigation/*`.

**Consequences.**

- Zero new JS/native dependencies → no `expo prebuild`/native rebuild required
  for Day 2 (JS-only checkpoint validation stays fast).
- Android hardware/system back is handled by a single `BackHandler`
  subscription with a per-screen interceptor hook (editors use it to guard
  unsaved changes); stack depth > 1 pops, depth 1 defers to the OS.
- Screens are remounted on every push/pop, which naturally re-reads
  WatermelonDB on return (no focus-refetch plumbing).

**Rejected alternatives.**

- *React Navigation (native-stack)* — correct for larger apps, but adds JS
  packages plus a native rebuild for a 5-route MVP graph.
- *Tab navigator* — the Day 2 map is a hub-and-spoke tree, not tabs.

---

## D-003 — Routine editor save strategy: replace-children (Day 2, 2026-09-24)

**Status:** Accepted

**Context.** The editor edits an in-memory draft
(`src/types/draft.ts`) and must persist blocks → steps → prescriptions →
transitions with stable ordering.

**Decision.** `saveRoutineDraft` writes inside a single WatermelonDB writer:
upsert the routine row, `markAsDeleted` the previous children, then recreate
the full tree from the draft with fresh `sort_order` indexes.

**Consequences.**

- Save is atomic and ordering is trivially deterministic; no diff/reconcile
  logic between draft and store.
- Safe because nothing durable references step/block ids: sessions store an
  immutable `definition_json` snapshot taken at start, and `routines.id` is
  preserved across saves. `block_transitions.to_step_id` is written as `null`
  (implicit forward/loop target), so no cross-save step-id edges exist.
- Cost: child row ids change on every save — acceptable until Day 3+ shows a
  need for stable step ids (e.g., per-step notes).

---

## D-004 — Application layer fills `lastReversible.setLogId` after LOG_SET (Day 3, 2026-09-24)

**Status:** Accepted

**Context.** The pure engine emits `LOG_SET` with `setLogId: null` on the
cursor's `lastReversible` (the engine must not know about WatermelonDB ids).
`UNDO_LAST` later emits `VOID_LAST_SET` carrying `lastReversible.setLogId`, so
the id must be attached between those two events.

**Decision.** `DbActions.applyEffects` returns the (possibly patched) cursor:
after creating a `set_logs` row for a `LOG_SET` whose coordinates match
`cursor.lastReversible`, it writes the real row id into `lastReversible.setLogId`
and returns that cursor. `src/workout/runner.ts` persists the returned cursor
via `persistCursor` / `completeSession`.

**Consequences.**

- UNDO can void the correct log without an event-sourcing log of ids.
- Callers of `applyEffects` must use its return value (not the pre-call cursor)
  when persisting — enforced by the Day 3 runner and covered by
  `src/workout/workout.test.ts`.
- Timer / notification effects remain outside the DB writer (runner side
  effects); nested `db.write` deadlock risk is unchanged (still forbidden).

---

## D-005 � Android timer notifications: date-trigger accuracy + cancel-all fallback (Day 4, 2026-09-24)

**Status:** Accepted

**Context.** Day 4 schedules local rest/block-timer notifications via
`expo-notifications` `scheduleAsync({ trigger: { type: 'date', value } })`.
Permission is requested lazily on first schedule (not at startup) to avoid a
cold-start prompt. After process death the in-memory notification id map is
gone, so recovery cannot rely on remembered ids alone.

**Decision.**

1. **Reconcile on every runtime load / AppState resume.** The runner exposes
   `reconcileTimerNotification(sessionId, timer, now)`: if the persisted
   cursor timer is null or already expired ? cancel only; if live ? cancel any
   prior notification then schedule a fresh one. Fresh schedule produces a new
   OS id, so stale alarms from previous lives are superseded or cancelled by
   `cancelAllScheduledNotificationsAsync` when the prior id is unknown.
2. **Cancel falls back to `cancelAllScheduledNotificationsAsync`** when the
   in-memory id is missing (post-death) � safe because the app only ever
   schedules timer notifications for a single active session.
3. **Date-trigger inexactness accepted:** Android may batch/delay exact date
   triggers (and battery optimizations can worsen this). The notification is
   never the source of truth: UI and `TIMER_EXPIRE` dispatch always recompute
   from `cursor.timer.expiresAt`.

**Consequences.**

- No false dual-timer system; notification drift cannot desync state.
- User may see the rest notification slightly late on some OEMs (Samsung
  included) without `SCHEDULE_EXACT_ALARM` � deferred to a later day if
  field reports show material delay.
- Device validation for notification delivery was **not** performed (device
  PIN-locked); Day 5 must not claim on-device notification verification.

---

## D-006 � Soft-deleted (discarded) sessions must not load by id (Day 5, 2026-09-24)

**Status:** Accepted

**Context.** `discardWorkout` soft-deletes the `workout_sessions` row via
`markAsDeleted`. WatermelonDB `Model.find(id)` still returns records with
`_raw._status === 'deleted'`, so `loadWorkoutRuntime(sessionId)` could hand a
discarded session back to the UI after discard (covered by Day 5 edge-case
tests).

**Decision.** `loadWorkoutRuntime` returns `null` when the row's raw status is
`deleted` (or `find` throws). Queries that already exclude deleted rows
(`getActiveSession`, History) are unchanged.

**Consequences.**

- Discarded sessions cannot be resumed or shown by id; `loadActiveWorkout`
  remains the only active-session entry point.
- No schema change; pure application-layer guard.

---

## D-007 � Offline CSV/JSON export via React Native Share (Day 5, 2026-09-24)

**Status:** Accepted

**Context.** v0.1 needs export without cloud dependencies. `expo-sharing` is
not installed; `Share.share` is built into React Native and opens the Android
share sheet offline.

**Decision.**

- Pure builders in `src/export/export.ts` (RFC 4180 CSV, structured JSON with
  raw integer units + display kg/s in CSV).
- UI on History list calls `shareCsvExport` / `shareJsonExport`
  (`src/export/share.ts`), which load completed sessions only and pass the
  payload to `Share.share`. No filesystem write, no network, no DB mutation.

**Consequences.**

- Zero-activity history ? header-only CSV / empty JSON sessions array (no fake rows).
- Future file-based share can swap the transport without touching builders.

---

## D-006 � Discarded sessions are not resumable by id (Day 5, 2026-09-24)

**Status:** Accepted

**Context.** WatermelonDB soft-deletes (`markAsDeleted`) keep the row readable
via `find(id)` with `_status: deleted`. `loadWorkoutRuntime` therefore returned
a discarded session as if it were live, so a stale id could resurrect a
discarded workout in tests (and theoretically after UI races).

**Decision.** `loadWorkoutRuntime` returns `null` when the raw row status is
`deleted` (or `find` throws). Active-session queries still use
`session_status='active'` and never see discarded rows.

**Consequences.**

- Discard is final for resume-by-id; History only shows `completed` sessions.
- Covered by `src/workout/day5.test.ts` ("discard active session�").

---

## D-008 — Tempo Trainer: ephemeral, timestamp-based, outside the workout engine (Phase 2B, 2026-09-24)

**Status:** Accepted

**Context.** Prescriptions already store four integer tempo phases
(`tempo_eccentric_ms`, `pause_bottom`, `concentric`, `pause_top` →
`TempoSpec` on the definition snapshot). Phase 2B turns that data into an
execution aid without becoming a second session engine.

**Decision.**

1. **Ephemeral runtime.** `TempoRuntime` lives only in WorkoutScreen React
   state (`src/tempo/tempoTrainer.ts`). Process death or navigation cancels
   the aid; the workout `cursor_json` is untouched. No schema change, no
   second persistence system.
2. **Timestamp authority.** Phases are derived from `startedAt` +
   integer-ms offsets; remaining is always `phaseEndsAt - Date.now()`.
   Background/resume re-samples absolute time (no drift, no blind restart).
   A 100ms interval only refreshes the visual countdown.
3. **Separate from engine/runner.** Tempo never dispatches `EngineEvent`,
   never writes `set_logs`, never advances blocks/steps/rounds. REST and
   AUTO_ADVANCE remain the only persistent timers with OS notifications.
   Rest timer starting cancels any active tempo.
4. **Feedback adapters.** Haptics use React Native `Vibration` (no
   `expo-haptics` dependency); keep-awake uses transitive `expo-keep-awake`
   via dynamic require. Both are fail-soft. Audio deferred (no local cue
   assets / `expo-av` in the stack yet).

**Consequences.**

- Athlete intentionally starts tempo from the set card; completion returns
  control so COMPLETE SET still uses the existing `LOG_SET` path.
- Zero-duration phases are skipped; all-zero tempo never starts.
- Future Interval Engine (EMOM/HIIT) must remain a third system: it would
  own work/rest cycles and auto-logging, not tempo phases and not REST
  transitions — only the pure "timestamp phase list → tick" pattern is
  reusable.

**Rejected alternatives.**

- *Persist tempo in `cursor_json`* — intra-set aid is not workout truth;
  recovering it after process death adds complexity with no athlete value.
- *expo-haptics / expo-audio* — unnecessary native surface for restrained
  pulses and optional cues in this phase.

---

## D-009 — Interval Engine: pure module + interval block programming (Phase 2C, 2026-09-24)

**Status:** Accepted

**Context.** Phase 2C adds EMOM / HIIT / glycolytic-style protocols without
turning intervals into a second workout engine.

**Decision.**

1. **Pure interval engine** in `src/interval/intervalEngine.ts`: validates a
   declarative `IntervalConfig` (mode, workMs, restMs, rounds, periodMs?,
   preparationMs?), runs timestamp-based phases (`startedAt` + offsets),
   emits `PHASE_START` / `ROUND_START` / `INTERVAL_COMPLETE` only.
2. **Specialized block kind** `interval` on `routine_blocks` (optional
   `interval_json` column, schema **v1→v2**, one `addColumns` migration).
   `block.rounds` pinned to 1 for interval blocks — the engine owns protocol
   rounds; the workout engine still only advances block/step position.
3. **EMOM fixed clock.** Round n starts at `prepEnd + (n−1)×periodMs`.
   Early work completion enters a wait until the minute boundary; it never
   re-anchors the next round. Skip during wait jumps to the boundary.
4. **HIIT / glycolytic linear timeline.** work → rest → … → final work
   (no trailing rest). Prep is optional and timestamp-based.
5. **Integration.** WorkoutScreen shows the interval card on an interval
   block; completion dispatches existing `SKIP_STEP` (no `LOG_SET`).
   Active runtime optionally persists as `cursor.interval` for process-death
   re-sample; corrupt payloads are discarded by `parseCursor`.
6. **No pause button** (v1): pause is ambiguous on a fixed EMOM clock;
   cancel/restart/skip are deterministic.

**Consequences.**

- Interval never writes set_logs, never owns REST/AUTO notifications.
- Schema v2 is minimal (one optional column); migration tests updated.
- Future Tabata-like protocols fit as another `mode` without engine rewrite.

**Rejected alternatives.**

- *Standalone conditioning sessions* — would invent a second session type.
- *Persist phases inside engine events* — would couple UI cadence to the
  workout engine.

---

## D-010 — Keep-awake ownership: promote expo-keep-awake + tag locks (Phase 2C, 2026-09-24)

**Status:** Accepted

**Context.** Phase 2B used a transitive `expo-keep-awake` via dynamic
require with a single tempo latch. Intervals add a second concurrent holder.

**Decision.**

1. Promote `expo-keep-awake@~55.0.8` to a **direct** dependency (Expo SDK
   55 supported package; already present transitively — lockfile stays
   consistent).
2. Shared tag locks in `src/ui/keepAwake.ts`:
   `apexfoss-tempo` and `apexfoss-interval` activate/release independently
   so one feature never drops the other feature's wake lock.
3. Fail-soft if the native module is unavailable (Jest/node).

**Consequences.**

- Deterministic dependency resolution; no reliance on accidental transitive
  exposure.
- Unmount / cancel / complete / rest-precedence release the owning tag only.

**Rejected alternatives.**

- *Shared boolean latch* — would let tempo cancel interval's keep-awake.
- *Leave transitive-only* — fragile across Expo upgrades.

---

## D-011 — Audio deferred for interval cues (Phase 2C, 2026-09-24)

**Status:** Accepted

**Context.** The stack has no `expo-audio` / `expo-av` and no local cue
assets. Adding audio would require a native rebuild and asset packaging for
non-essential feedback.

**Decision.** **Defer audio.** Interval uses fail-soft RN `Vibration`
patterns (prep/work/rest/round/complete). The pure engine does not depend
on any feedback adapter.

**Consequences.**

- Correctness never requires audio or hardware vibration.
- A later phase can add local tones without touching interval timing.

**Rejected alternatives.**

- *expo-audio now* — disproportionate native surface for optional cues.
- *Speech synthesis* — non-deterministic, larger dependency, accessibility
  noise.

---

## D-012 — Portable routine format `apexfoss-routine` v1 (Phase 2D, 2026-09-24)

**Status:** Accepted

**Context.** Offline portability requires a versioned, deterministic,
checksummed routine interchange that is independent of Watermelon IDs and
schema internals.

**Decision.** Ship format `apexfoss-routine` / `formatVersion: 1` with:
canonical JSON (sorted keys, integers only), semantic checksum
`sha256(canonical({routine, exercises}))` excluding `exportedAt`/`producer`
metadata, package-local exercise keys `e1,e2…` assigned by first-use order
across blocks/steps, and strict untrusted validation before any DB write.
Transport: base64url of the package JSON; deep link
`apexfoss://import?d=<payload>`; ceiling `MAX_PORTABLE_PAYLOAD_BYTES = 2000`.

**Consequences.**

- Same logical routine always yields the same checksum on any device.
- Checksum detects corruption only — not authentication (documented).
- Import always creates a NEW routine; name collisions get
  `Name (imported)` / `Name (imported 2)`.

**Rejected alternatives.**

- *Raw Watermelon dump* — couples portable files to schema/ids.
- *SQLite file copy* — not logical, not portable across schema versions.

---

## D-013 — Exercise identity on import (Phase 2D, 2026-09-24)

**Status:** Accepted

**Context.** Imported packages reference exercises that may or may not exist
locally.

**Decision.** Match key =
`name.trim().toLowerCase().replace(/\s+/g,' ')|category|equipment|metricFlags`.
Reuse the first local match; otherwise create a new exercise. Preview shows
matched vs new counts before confirm.

**Consequences.**

- No accidental duplicates for equivalent exercises.
- Deliberately different equipment/category create distinct rows.

---

## D-014 — Backup format `apexfoss-backup` v1 (Phase 2D, 2026-09-24)

**Status:** Accepted

**Context.** Full-device offline backup/restore without shipping SQLite files.

**Decision.** Logical backup `apexfoss-backup` / `formatVersion: 1` containing
`exercises`, `routines` (portable blocks), `sessions` (definitionJson +
cursorJson as-is), `sessionExercises`, `setLogs`, plus `schemaVersion ≤ current`
and `checksum = sha256(canonical(data))`. Restore policy is FULL REPLACE after
complete validation and explicit UI confirmation. Compensating snapshot
rollback restores pre-restore rows if any mid-restore write fails (LokiJS
tests and SQLite).

**Consequences.**

- Active sessions restore with definition/cursor intact (resume works).
- Restore never runs without confirmation; never without checksum verify.
- Internal Watermelon metadata is never exported.

---

## D-015 — QR capacity vs deep-link size (Phase 2D, 2026-09-24)

**Status:** Accepted

**Context.** Pure-TS QR encoder implements byte mode EC level M versions 1–10
(max ≈213 data bytes). Deep-link transport allows up to 2000 bytes.

**Decision.** QR is best-effort for small payloads only. When
`fitsQr(deepLink)` is false, UI shows "Too large for QR — use Share instead"
and the user shares the JSON / deep link via the system share sheet. No
in-app camera; system camera scan of an apexfoss:// QR opens the app via the
registered scheme.

**Consequences.**

- Realistic multi-block routines often exceed QR capacity — Share remains the
  primary transfer path.
- No camera permission, no QR decode dependency.

**Rejected alternatives.**

- *Versions 11–40 encoder* — large correctness risk for MVP; cut order puts
  QR polish after core formats.
- *Compressed QR payload* — deferred with backup compression cut item.

---

## D-016 — Deep-link safety (Phase 2D, 2026-09-24)

**Status:** Accepted

**Context.** `apexfoss://import?d=…` can arrive from camera scans, links, or
intents. Payloads are untrusted.

**Decision.** Parse is data-transport only (`parseImportDeepLink`). Payload is
stashed in a module pending slot; PortabilityScreen fills the paste field;
user must Preview → Confirm before `importRoutinePackage` runs. No auto-import
on cold start or `url` event. No eval, no dynamic modules, no network.

**Consequences.**

- Malicious/corrupt links cannot mutate the DB without explicit confirm.
- Validation still rejects wrong format/version/checksum/dangling refs.

---

## D-017 — Checksum is integrity, not auth (Phase 2D, 2026-09-24)

**Status:** Accepted

**Context.** Portable packages and backups carry `sha256` hex digests.

**Decision.** Checksums detect accidental corruption and accidental edits.
They are **not** signatures, MACs, or proof of origin. No key material, no
asymmetric crypto in MVP.

**Consequences.**

- Documented clearly in UI/decisions; do not claim authenticity.
- A future phase may add signatures if trust models require it.

---

## D-018 — Scope cuts for Phase 2D (Phase 2D, 2026-09-24)

**Status:** Accepted

**Context.** Phase 2D scope risk: QR high versions, file associations,
compression, conflict UX.

**Decision.** Cut order applied: (1) QR limited to v1–10 with Share fallback,
(2) deep-link native scheme registered via `app.json` `"scheme": "apexfoss"`
+ prebuild (no manual AndroidManifest edits), (3) UI is functional not
polished, (4) backup stays uncompressed JSON, (5) duplicate routine policy is
deterministic suffix — no interactive merge UI. **Never cut:** format
versioning, validation, atomicity/rollback, checksum, tests.

**Consequences.**

- `.apexroutine` / `.apexbackup` file association deferred (documented).
- Interactive exercise-conflict merge deferred; suffix rename only.

---

## D-019 � Pure training load categories (Phase 2E, 2026-09-24)

**Status:** Accepted

**Context.** Athlete load intelligence needs historical volume metrics without
fabricating tonnage for timed/interval work.

**Decision.** `src/analytics/load.ts` is pure TS with integer units only:
resistance volume = weightGrams � reps (gram-reps), duration work = durationMs,
kept as separate categories. Incomplete sets contribute nothing. Date windows
today/7d/28d use local-calendar midnight semantics (`startOfLocalDay`).

**Consequences.**

- Interval/timed sets never inflate resistance volume.
- No DB/React in math � UI adapters in screens call pure functions.
- Display converts gram-reps ? kg�reps at the edge.

---

## D-020 � Inventory solver semantics (Phase 2E, 2026-09-24)

**Status:** Accepted

**Context.** Plate/load calculator must be deterministic and generic (no
hardcoded Olympic plates).

**Decision.** `solveLoadInventory` is bounded-knapsack DP over grams.
`LoadItem {name, weightGrams, quantity, perSide?}`; perSide contributes �2.
Tie-break: (1) exact over closest, (2) smallest |diff|, (3) prefer = target,
(4) fewer units, (5) ascending item index. Status: exact / closest /
impossible (no items and base < target).

**Consequences.**

- Same input always yields same allocation on any device.
- No persistence � inventory is a session tool.

---

## D-021 � RIR autoregulation is runtime-only and opt-in (Phase 2E, 2026-09-24)

**Status:** Accepted

**Context.** Autoregulation must never mutate routine definitions or historical
session snapshots.

**Decision.** Pure policy `recommendNextLoad` in
`src/analytics/autoregulation.ts`. Config: enabled, targetRir, stepGrams,
min/maxWeightGrams. Rules: actualRir < target ? +step; > target ? -step; equal
? hold; clamped reasons reported. WorkoutScreen holds ephemeral state only:
toggle (default OFF), pending suggestion keyed by next posKey, prefill weight
input, display suggestion card. No DB write, no definition_json change.

**Consequences.**

- Discarding/finishing session discards all autoreg state.
- Definitions and set_logs remain immutable history.

---

## D-022 � Readiness tap test: neutral score + personal baseline (Phase 2E, 2026-09-24)

**Status:** Accepted

**Context.** Readiness must avoid medical/CNS/injury language and must not
fabricate scores without history.

**Decision.** 10-second tap test via RN touch events + Date.now timestamps.
Baseline = rolling median of last up-to-10 prior tests; minimum 3 samples
before any score. Score = round(100 � current / baseline) clamped [0, 200];
deviation = percent vs baseline. Schema v3 adds `readiness_tests`
(tested_at, duration_ms, tap_count). Backup field `readinessTests` optional �
older backups restore as empty. Pure calcs in `src/analytics/readiness.ts`.

**Consequences.**

- No score before 3 prior tests (UI shows explanation).
- Migration v2?v3 is additive (createTable); migration tests updated to 10
  tables / 2 migrations / schemaVersion 3.
- Neutral language only: score, baseline, deviation.

---

## D-023 � Scope cuts for Phase 2E (Phase 2E, 2026-09-24)

**Status:** Accepted

**Context.** Phase 2E scope risk: charts, dashboards, gamification, extra
autoreg strategies, persistence for inventory.

**Decision.** Cut order: (1) no charts/dashboard/gamification � numeric cards
only, (2) autoregulation is RIR-only (no VBT/RPE/1RM/ML/HRV), (3) inventory
not persisted (in-session tool), (4) readiness baseline window fixed at 10
(not configurable in UI), (5) ACWR is not presented � 7d/28d loads exposed as
primitives only. **Never cut:** pure math modules, deterministic tie-breaks,
immutability of definitions/snapshots, schema migration tests, medical-language
guard, backup backward compatibility.

**Consequences.**

- Future phases can add presentation layers without touching math.
- No hidden heuristics � all autoreg constants live in AutoregConfig.

---

## D-024 - Controlled muscle vocabulary and contribution weights (Phase 2F, 2026-09-24)

**Status:** Accepted

**Context.** Muscle distribution needs a deterministic exercise-to-muscle
mapping. There is no medical anatomy requirement; the vocabulary must be
stable, testable and extendable.

**Decision.** Fixed 17-group training vocabulary (chest, upper_back, lats,
front_delts, side_delts, rear_delts, biceps, triceps, forearms, abs, obliques,
lower_back, glutes, quads, hamstrings, calves, adductors) defined in pure
`src/analytics/muscles.ts`. Every built-in exercise carries product
contribution weights as integer basis points summing to 10000 (e.g. Bench
Press: chest 6000, triceps 2500, front_delts 1500). Weights live next to the
seed catalog in `scripts/seed-exercises.ts` and are documented as product
decisions, not science.

**Consequences.**

- Vocabulary is closed and exhaustively tested (17 groups, all maps sum to
  10000, no unknown/duplicate muscles).
- Adding a muscle or remapping an exercise is a data-only change with test
  coverage already in place.

---

## D-025 - Mapping keyed by stable exercise identity, never display names (Phase 2F, 2026-09-24)

**Status:** Accepted

**Context.** Historical sessions reference exercises through definition
snapshots; renaming an exercise must not break history; custom exercises must
never be guessed.

**Decision.** Seeds are inserted with deterministic ids (`seed_bench_press`,
...) via `prepareCreateFromDirtyRaw`. Resolution order in
`resolveContributions`: (1) deterministic seed id, (2) exact portable record
key (name+category+equipment+metricFlags, normalized - the app's existing
import identity), (3) null. The record-key step covers installs seeded before
deterministic ids and backup/restore rows whose generated ids differ. Custom,
deleted or unknown exercises resolve to null (displayed as "Muscle data
unavailable"); no fuzzy matching, no display-name lookup, no ML/LLM.

**Consequences.**

- Renamed seed exercises keep their mapping on current installs (id path).
- Renamed legacy-install rows degrade safely to unmapped (never wrong data).
- Sessions recorded before a backup/restore may show unmapped muscle detail
  afterwards (old snapshot ids no longer resolve); new sessions are unaffected.
- Future manual classification can layer a user override map on top without
  touching the built-in catalog.

---

## D-026 - Muscle mappings are application metadata: schema stays v3 (Phase 2F, 2026-09-24)

**Status:** Accepted

**Context.** Mappings could be persisted as a new exercise column (schema v4 +
backup/restore changes) or kept as built-in application metadata.

**Decision.** No migration. Built-in mappings are derived from the seed
catalog at runtime (`muscleCatalog()` memoized in `src/data/analytics.ts`);
exercises table, backup format v1 and schemaVersion 3 are unchanged. Persisted
custom classifications (Exercise Editor muscle UI) are explicitly out of scope
and reserved for a future phase.

**Consequences.**

- All 359 pre-2F tests remain untouched and green; migration tests unchanged.
- Backup/restore and routine portability are unaffected.
- Custom user mappings require a future schema/backup decision.

---

## D-027 - Heatmap counts resistance volume only, with integer conservation (Phase 2F, 2026-09-24)

**Status:** Accepted

**Context.** Phase 2E established resistance (gram-reps) and duration (ms) as
separate units; tonnage must never be fabricated from timed work.

**Decision.** Muscle heatmap volume = completed resistance sets only
(weight x reps, gram-reps). Timed/interval work (Plank, Wall Sit, Rowing
Interval...) contributes no volume and is excluded from exercise/region counts;
duration is never converted to kilograms. Per-set distribution across muscles
uses largest-remainder integer allocation so region loads always sum exactly to
the source load; region shares are integer basis points summing to exactly
10000. Sets are attributed to every muscle an exercise engages (counts may
overlap regions; only loads are conserved).

**Consequences.**

- Conservation is property-tested across awkward totals (1, 999997, ...).
- Pure functions only - no DB/React imports in `src/analytics/muscles.ts`.

---

## D-028 - Local-calendar current/previous windows; chronic excludes current week (Phase 2F, 2026-09-24)

**Status:** Accepted

**Context.** Trend comparisons need unambiguous, testable date windows that
follow the app's local-calendar convention (spec section 16).

**Decision.** `currentWindow(now, days)` = today + preceding (days-1) local
calendar days (start local midnight, exclusive end = next local midnight);
`previousWindow(now, days)` = the equally long window immediately before it
(adjacent, no gap, no overlap). Current week = 7 days, current month-ish = 28
days; the chronic baseline uses only `previousWindow(28)` and therefore never
contains the current acute week. Session timestamps use endedAt ?? startedAt
with half-open [start, end) membership.

**Consequences.**

- Boundary behavior (midnight edges, DST drift) is covered by tests.
- All windows are reusable primitives; screens pass `Date.now()` once per
  render.

---

## D-029 - Descriptive 7d / 28d load ratio without interpretation (Phase 2F, 2026-09-24)

**Status:** Accepted

**Context.** An ACWR-style ratio is requested as a math foundation, but any
medical/risk framing (zones, colors, "injury risk", "overtraining") is out of
scope.

**Decision.** `calculateLoadRatio(current7, previous28, previous28Sessions)`
returns status 'ok' | 'no_baseline' | 'zero_baseline' with ratio rounded to 2
decimals: ratio = acute weekly load / (previous 28-day load / 4). No baseline
sessions yield 'no_baseline' (insufficient baseline); baseline sessions
without resistance load yield 'zero_baseline'; both render as explicit
unavailable messages, never Infinity/NaN. UI label is the neutral "7d / 28d
load ratio"; no risk zones, colors or advice.

**Consequences.**

- Ratio is a pure primitive - future phases can add presentation without
  touching the math.
- Hostile inputs (0, negative, NaN, Infinity) are property-tested to stay
  finite or null.

---

## D-030 - Single normalized analytics snapshot + Phase 2F scope cuts (Phase 2F, 2026-09-24)

**Status:** Accepted

**Context.** Load, trends and muscle screens must not run N+1 queries or
per-muscle DB reads, and Phase 2F scope must stay bounded.

**Decision.** `loadAnalyticsSnapshot(db)` performs a fixed number of batched
queries (exercises, completed sessions, session_exercises, set_logs) and
resolves muscle mapping once per step; screens feed the result into pure
aggregations and render once (never on the 100ms timer tick). LoadScreen now
uses this snapshot (same aggregate semantics as before). Cut order for 2F:
(1) no SVG/chart libraries - structured grid with RN-native bars, (2) no
4-week bar chart, (3) no persisted custom mapping / Exercise Editor muscle UI,
(4) no History-detail muscle breakdown (session load card untouched), (5) no
drill-down navigation stack - detail expands inline. **Never cut:** pure
math, deterministic mapping, unmapped safety, window semantics, ratio edge
cases, tests, backup compatibility, existing functionality.

**Consequences.**

- 68 new tests (427 total) cover mapping, conservation, windows, ratio edge
  cases, loader data quality and UI/navigation.
- Future phases can add history-detail breakdown or custom mappings as
  additive work on top of the same snapshot.
