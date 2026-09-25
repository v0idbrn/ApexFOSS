# Security Policy

**Last updated: 2026-09-25 (Phase 2G).**

## Reporting a vulnerability

Please report security issues **responsibly — do not open a public issue for an exploitable bug.**

Use one of these channels, whichever the project owner has enabled for the repository:

1. **GitHub Security Advisories (preferred):** repository → *Security* tab → *Report a vulnerability* (private disclosure to the maintainers).
2. If advisory reporting is unavailable: contact the repository maintainer through a private channel listed in the repository profile or `README.md`.

**No security email address is published in this repository because none has been provisioned.** The project owner should insert a monitored contact here before public distribution:

- **Security contact:** `[NOT YET PROVISIONED — owner must insert a monitored address or enable GitHub advisories]`

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
| 0.1.x (current development line) | ✅ latest release only |
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

## Scope notes

- The threat model covers: malicious local apps sending intents to ApexFOSS, hostile import files/QR/deep links, accidental data disclosure via exports/notifications/backups, and build/release hygiene.
- Out of scope by policy: physical attacks with the unlocked device, jailbroken/rooted device compromise, and social engineering of individual users.
