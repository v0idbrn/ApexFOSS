# ApexFOSS Agent Policy

This document establishes the development rules for all AI agents working on ApexFOSS.

## Core Principles

### Read before edit
Inspect relevant code before changing it. Understand the existing architecture, patterns, and conventions.

### Reuse before abstraction
Search the repository for existing implementations before creating new ones. Use existing utilities, components, and patterns.

### No speculative code
Do not build future features "because they may be useful later." Implement only what is currently required.

### No dependency by default
A new dependency requires a concrete, documented reason. Prefer stdlib, platform APIs, and already-installed packages.

### Smallest correct change
Do not add code that is not necessary for the requested behavior. Minimize surface area of changes.

### Preserve tests
Tests are not optional cleanup targets. All changes must pass existing tests; add tests for new behavior.

### Preserve security
Never trade security for fewer lines. Security boundaries, validation, and encryption are non-negotiable.

### Preserve accessibility
Never trade accessibility for fewer components. All UI must meet accessibility standards.

### Preserve i18n
All user-facing strings remain localized. EN/ES key parity is mandatory.

### Verify
Run appropriate tests, typecheck, and build after changes. Do not assume correctness.

### Don't hallucinate
When uncertain, inspect the repository or run a command. Never invent APIs, files, dependencies, test results, or architecture.

## ApexFOSS Architecture Constraints

The following are NON-NEGOTIABLE and must be preserved in all changes:

- **Offline-first**: No mandatory network connectivity
- **No accounts/backend**: Local-first data ownership
- **No telemetry/ads/subscriptions**: Privacy by design
- **No INTERNET permission in release builds**: Verified via apksigner/aapt
- **Immutable session snapshots**: `definition_json` and `cursor_json` are canonical
- **Pure TypeScript transition engine**: `(definition, cursor, event) → { cursor', effects[] }`
- **Programming/Execution/Analytics separation**: Clear layer boundaries
- **Integer internal units**: grams, milliseconds, millimeters
- **Canonical timer expiration**: Absolute timestamps, never UI state
- **WatermelonDB persistence**: SQLite with schema migrations
- **Zustand for ephemeral state only**: Not for persistent data
- **UI does not interpret execution transitions**: UI is a pure view layer
- **Deterministic analytics**: Pure functions, no randomness
- **Versioned backups**: `.apexbackup` with checksum and atomic restore
- **Security boundaries**: Proper isolation, no data leakage
- **Accessibility**: Semantic labels, roles, touch targets
- **i18n EN/ES structural parity**: 497+ keys, neutral tú register
- **Android-first scope**: minSdk 24, targetSdk 36, arm64-v8a + armeabi-v7a

## Tool Integration

### Caveman
- **Skill**: Installed globally (`~/.agents/skills/caveman*`) - reduces agent output verbosity
- **Proxy**: Installed (`~/.caveman/bin/`) - compresses tool output, logs, JSON, diffs before they reach the model
- **Commands available**: `/caveman`, `/caveman-commit`, `/caveman-review`, `/caveman-compress`, `/caveman-stats`, etc.
- **Recovery**: Original data always recoverable via local SQLite backup

### Ponytail
- **Plugin**: Configured in `opencode.json` via `@dietrichgebert/ponytail`
- **Philosophy**: YAGNI, reuse before abstraction, minimal implementation
- **Ladder**: 1) Need it? 2) Already in codebase? 3) Stdlib? 4) Native platform? 5) Installed dependency? 6) One line? 7) Minimum that works
- **Commands**: `/ponytail [lite|full|ultra|off]`, `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain`, `/ponytail-help`
- **Safety**: Never removes validation, error handling, security, accessibility, or domain invariants

## Combined Workflow

```
Muse Spark → Caveman reduces noisy context/output → Muse reasons → Ponytail enforces minimal implementation → ApexFOSS tests/architecture/security remain authoritative
```

## Integration Verification

After any configuration change, run:
- `npx jest --silent` (expect 1131+ tests / 85+ suites green)
- `npm run typecheck` (expect exit 0)

---

*Phase 2L CLOSED at commit 2643672. Do not reopen Phase 2L. Phase 3 NOT implemented.*