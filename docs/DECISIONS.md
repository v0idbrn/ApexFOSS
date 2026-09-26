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

---

## D-031 - Restore NativeWind JSX runtime on device; stub reanimated (Phase 2F, 2026-09-24)

**Status:** Accepted

**Context.** Commit dcecda2 (Phase 2E) removed `nativewind/babel` while fixing
a Metro issue. Without `jsxImportSource: 'nativewind'`, every `className`
prop was silently ignored: the app compiled and tested green but rendered
unstyled (white/black-on-black, effectively invisible on the dark theme).
Device validation exposed it. Additionally, `react-native-css-interop`
hard-requires its declared peer `react-native-reanimated` (only used by
animate-*/transition-* helpers this app never uses).

**Decision.** 6th commit beyond the planned 5, because unstyled UI makes the
product and section 27 validation unusable. (1) `babel.config.js`:
`['babel-preset-expo', { jsxImportSource: 'nativewind' }]` routes JSX through
`nativewind/jsx-runtime`. (2) Do NOT re-add the `nativewind/babel` preset
(it pulls the missing `react-native-reanimated/plugin`). (3) Metro
`resolver.extraNodeModules` maps `react-native-reanimated` to
`stubs/react-native-reanimated.js` (no-op CJS stub) - chosen over
`resolveRequest` so NativeWind's interop doctor never sees a custom
resolution, and over installing reanimated (native module + jest setup, new
dependency, out of scope). Jest is unaffected (no metro config).

**Consequences.**

- `className` styles now apply on device; verified visually (Home, Training
  load, Muscle distribution) after a `--clear` bundle; full jest 427/427
  green with the new babel config.
- CSS animations/transitions stay unsupported (documented; app uses none).
- Third commit deviation from "exactly 5 commits" reported in the phase 2F
  section 36 summary.

---

## D-032 - Apply the ApexFOSS six-color palette as a migration (Phase 2G, 2026-09-25)

**Status:** Accepted

**Context.** Phase 2G §1 requires migrating every screen to the approved
six-color AMOLED-first palette without redesigning the UI: NIGHT RIDER
`#020101`, AUBERGINE `#3D0B0D`, MAHOGANY `#53080E`, DARK BURGUNDY `#72090F`,
POHUTUKAWA `#930510`, ROOF TERRACOTTA `#B21F29`. The old tokens
(`#0a0a0a/#141414/#262626` surfaces, `#22d3ee` cyan, `#4ade80` green,
`#f87171` danger) had to go, but pure palette colors are all dark: none can
carry AA text.

**Decision.** One token layer (`tailwind.config.js` + `global.css` +
`src/theme/index.ts`) with the exact six palette colors plus documented
readability exceptions: `fg #F5F5F5` / `dim #A3A3A3` (neutral text),
`accent-ink #E3675F` and `danger #F87171` (light tints of the same red hue),
`success` = neutral (no positive-state hue exists in the palette; completion
is conveyed by weight/label, not color). All former `text-accent` usage (28
sites) renamed to `text-accent-ink`; primary Button label `text-black` ->
`text-fg`; ActivityIndicator cyan -> accent. Contrast floors pinned in tests
(`src/security/palette.test.ts`): fg/bg 19.1:1, accent-ink >= 4.5:1 on
bg/surface/surface-2, fg on accent fill 6.2:1, accent fill >= 3:1 for
non-text UI. QrGrid keeps pure black/white (scanner contrast exception).
app.json splash/backgroundColor -> `#020101` (takes effect at next prebuild).

**Consequences.**

- Single palette, dark theme preserved, no gradients/redesign; every token is
  either one of the six colors or a documented exception (pinned by test).
- On-device palette verification deferred (no device this phase).

---

## D-033 - Remove INTERNET from release builds via manifest-merger marker (Phase 2G, 2026-09-25)

**Status:** Accepted (verified on the built release APK)

**Context.** Static audit found zero network APIs in `src/` (no fetch/XHR/
WebSocket/axios), expo-updates disabled, local-only notifications, and
user-intent share exports - yet release APKs declared `INTERNET`. Spec §0
warns against blind permission removal; the evidence supported removal, with
one trap: `expo-file-system`'s own manifest re-declares INTERNET, so a naive
strip is silently undone at Gradle merge time.

**Decision.** New config plugin `plugins/withNetworkHardening.js` writes an
`android.permission.INTERNET` entry with `tools:node="remove"` into the main
manifest (suppresses all library contributions), while
`android/app/src/debug/AndroidManifest.xml` re-declares INTERNET with an
explicit `tools:node="merge"` so Metro and expo-dev-client keep working in
debug. Final authority: `aapt dump badging` on both APKs - release has no
INTERNET, debug does. Kept: ACCESS_NETWORK_STATE (state only), VIBRATE,
POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED, WAKE_LOCK, legacy storage <= 32.

**Consequences.**

- Release app cannot make network calls; any future library that tries fails
  with SecurityException (loud failure by design).
- Dormant Firebase/FCM components merged in by expo-notifications become
  doubly unreachable (no google-services.json + no INTERNET) - disclosed, not
  hidden (SECURITY_AUDIT F-14).
- Debug workflow unchanged.

---

## D-034 - Keep `allowBackup=true` and disclose it (Phase 2G, 2026-09-25)

**Status:** Accepted (explicit non-change)

**Context.** OS Auto Backup can copy app data (including the SQLite database)
to the user's configured cloud backup provider. Spec §0 forbids blindly
disabling Android backup; disabling would silently remove users' only
automatic backup path.

**Decision.** Keep `allowBackup=true` without extraction-rule restrictions,
document the third-party processing channel in `docs/PRIVACY.md` and
`docs/DATA_MAP.md`, and record the exact scope as OS-dependent (SECURITY_AUDIT
F-04, KNOWN_LIMITATIONS 12). Revisit explicit `dataExtractionRules` in a
future phase after per-version verification on a device.

**Consequences.**

- Users keep automatic backups; the privacy surface is disclosed rather than
  papered over.
- Backup scope remains device-dependent - listed as manual review.

---

## D-035 - Permission and exported-component inventory: keep, document, defer risky removals (Phase 2G, 2026-09-25)

**Status:** Accepted

**Context.** The merged release manifest carries components this app never
declares directly: SYSTEM_ALERT_WINDOW (from react-native/ReactAndroid),
READ/WRITE_EXTERNAL_STORAGE maxSdk 32 (expo-file-system), badge permissions +
ShortcutBadger (expo-notifications), launcher/notification receivers, a
FileProvider, and Firebase/Play-services classes. Spec §0 forbids blind
`exported=false` flips; no device is connected to observe breakage.

**Decision.** Inventory each item in `docs/SECURITY_AUDIT.md` (origin,
exploitability, verdict) instead of mass-editing. Keep SYSTEM_ALERT_WINDOW
(never requested at runtime; removal needs device verification), keep legacy
storage (inert on API 33+), keep notification/boot permissions (required),
record every exported component and its guard (permission or non-exported).
MainActivity stays exported (launcher + apexfoss scheme by design); its
intent path is hardened by caps/preview/confirm (D-036) instead.

**Consequences.**

- No speculative breakage; every kept permission has a written justification.
- SYSTEM_ALERT_WINDOW removal is queued as future device-verified work
  (Play scrutiny noted in DISTRIBUTION.md).

---

## D-036 - Strengthen input boundaries with size caps instead of a schema library (Phase 2G, 2026-09-25)

**Status:** Accepted (tested)

**Context.** Existing validators already enforce types/ranges/structural caps
(reqStr/reqInt, MAX_BLOCKS/STEPS/EXERCISES, checksums), but pasted JSON hit
`JSON.parse` unbounded (resource exhaustion), and PortabilityScreen had a
second, ad-hoc deep-link regex path outside the hardened parser. Spec §0
explicitly discourages adding Zod/Valibot reflexively.

**Decision.** (1) Byte ceilings checked BEFORE parsing:
`MAX_ROUTINE_JSON_BYTES = 5 MB`, `MAX_BACKUP_JSON_BYTES = 32 MB` via
`utf8ByteLength` (UTF-8 bytes, not characters). (2) PortabilityScreen's
`apexfoss://` branch now calls `parseImportDeepLink` (scheme/host/charset +
`MAX_PORTABLE_PAYLOAD_BYTES + 64` transport cap) instead of its own regex.
(3) No new validation dependency.

**Consequences.**

- Hostile multi-MB pastes are rejected before allocation; deep-link decoding
  has one hardened implementation.
- Boundary behavior (exact cap / over cap / byte semantics) is pinned by
  `src/security/inputBoundaries.test.ts`.

---

## D-037 - Full local-data wipe through the Trust Center (Phase 2G, 2026-09-25)

**Status:** Accepted (tested)

**Context.** Per-entity deletes existed for exercises/routines, but there was
no way to remove everything at once (spec §14).

**Decision.** `src/data/deletion.ts` adds `countLocalData`,
`wipeAllLocalData` (destroys every row of every table with
`destroyPermanently` - no tombstones remain) and `deleteAllLocalData` (adds
cancel-all of scheduled rest notifications, `useTimerStore.clear()`,
active-session mirror reset). Exposed in the Trust Center behind
`confirmDestructive` with "cannot be undone / create a backup first" copy;
starter exercises re-seed next launch (app content). Explicitly documented as
NOT forensic erasure.

**Consequences.**

- One confirmed action empties the app; runtime mirrors and notifications
  cannot leak stale state (tests cover wipe, counts, restart+reseed,
  notification cancellation).

---

## D-038 - License remains an owner decision (Phase 2G, 2026-09-25)

**Status:** Open (owner decision)

**Context.** The repository has no `LICENSE` file while README calls the
project open source. Audit cannot invent a license.

**Decision.** Do not add or guess a license. Document the inconsistency
(SECURITY_AUDIT F-18, KNOWN_LIMITATIONS 14, TERMS_OF_USE §3,
THIRD_PARTY_LICENSES header, DISTRIBUTION blockers) and require owner/legal
resolution before any public distribution.

**Consequences.**

- F-Droid is blocked until resolved; "open source" claims carry a written
  caveat.

---

## D-039 - npm audit findings: document, do not force-fix (Phase 2G, 2026-09-25)

**Status:** Accepted (deferred)

**Context.** `npm audit`: 12 moderate, 0 high/critical across 1040 deps. All
are indirect chains (`@babel/runtime < 7.26.10` under WatermelonDB; `@expo/cli`
/ config tooling under expo). npm's suggested fixes are semver-major
DOWNGRADES (WatermelonDB 0.25.5, expo 46) - unacceptable on a frozen stack.

**Decision.** No dependency upgrades this phase; no `audit fix --force`.
Advisories, exploitability notes (build-time tooling vs runtime, no
Babel-generated regex over user input) and the re-evaluation trigger are
recorded in SECURITY_AUDIT F-19.

**Consequences.**

- Known advisories stay visible with rationale instead of being silently
  ignored or "fixed" into a broken tree.

---

## D-040 - Health language: boundary statement, no regulatory classification (Phase 2G, 2026-09-25)

**Status:** Accepted

**Context.** The app records workouts and shows locally computed readiness -
classic general-fitness territory. Repository audit found no user-facing
medical claims (only neutral code comments phrased as prohibitions). Spec §0
forbids claiming regulatory classification or legal immunity.

**Decision.** Write `docs/HEALTH_AND_FITNESS.md` as a boundary document: what
the software is (fitness logging/timing), what it is not (no diagnosis,
treatment, monitoring, prediction; no wearable/health data; no advice), the
arithmetic nature of computed metrics, plus explicit "no regulatory
classification claims" language. No invented certifications.

**Consequences.**

- Store questionnaires and legal drafts can be answered from a single,
  non-overclaiming source (D-042, TERMS_OF_USE).

---

## D-041 - In-app Trust, Safety & Legal center as a plain offline screen (Phase 2G, 2026-09-25)

**Status:** Accepted (tested)

**Context.** Spec §19 requires an in-app Trust/Safety/Legal area without
adding WebView, network, analytics or tracking.

**Decision.** `src/ui/screens/TrustScreen.tsx` (route `trust`, Home entry
`home-trust`) rendered with native Text/View only, sections: Privacy, Terms
(draft), Health & Fitness, Data & Storage (live counts + destructive full
wipe), Security (points to SECURITY.md process), Known Limitations, Open
Source & Licenses, About. Copy comes from `strings.trust` - concise summaries
linking to the canonical docs, no medical/legal claims. Visual language uses
the D-032 tokens (the accent-muted border keeps POHUTUKAWA present).

**Consequences.**

- All §19 surfaces ship in the binary, offline; deletion UX lives exactly
  where users look for it (Data & Storage).

---

## D-042 - Distribution: document channels and blockers, submit nowhere (Phase 2G, 2026-09-25)

**Status:** Accepted

**Context.** §22/§23 require analyzing Play (health/privacy questionnaire
surface) and F-Droid (FOSS policy) implications without making submissions or
compliance claims.

**Decision.** `docs/DISTRIBUTION.md` maps each questionnaire area to honest
answers sourced from HEALTH_AND_FITNESS/DATA_MAP, lists channel blockers
(license first, legal review, device validation, SYSTEM_ALERT_WINDOW
scrutiny, F-Droid source-build recipe), and states in writing that zero
submissions/registrations occurred. No store-compliance claims anywhere.

**Consequences.**

- Distribution work is a checklist away from execution without any premature
  commitment or overclaim.

---

## D-043 - Neutralize spreadsheet formula injection in CSV exports (Phase 2G, 2026-09-25)

**Status:** Accepted (tested)

**Context.** Routine/exercise names can arrive from imported portable
packages (untrusted content). Re-exported to CSV and opened in a spreadsheet,
a leading `=`/`+`/`@`/`-` can become a live formula (CSV injection). §13
requires the export surface to be hardened.

**Decision.** `escapeCsvField` prefixes such values with an apostrophe
(literal-text marker in Excel/Sheets), except `-` followed by a digit/dot so
legitimate negative numbers stay numeric. JSON export keeps raw fidelity
(guard is CSV-only). RFC 4180 quoting behavior unchanged.

**Consequences.**

- Imported hostile names cannot execute as formulas from our exports;
  numeric columns remain numeric (tests in `src/security/exportSecurity.test.ts`).

---

## D-044 - Make the prebuild Kotlin injection CRLF-safe (Phase 2G, 2026-09-25)

**Status:** Accepted (build fix)

**Context.** `plugins/withWatermelonJsiFix.js` inserted the
`WatermelonDBJSIPackage` import using a `$`-anchored regex that did not
consume `\r`. On a CRLF-generated `MainApplication.kt` the anchor failed and
the plugin fell back to PREPENDING the import before `package`, producing a
file that `compileDebugKotlin` rejected (this blocked the first Phase 2G
build attempt).

**Decision.** Replace regex insertion with line-based splicing (split on
`\r?\n`, insert after the `import android.app.Application` line, or after
`package` as fallback, rejoining with the file's original EOL), and throw a
clear error if no anchor exists instead of silently corrupting the file.
Keep the plugin idempotent.

**Consequences.**

- `expo prebuild --clean` now yields a compilable `MainApplication.kt` on any
  line-ending regime; `assembleDebug`/`assembleRelease` succeeded after the
  fix (both APKs produced, release signed and audit-verified).

## D-045 - Fix a flaky localId-leak assertion (Phase 2I, 2026-09-25)

**Status:** Accepted (test fix)

**Context.** The Phase 2I release-readiness audit caught
`src/data/day2.test.ts` failing once on
`expect(JSON.stringify(def)).not.toContain('b1')`. WatermelonDB record ids
are random 16-character base62 strings (`utils/common/randomId`), so a bare
2-character needle like `b1`/`s1` can occur inside a generated id by chance
(roughly 3-4% of runs over the ~9 distinct ids serialized in that
definition). Sibling `not.toContain` assertions are unaffected because their
needles contain characters impossible in ids (`_`, `"`), or are long strings
(`localId`, `remainingSeconds`).

**Decision.** Assert on quote-exact JSON string values (`'"b1"'`, `'"s1"'`)
instead of bare substrings. A leaked draft localId is always a complete JSON
string value, so the assertion keeps its original intent while removing the
random-collision path; the `localId`-key check is unchanged. No production
code changed.

**Consequences.**

- The 480-test release gate is deterministic again: the `day2` suite passed
  3/3 consecutive runs after the fix; full suite green (480/480, 29 suites).
- Auditors rerunning historical phases will no longer see this intermittent
  failure attributed to a regression.

---

## D-046 - Establish a shared design system instead of per-screen styling (Phase 2J, 2026-09-25)

**Status:** Accepted

**Context.** Phase 2J required a premium-feeling athlete platform. The pre-existing screens each hand-rolled colors, spacing, borders and empty states, so the product read as several apps. The palette itself is frozen by D-032 and guarded by `src/security/palette.test.ts`.

**Decision.** Introduce one design system: design tokens in `tailwind.config.js` + `src/theme` derived from the frozen palette, a component kit (`Card` tones, `Badge`, `MetricCard`, `ListRow`, `Button`, `TextField`, `EmptyState`/`ErrorState`/`LoadingState`, `SectionHeader`, `Progress`), and reduce-motion-aware entrance helpers in `src/ui/motion.tsx` (short fades only, no loops, no new dependencies). All Phase 2J screens are composed from this kit; the palette test continues to pin `theme.colors` exactly, so the system cannot smuggle in new colors.

**Consequences.**

- Visual consistency and one place to change any shared pattern; screens shrank instead of growing style code.
- Accessibility behavior (text labels alongside color, reduce-motion support) lives in components once rather than per screen.
- The kit is unit-tested through the screens that use it; adding a color token now fails the palette test by design.

---

## D-047 - Keep athlete analytics as pure, deterministic modules with visible reasoning (Phase 2J, 2026-09-25)

**Status:** Accepted

**Context.** The phase adds dashboard, rolling load/rhythm, personal records, session comparison, substitutions and routine integrity. Analytics that reads the database inline or scores exercises opaquely would be untestable and unexplainable.

**Decision.** Every calculation lives in pure modules over explicit inputs: `src/analytics/{athlete,records,compare,substitutions}.ts` and `src/engine/{simulator,integrity}.ts`. Screens only fetch rows, call the pure function, and render. Substitutions expose per-candidate reason labels (pattern / equipment / muscles / category) with documented weights (400/250/300/50) and deterministic tie-breaks (score → name → id); integrity diagnostics mirror the frozen `computeTarget` engine semantics instead of re-deriving them.

**Consequences.**

- All of it runs in Jest with no device or database fixture complexity; failures are reproducible from inputs alone.
- The UI shows *why* a substitution ranked where it did — no black-box scores.
- Heuristics are honest about uncertainty (unknown patterns/equipment score lower rather than guessing) — see KNOWN_LIMITATIONS #23.

---

## D-048 - Session notes: one optional session-level column (schema v5) (Phase 2J, 2026-09-25)

**Status:** Accepted

**Context.** The spec calls for workout notes. Options were per-exercise note rows, a notes table, or a single optional column on the session.

**Decision.** Add `note` (optional string) to `workout_sessions` via an additive v4 → v5 migration. `normalizeNote` trims input, maps blank to null and caps at 2000 characters. The note is written on the post-workout summary (best-effort on Done, never blocking navigation) and editable from History → Session with an explicit save. Portability: optional `BackupSession.note` — absent on pre-v5 backups, validated as a bounded string, restored to null when missing. The history **JSON** export includes the note; the CSV schema is untouched.

**Consequences.**

- Existing installs upgrade with a pure column addition; old rows read null and old backups still validate.
- Session-level scope keeps the migration, UI and tests small; per-exercise notes are deferred and documented (KNOWN_LIMITATIONS #25).
- Notes ride the existing backup/rollback/restore machinery — no second persistence path.

---

## D-049 - Light CI: typecheck + Jest only (Phase 2J, 2026-09-25)

**Status:** Accepted

**Context.** The phase spec asks for light CI. Native builds need an Android SDK/JDK setup and device validation needs hardware; neither is available to a hosted runner within this phase, and Phase 2J was explicitly executed without ADB/device steps.

**Decision.** `.github/workflows/ci.yml` runs one Ubuntu job on push/PR to `main`: `npm ci` → `npm run typecheck` → `npm test -- --silent` (Node 22, npm cache). No emulator, no APK build in CI.

**Consequences.**

- Type and behavior regressions are caught before merge at a cost of a few minutes and zero secrets.
- CI does not replace device validation — that gap stays explicitly documented (KNOWN_LIMITATIONS #21).
