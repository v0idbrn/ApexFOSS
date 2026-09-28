# Development & Release Builds

Developer documentation for ApexFOSS. End users do not need any of this — see the
[README](../README.md#installation) for installation.

## Requirements

Node.js with npm, a JDK (17 or newer), and an Android SDK.

## Setup

```bash
git clone https://github.com/v0idbrn/ApexFOSS.git
cd ApexFOSS
npm install
npm run prebuild        # regenerate android/ from app.json + plugins (CNG)
```

`android/` is generated, not hand-maintained. Configuration lives in `app.json`
plus the in-repo config plugins under `plugins/`.

## Commands

```bash
npm run start           # Metro dev server (dev client)
npm run android         # build & run on a connected device or emulator
npm test                # Jest test suite
npm run typecheck       # tsc --noEmit
npm run build:apk       # release APK → android/app/build/outputs/apk/release/
```

`npm run android` requires a connected device or emulator.

## Release signing

Official ApexFOSS releases are signed. The repository contains **no keystores,
no passwords and no signing material**: signing is injected at prebuild time by
`plugins/withApexSigning.js`, which reads a signing configuration kept outside
the repository. `npm run prebuild` fails fast when that configuration is
missing — to produce your own signed release APK, create your own keystore and
external configuration first. Never commit either one.

## Database and native layer

- WatermelonDB over SQLite; schema and migrations live in `src/data/schema.ts`
  and `src/data/migrations.ts`. Never edit a released schema version in place —
  add a migration.
- Expo config plugins under `plugins/` handle Watermelon JSI fixes, network
  hardening (INTERNET removal), file intent filters, and signing injection.

## Release checklist (maintainer)

1. `npm test` and `npm run typecheck` green.
2. `npm run prebuild` (regenerates `android/` with current `version`/`versionCode`).
3. `npm run build:apk` (or `gradlew assembleDebug assembleRelease`).
4. Verify the APK: package/version, ABIs, no INTERNET permission, not
   debuggable, `apksigner verify` (see `docs/SECURITY_AUDIT.md`).
5. Device smoke test, then distribute.
