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
