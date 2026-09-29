# Store Assets — Play Store Listing

**Status: checklist only — no screenshots or graphics have been fabricated. Every future screenshot must be a real capture of the actual app on a real device.**
**Last updated: 2026-09-29.**

## Required Play Store assets

| Asset | Requirement | Current state | Action |
|---|---|---|---|
| High-res icon | 512×512 PNG, 32-bit | **Source available:** `assets/icon.png` (1024×1024); adaptive launcher icons generated at prebuild (`mipmap-*`, foreground + background webp) | Downscale to 512×512 at upload |
| Feature graphic | 1024×500 PNG/JPG, no text-heavy design recommended | **Missing** | Create from real UI (no mockups) |
| Phone screenshots | Min 2, up to 8; JPEG/PNG; min 1080px on long edge recommended | **Missing** | Capture on a real device (§Screenshot scenarios) |
| 7" tablet screenshots | Optional (only if claiming tablet support) | Missing / not claimed | Skip unless tablet layout is validated |
| 10" tablet screenshots | Optional (only if claiming tablet support) | Missing / not claimed | Skip unless tablet layout is validated |
| Promo video | Optional | Missing | Skip for 1.0.0 |

## Screenshot scenarios (real product surfaces only)

Capture each on the release build, default EN locale (plus ES for at least Home + Train if cheap), portrait, Galaxy A04-class width:

1. **Home** — week snapshot with sessions/volume/time (or the honest empty state on a fresh install).
2. **Routines** — routine list or editor with blocks/steps.
3. **Train** — routine choice / session start.
4. **Active workout** — set logging with rest timer running.
5. **Progress** — weekly metrics + trends.
6. **History / Report** — session list or 28-day report with readable values.
7. **More / About** — hub rows incl. Support ApexFOSS section.
8. **Portability** — routine export / backup screen (or QR screen).

## Rules

- Real captures only. No mockups, no Figma renders, no device frames with fake content.
- No feature may appear that does not exist in the submitted `versionCode`.
- No marketing claims in graphics that the description does not support (no "100% secure", no "best", no medical claims).
- Redact or use synthetic personal data: screenshots must not contain a real person's training data unless that person consents.
- Keep the source captures (untrimmed) alongside the uploaded crops for auditability; do not commit binaries to the repo — store them with the release paperwork, not in git.
