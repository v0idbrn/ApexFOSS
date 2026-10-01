# Distribution Assets — ApexFOSS 1.1.0

**Status: FULL SET — captured 2026-09-30 / 2026-10-01 on-device. No mockups, no generated images.**
**Device:** Samsung SM-A045M (Galaxy A04), Android 14 (API 34), arm64-v8a, 720×1600 portrait.
**App:** `com.apexfoss.app` 1.1.0 (versionCode 3). EN via in-app language switch; ES = device locale.
**Videos:** CAPTURED (2026-10-01, `adb screenrecord`, 8–10 s raw clips; stored outside git in the session's temp dir):
`vid_home.mp4` (home/overview), `vid_workout.mp4` (start routine → active workout), `vid_progress.mp4` (progress/history).

## Masters (`docs/assets/screenshots/`)

### en/ (19)

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
| `14-programs.png` | Programs screen (create + Strength program) | programming |
| `14-programs-mesocycles.png` | Mesocycle detail (Base, Normal/Deload chips) | programming |
| `15-portability.png` | Portability (backup/restore, export options) | ownership/data |
| `16-trust.png` | Trust, Safety & Legal (counts, delete-all, privacy/terms/health/security) | ownership/legal |
| `17-rest-timer.png` | Rest timer mid-countdown (01:29, Pause / Skip rest, next-up) | **hero candidate (execution)** |

### es/ (8)

| File | Screen | Use |
|---|---|---|
| `01-home.png` | Home | es store/README |
| `02-more.png` | More hub (compact) | es docs |
| `03-support.png` | Support section (Sponsors + PayPal + Mercado Pago) | es docs, support visibility proof |
| `04-mas.png` | More hub (full, Idioma toggle visible) | es docs |
| `05-entrenar.png` | Train hub (listo/última sesión) | es docs |
| `06-rutinas.png` | Routines list (Programas/Plantillas/Full body) | es docs |
| `07-entreno-activo.png` | Active workout (Paso/OBJETIVO/numpad) | es execution |
| `08-progreso.png` | Progress (sesiones/volumen/tiempo, inteligencia) | es progress |

## Fastlane selection (`fastlane/metadata/android/<locale>/images/phoneScreenshots/`)

- en-US: 10 shots (`01-home` … `10-more`) — meets the 6–10 F-Droid range.
- es-AR: 3 shots (`01-home`, `02-more`, `03-support`).
- `icon.png` 512×512 present in both locales (generated from `assets/icon.png`, not a screenshot).

## Still missing (needs a device session)

- ~~Programs / Mesocycles screen.~~ done 2026-10-01
- ~~Portability screen (backup/restore UI).~~ done 2026-10-01
- ~~Dedicated rest-timer shot (timer visible mid-countdown).~~ done 2026-10-01
- ~~Trust, Safety & Legal screen.~~ done 2026-10-01
- ~~More ES screenshots (routines, workout, history).~~ done 2026-10-01
- ~~Videos: overview, programming→execution, progress/ownership.~~ captured 2026-10-01 (outside git)
- Feature graphic 1024×500 (Play only; compose from real UI, no mockups).

## Data note

Captures used a real completed session (Full body: Back Squat 60×5, Bench Press 80×5, Barbell Row 40×8 → 1,020 kg·reps) plus the pre-existing template routine. No data was wiped; nothing was deleted. Values shown are genuine logged data.
