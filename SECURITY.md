# Security Policy

**Last updated: 2026-09-28 (v1.0.0 closure).**

## Reporting a vulnerability

Please report security issues **responsibly — do not open a public issue for an exploitable bug.**

**Primary channel: GitHub Security Advisories.** Open the repository → *Security* tab → *Report a vulnerability* → *Private report*. This delivers a private advisory to the maintainers without exposing details.

- **No security email address is published in this repository** (no monitored mailbox is provisioned, and inventing one would be worse than none). If the advisory form is unavailable on your fork, contact the repository maintainer privately through GitHub before sharing any details.
- **Supported line for reports:** `1.0.x`. Older snapshots receive no backports — reproduce on the latest build first.

### What to include

- Affected version (APK `versionName`/`versionCode` or git commit),
- Steps to reproduce, or a proof of concept,
- Impact assessment (what data or function an attacker gains),
- Any known mitigations or workarounds.

### What to expect

- Acknowledgement when a maintainer is available (this is a side-project; responses may be slow — no SLA is promised),
- Assessment of validity and severity using the scale in `docs/SECURITY_AUDIT.md`,
- A fix or documented mitigation before public disclosure of details, where feasible,
- Credit in the changelog/report if you want it (say so).

Reports about **dependency vulnerabilities** are welcome too — note that the stack is intentionally frozen (see `docs/KNOWN_LIMITATIONS.md` §15), so triage may be "documented, deferred" rather than "patched immediately".

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x (current line) | ✅ latest release only |
| older builds | ❌ no backports — reinstall the latest release |

There are no long-term-support branches. Android itself is the security boundary for sandboxing; the app does not ship a runtime update mechanism (`expo-updates` is disabled).

## Security posture (summary)

The full audit, threat model and verification results live in **`docs/SECURITY_AUDIT.md`**. Highlights:

- Release build holds **no INTERNET permission** — the app cannot make network calls (verified on the built APK),
- no accounts, no servers, no analytics, no push tokens,
- untrusted inputs (pasted JSON, QR, deep links) are size-capped, structurally validated, previewed and explicitly confirmed before any write,
- exports are user-initiated; CSV output neutralizes spreadsheet formula injection,
- all local data can be deleted from the in-app Trust Center with a destructive confirmation,
- keystore and secrets live outside the repository; release APK is signed and not debuggable.

## Known limitations (what this policy does not claim)

- **Not zero known vulnerabilities.** `npm audit` reports documented, deferred indirect advisories (D-039): npm's suggested fixes would downgrade core dependencies (e.g. `@babel/runtime` under WatermelonDB), so they are tracked in `docs/KNOWN_LIMITATIONS.md` §15 instead of force-patched. Revisit at the next dependency-maintenance window.
- **Checksums are integrity, not authentication** (D-017): backup/routine checksums detect corruption, not tampering — confirm the source out of band.
- **No app-level database encryption** (D-034): device encryption only; no SQLCipher.
- **No claimed threat-model completeness or penetration test**: the audit (`docs/SECURITY_AUDIT.md`) is an internal static/review exercise; automated tests guard the import paths, but neither is a substitute for an external audit.
- **Final physical-device validation and friend testing are pending** (KNOWN_LIMITATIONS #21) — security-relevant flows verified only in Jest so far.

## Scope notes

- The threat model covers: malicious local apps sending intents to ApexFOSS, hostile import files/QR/deep links, accidental data disclosure via exports/notifications/backups, and build/release hygiene.
- Out of scope by policy: physical attacks with the unlocked device, jailbroken/rooted device compromise, and social engineering of individual users.
