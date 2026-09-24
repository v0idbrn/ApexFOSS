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
