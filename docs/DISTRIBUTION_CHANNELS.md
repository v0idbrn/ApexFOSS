# Other Android Channels — Assessment (ApexFOSS 1.1.0)

**Status: assessment only — no submissions made anywhere. Last checked: September 2026.**
**Sources:** Aptoide Connect docs, Uptodown Developers Console + publication criteria, Huawei AppGallery review guidelines, Samsung Seller Portal docs, Obtainium wiki/docs. Facts below are from those sources; re-check at submission time.

No ranking scores are used — each verdict is justified with facts.

## GitHub Releases — DO NOW

- Reach: every Android user with a browser; basis for Obtainium + IzzyOnDroid.
- Requirements: a tag + uploaded APK. No account beyond the existing GitHub account, no fee, no review, no SDK.
- FOSS fit: total (own repo, own license, own signature).
- Cost/risk/maintenance: ~zero; the maintainer already builds and signs the APK.
- Verdict: **DO NOW** — this pass creates the v1.1.0 tag + release.

## Obtainium — DO NOW

- Reach: privacy/FOSS users who track developer releases directly (also lists F-Droid/IzzyOnDroid sources).
- Requirements: none on the app side — it reads the GitHub Releases page (APK asset + `v1.1.0`-style tags, both provided).
- FOSS fit: total; no integration added to ApexFOSS (external distribution by design).
- Caveats to document for users: dev-signed APK must not be mixed with a future F-Droid build (different signers → reinstall to switch); enable "include prereleases" if the release is flagged as such.
- Verdict: **DO NOW** — works automatically once the GitHub Release exists; user path documented in `docs/DISTRIBUTION_FDROID_SUBMISSION.md` §4.

## F-Droid — DO NOW (prepare submission)

- Reach: the reference FOSS store; builds from source and re-signs.
- Requirements: GPL license ✓, public source ✓, `fdroiddata` metadata MR (GitLab), trial build, reviewer process (days to weeks).
- Verdict: **DO NOW** — metadata draft + recipe prepared (`docs/DISTRIBUTION_FDROID_SUBMISSION.md`); the MR itself is a manual owner action (GitLab account).

## IzzyOnDroid — PREPARE

- Reach: FOSS users; faster listing than F-Droid, ships developer-signed APKs.
- Requirements: FOSS license ✓, GitHub tagged releases with attached APK ✓ (after this pass), fastlane metadata (texts + icon ✓, **screenshots missing**), release-signed non-debug APK ✓, ~30 MB guideline vs our ~41 MB universal APK (caveat with mitigations documented).
- Process: suggestion issue in their Codeberg maintenance repo (manual owner action).
- Verdict: **PREPARE** — everything ready except screenshots + the release itself; file the issue after those land.

## Uptodown — PREPARE

- Reach: large third-party store with web SEO; free Developers Console, explicit GPL license type + source-URL fields (good FOSS fit).
- Requirements: free account, APK upload, owner authorization (creator submits — satisfied).
- Cost: free, no SDK, no fees. Maintenance: manual uploads per release (or let their editors track official sources).
- Verdict: **PREPARE** — no technical blocker; owner creates the account and uploads when ready. Not doing it in this pass (account creation is a user action).

## Aptoide — DEFER

- Reach: large alternative store + OEM/carrier partners.
- Requirements: free only for apps already on Google Play (auto-sync). ApexFOSS is NOT on Play → manual submission path, which per current docs requires an active subscription. Signature must match the Play key (we have none there yet); Android developer verification rules apply.
- Verdict: **DEFER** — revisit automatically once on Google Play (then distribution is free and automatic). Manual submission now would cost a subscription for zero benefit over GitHub Releases.

## Huawei AppGallery — DEFER

- Reach: Huawei devices (large, esp. where Play is absent).
- Requirements: Huawei ID + developer verification, review process (≥3 screenshots, metadata consistency), commercial-agent terms. No HMS required for a GMS-free app like ApexFOSS (works with `gms: N`), but review demands compatibility testing and contact authenticity.
- Cost: account + review overhead; ongoing per-release review.
- Verdict: **DEFER** — real cost in identity verification and review cycles for an audience better served via GitHub/F-Droid first. Revisit on user demand.

## Samsung Galaxy Store — DO NOT USE

- Requirements: Samsung account + Seller Portal + **commercial seller status**, which demands business documentation (D-U-N-S or equivalent, English/Korean filings, explanations for public-domain emails).
- Fit: structurally incompatible with solo FOSS distribution — a commercial entity posture for a free, account-less app, plus review sovereignty clauses and FOSS-license paperwork per submission.
- Verdict: **DO NOT USE** — cost and structure outweigh any reach benefit while FOSS channels are unserved.

## APKPure — DO NOT USE

- No developer submission path found (it mirrors Google Play). Without a Play listing there is nothing to submit, and scraping-based mirrors add no trust value over the developer's own GitHub Release.
- Verdict: **DO NOT USE**.
