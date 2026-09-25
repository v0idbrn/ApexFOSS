# ApexFOSS — Terms of Use (DRAFT)

**⚠ DRAFT STATUS: This document is a placeholder prepared in Phase 2G for human and legal review. It is not legal advice, it has not been reviewed by counsel, and it must not be relied on as final. Bracketed items are deliberately unfilled — the project owner must complete or strike them.**

**Last updated: 2026-09-25.**

## 1. The software

"ApexFOSS" means the application, source code and documentation distributed from the project's repository and release channels (the "[PROJECT REPOSITORY URL]" and any official release page), together with subsequent updates.

## 2. Project identity and contact

- **Operator/author:** [FULL LEGAL NAME OR ENTITY OF THE PROJECT OWNER — must be inserted by the owner]
- **Contact for legal notices:** [POSTAL ADDRESS / EMAIL — must be inserted by the owner]
- **Security reports:** see `SECURITY.md` in the repository.

*(No identity or contact channel is invented on purpose.)*

## 3. License

The project's licensing status is **currently undeclared**: no `LICENSE` file exists at the time of this draft (tracked as an open item in `docs/KNOWN_LIMITATIONS.md`, decision D-038). **Until the owner declares a license, all rights are reserved by the copyright holder, and "open source" statements in the README should be read as intent, not grant.** The owner must resolve this before any public distribution claim.

## 4. Nature of the relationship

ApexFOSS is fitness-management software. By using it you do **not** enter any professional, fiduciary, therapeutic, medical, coaching or advisory relationship with the project or its contributors. The software provides no service to you on an ongoing basis; it operates on your device at your discretion.

## 5. Your responsibilities

You are solely responsible for:

- how you train, what loads/movements/volumes you choose, and for stopping when something hurts or seems wrong;
- obtaining professional advice appropriate to your condition — the software cannot provide it (see `docs/HEALTH_AND_FITNESS.md`);
- the accuracy of the data you enter;
- your own backups: the app stores data locally; if you do not export backups, data loss (device loss, damage, factory reset, app uninstall) can destroy your history;
- complying with the law in your jurisdiction when using or redistributing the software.

## 6. No warranties

To the maximum extent permitted by applicable law, the software is provided **"as is"** and **"as available"**, without warranty of any kind, whether express, implied, statutory or otherwise, including but not limited to warranties of merchantability, fitness for a particular purpose, accuracy, completeness, non-infringement, or that the software will be uninterrupted, error-free or secure.

Specifically and without limitation: readiness/load metrics are arithmetic over your inputs; timer functionality depends on device OS behavior; QR transport is integrity-checked but **not encrypted**; exports are only as safe as wherever you put them (see `docs/PRIVACY.md`).

## 7. Limitation of liability

To the maximum extent permitted by applicable law, the project's authors, contributors and copyright holders shall not be liable for any indirect, incidental, special, consequential or punitive damages, or any loss of data, profits, goodwill or business opportunity, arising out of or in connection with the software or its use, even if advised of the possibility of such damages.

**PLACEHOLDER FOR COUNSEL:** Nothing in this section excludes or limits liability that cannot be excluded under applicable law (including liability for death or personal injury caused by negligence, or for fraud, in jurisdictions such as the UK/EU). *This limitation of liability is presented as a starting point for review — it is expressly NOT intended as a blanket waiver of mandatory consumer rights, and any final text must be reviewed for compliance with the consumer-protection law of the distribution jurisdictions.*

## 8. Fitness and safety disclaimer

The software is not medical software and makes no health claims (`docs/HEALTH_AND_FITNESS.md`). Exercise is inherently risky. Use of the software for timing or recording workouts does not make those workouts safer.

## 9. Data, privacy and backups

- The app is local-first; the project operates no servers and collects no data (`docs/PRIVACY.md`, `docs/DATA_MAP.md`).
- Depending on your device settings, your OS may back up app data to your cloud backup provider (third-party processing by that provider, not by the project).
- The local database is not additionally encrypted beyond your device's own storage encryption.

## 10. Updates and changes

The software may change between versions, including breaking changes to the local database schema (migrations) or removal of features. There is no obligation to provide updates, support, or continuity. Version history is published with the repository.

## 11. Distribution and store terms

Installations from third-party stores (Google Play, F-Droid, GitHub Releases) are additionally subject to that store's terms. The project makes no claim of compliance with any app-store policy at this stage; distribution requirements are tracked in `docs/DISTRIBUTION.md`.

## 12. Severability and governing law

- **Severability:** if any provision is held unenforceable, the remainder continues in effect.
- **Governing law:** [JURISDICTION — to be selected by the owner with counsel; not invented here.]

## 13. Acceptance

By installing or using the software you acknowledge that you have read this draft, that you understand the software's scope and limitations, and that you use it at your own risk — subject always to the mandatory rights you hold under the law of your jurisdiction, which nothing in this document purports to remove.

---

### Review checklist (for the owner/counsel)

- [ ] Fill in operator identity, contact channel, repository URL, governing law.
- [ ] Resolve the license question (D-038) and align §3 with the chosen license.
- [ ] Verify limitation-of-liability and warranty language for each distribution jurisdiction (EU/UK consumer law, etc.).
- [ ] Confirm health/fitness disclaimer wording (with `docs/HEALTH_AND_FITNESS.md`).
- [ ] Remove the draft banner only after review is complete.
