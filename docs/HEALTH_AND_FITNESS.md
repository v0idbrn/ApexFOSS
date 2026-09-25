# ApexFOSS — Health & Fitness Scope

**Last updated: 2026-09-25 (Phase 2G).**

## What this software is

ApexFOSS is **general fitness and workout-management software**. It lets a user:

- write and organize exercise routines (sets, reps, load, tempo, rest, intervals),
- execute those routines as timed workouts,
- record their own training history (weights, reps, durations, RIR),
- run an in-app readiness tap-test and see locally computed training-load/readiness indicators,
- export their own data.

All computed values (readiness scores, load metrics, volume estimates, suggestions such as RIR autoregulation adjustments) are **arithmetic over the user's own inputs**, computed on-device.

## What this software is NOT

- It is **not** a medical device and it is **not** medical software.
- It does **not** diagnose, treat, mitigate, cure or prevent any disease or condition.
- It does **not** monitor, track or predict health status, injuries, or clinical outcomes.
- It does **not** provide medical advice, professional supervision, or personalized therapy.
- It does **not** replace a physician, physiotherapist, certified coach or any other professional.
- It does **not** use data from Health Connect, wearables, heart-rate sensors, SpO2, sleep, GPS or any external health/medical source (all explicitly out of product scope).
- Readiness and load metrics are **training-log arithmetic**, not physiological measurement. They are not validated for clinical use and carry no accuracy guarantee (see `docs/KNOWN_LIMITATIONS.md`).

## Safety positioning

Physical exercise carries a risk of injury. The user is responsible for choosing appropriate loads, movements and volumes for their own condition, and for seeking professional advice when they have (or suspect) a medical condition. Software features such as rest timers, RIR targets and autoregulation suggestions are **convenience heuristics**, not safety guarantees.

The application avoids injury-prediction or "overtraining alarm" claims. Where UI copy mentions concepts like effort or exertion, it does so as training terminology, never as a health assessment. (Repository-wide language audit in Phase 2G found no user-facing medical claims; neutral wording is pinned by review and kept this way.)

## Data category

The data handled is **fitness activity data the user types themselves**. It is not health data collected from sensors or medical sources. No health-data integrations exist or are planned in the audited scope.

## Regulatory status statements

This repository intentionally makes **no regulatory classification claims** — no FDA/MDR/intended-purpose classification, no "general wellness" certification claim, and no claim of compliance with any medical-device or health-data regime (HIPAA/GDPR-health/etc.). Any such determination requires legal review by the project owner before public distribution; placeholders for that review live in `docs/TERMS_OF_USE.md`.

## If you need medical guidance

Stop looking at an app and talk to a qualified professional. This software cannot help you with that question, by design.
