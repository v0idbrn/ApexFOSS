# Distribution Assets — ApexFOSS 1.1.0

**Status: PARTIAL SET — captured 2026-09-30 on-device. No mockups, no generated images.**
**Device:** Samsung SM-A045M (Galaxy A04), Android 14 (API 34), arm64-v8a, 720×1600 portrait.
**App:** `com.apexfoss.app` 1.1.0 (versionCode 3). EN via in-app language switch; ES = device locale.
**Videos:** NOT CAPTURED (pending a future device session).

## Masters (`docs/assets/screenshots/`)

### en/ (13 + 1)

| File | Screen | Use |
|---|---|---|
| `01-home.png` | Home (empty state) | hero candidate, README, store |
| `02-routines-empty.png` | Routines empty state | docs only |
| `02-routines.png` | Routines list (Full body) | store, README |
| `03-routine-editor.png` | Routine editor (block role chips visible) | programming |
| `04-routine-preview.png` | Routine preview + integrity checks | programming |
| `05-active-workout.png` | Active workout + athlete numpad | **hero candidate (execution)** |
| `06-set-actions.png` | Reason chips + COMPLETE/Skip actions | docs |
| `07-session-summary.png` | Session summary (44 min, 3 sets, 1,020 kg·reps) | progress |
| `08-train.png` | Train hub (last session) | docs |
| `09-progress.png` | Progress (week metrics + progression intelligence) | progress |
| `10-history.png` | History list + export buttons | history |
| `11-session-detail.png` | Session detail (adherence, load, notes) | history |
| `12-report.png` | Training report (periods, volume, PRs, adherence) | **progress/history** |
| `13-more.png` | More hub (tools, reminders, legal) | ownership/about |

### es/ (3)

| File | Screen | Use |
|---|---|---|
| `01-home.png` | Home | es store/README |
| `02-more.png` | More hub | es docs |
| `03-support.png` | Support section (Sponsors + PayPal + Mercado Pago) | es docs, support visibility proof |

## Fastlane selection (`fastlane/metadata/android/<locale>/images/phoneScreenshots/`)

- en-US: 10 shots (`01-home` … `10-more`) — meets the 6–10 F-Droid range.
- es-AR: 3 shots (`01-home`, `02-more`, `03-support`).
- `icon.png` 512×512 present in both locales (generated from `assets/icon.png`, not a screenshot).

## Still missing (needs a device session)

- Programs / Mesocycles screen.
- Portability screen (backup/restore UI).
- Dedicated rest-timer shot (timer visible mid-countdown).
- Trust, Safety & Legal screen.
- More ES screenshots (routines, workout, history).
- Videos: overview, programming→execution, progress/ownership (raw `screenrecord`, 15–40 s each; store outside git).
- Feature graphic 1024×500 (Play only; compose from real UI, no mockups).

## Data note

Captures used a real completed session (Full body: Back Squat 60×5, Bench Press 80×5, Barbell Row 40×8 → 1,020 kg·reps) plus the pre-existing template routine. No data was wiped; nothing was deleted. Values shown are genuine logged data.
