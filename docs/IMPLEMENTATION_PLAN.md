# Dentiva Pro — contractual implementation plan

Status: **planning complete; implementation and validation incomplete**. This document is a traceable checklist, not a claim of delivery. All items are release-blocking unless specifically described as a design decision. Spec section numbers refer to the 123 numbered sections of the product brief.

## Interpretation and gaps resolved before implementation
- One clinic per installation, multiple dentists/users, single local computer. Simultaneous access from other computers is **not** implied by offline desktop; no LAN endpoint is exposed. A later computer migration must use an authenticated, verified backup/restore, not shared SQLite files.
- Bangladesh time zone `Asia/Dhaka`; timestamps in UTC, local date boundaries computed in Dhaka. Monetary values stored as signed integer poisha, currency BDT, no floating-point calculations.
- No SMS/email delivery offline: reminders are in-app notifications, explicitly labeled as such; no claim of external delivery. Browser/Windows print availability depends on installed OS printer drivers. No medical diagnosis automation or dosage suggestions. Clinical decisions belong to licensed practitioners.
- Payment reversal is a separate audited compensating transaction; finalized invoice line snapshots cannot be edited. Numbering is scoped per installation, sequential with transaction-safe allocation. Financial reports and patient balances require distinct permissions from invoice creation/payment intake.
- Backups are **full snapshots only**. Selecting multiple backups means choosing one verified point-in-time snapshot; merging independent backups is unsafe and will not be offered. Scheduled backups run when the app is open, and missed backups run at next launch. Backup location must not be inside app installation directory.
- Custom paper profiles specify physical millimeters, margins and minimum supported printable width; receipts reflow into single column. Printer discovery and actual paper selection use OS print dialogue. Actual physical output needs a Windows printer test, not just PDF inspection.
- Owner is established by the setup wizard with no hardcoded password. Owners cannot remove the last active owner. Elevated destructive operations reauthenticate. Audit history is append-only at the service boundary, though a local machine administrator can manipulate on-disk files; this is a documented offline threat limitation.
- Local data protection: Windows per-user app data with restrictive ACLs; protect backups at rest with an operator-supplied passphrase (never embedded); protect session keys in memory. If SQLite is not encrypted, physical disk compromise is not solved by RBAC; recommend BitLocker. Do not falsely claim at-rest encryption unless implemented.
- Release signing needs a separately supplied code-signing certificate. Unsigned installer may trigger SmartScreen; no paid service or invented certification is permitted. Security updates cannot be guaranteed if no later release is planned; disclose residual security risk rather than claiming permanent safety.
- Recovery and support: documented paths, transactional schema migrations, integrity check, logs with no PHI or secrets, retention/rotation, disk-full handling, restore to staging and atomic swap/rollback, external backup verification and restore drill.
- Input safety: CSRF is avoided by no HTTP server; Electron IPC has an explicit allowlist and server-side validation. Never interpolate untrusted SQL or file paths. Do not execute attachments. Reject symlinks/traversal and ambiguous file formats. Explicit patient consent/retention workflows and local privacy policy are operational clinic responsibilities.

## Formal implementation checklist (all unchecked until verified)
### Foundations
- [ ] 1–8, 64–67, 70–72, 89–90, 95–97, 100–103: offline Electron desktop lifecycle, persistent data directories, migrations, security boundary, configuration, logging, failure recovery, no paid/network dependencies.
- [ ] 9–12, 52–56, 86–88, 109: Windows icon all sizes, premium design tokens, accessible shell, sidebar/header, all route inventories and states, responsive and DPI tests.
- [ ] 59–60, 63–64: correct About metadata, offline activation derived verifier, first-run step validation, secure first owner.
### Practice and clinical
- [ ] 13–17, 40–42, 69, 80: live dashboard, unlimited paginated patient directory, profile, actions, filterable immutable timeline, attachments, indexed global search, notification center.
- [ ] 18–19, 47–48, 96: permanent visits, dentist snapshots, adult/child interactive chart with statuses and history, mixed English/Bengali data.
- [ ] 20–22, 33: appointment calendar/list/day/week, statuses, real queue transitions, configurable treatment catalog and suppliers.
- [ ] 23–26, 46, 50–51, 84: prescriptions with arbitrary medication rows, reflowing templates, printer profiles, PDF/print tests including Bengali and signature clearance.
### Business
- [ ] 27–32, 49, 79, 81–82, 98: finalized invoices/void corrections, payments, integer accounting, expense/income reporting, stock ledger, nonnegative stock, supplier and financial permission enforcement.
- [ ] 34–39, 44–45: staff, custom roles, password/session security, auto-lock, audit, referrals, referential integrity and destructive-action safeguards.
- [ ] 43, 65, 83: verified full backups, scheduler, pre-restore safety snapshot, passphrase/atomic restore and restore tests.
- [ ] 46, 57–58, 87, 91–92: settings, validation, real exports, shortcuts, actionable errors, no fake controls.
### Shipping gates
- [ ] 6–7, 61–62, 73–78, 85, 93–94, 104–108, 110–118: license audit/third-party notices, installer/uninstaller, Windows CI, tests, clean machine, stress, screen/source/security audit, version, signed-or-disclosed release, GitHub release or validated dist fallback.
- [ ] 78–85, 106–107, 119–123: automated matrix plus end-to-end acceptance sequence and complete regression after fixes; report only observed results.

## Sequenced phases and exit criteria
1. Requirements and gaps: trace this document to every numbered section; unresolved risks recorded. **Documented**.
2. Architecture/schema/RBAC/UI/printing/backup/installer/test/release: approved designs in docs. **Documented, not validated**.
3. Foundation: reproducible build, data directories, transactions, secure process and first-run auth; tests pass.
4. Clinical: patients/visits/chart/appointments/queue/treatments/prescriptions; persistence, authorization and timeline tests.
5. Business: billing/payments/accounting/inventory/suppliers/staff/roles/settings; hostile authorization tests.
6. Integration: attachments, exports, notifications, search, print, backup/restore; real files and output tests.
7. Automated tests then manual workflow, security, visual/accessibility, stress, Windows installer/uninstaller, printer/PDF/Bengali/DPI, clean machine, offline regression. Record evidence and failures.
8. Release: dependency audit, CI green, validated Windows artifact, PR/review as appropriate, tag/release. Never release from Linux-only checks.

## Definition of Done
A feature is done only when its UI, persistence, validation, permissions, audit, empty/loading/error/success UX, keyboard accessibility, offline behavior, Unicode, tests and relevant document output are demonstrated with evidence. The product is done only after **all** unchecked items pass, full acceptance scenario and regression pass, Windows clean-machine and printer tests pass, all release blockers resolved and a distributable installer is validated. An interrupted turn is NOT acceptance.

## Acceptance-test matrix (evidence required)
| Flow | Positive | Adversarial/negative | Evidence |
|---|---|---|---|
| Setup/auth/activation | activate offline, create owner/dentists, login/lock/unlock | wrong code/password, lockout, last owner removal, expired session | automated + Windows run |
| Patients/visits/chart | create/search/archive, many visits, tooth histories, Unicode | duplicates, archived access, stale write, wrong-role write | DB + UI + E2E |
| Calendar/queue | schedule, transition, reschedule, no-show | collision, duplicate active queue, invalid transitions | integration + UI |
| Prescriptions | arbitrary items, historical dentist/medicine snapshots | long/Bengali text and paper widths | PDF image diff + physical print |
| Billing | discount, partial/multiple payments, reversal, void | overpayment and unauthorized report/export/API/IPC | service + UI + DB |
| Accounting/inventory | reports, purchase, stock movement, expiry | negative stock, missing supplier, unauthorized finance | service + stress |
| Files/backup | valid attachment, encrypted backup, verify, restore drill | traversal, bad MIME, corruption, incompatible version, disk full | integration + Windows drill |
| Release | fresh install, start menu, no network, print, uninstall/reinstall | missing runtime, interrupted install, retain user data | clean Windows VM + CI artifact |

See `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `DESIGN_SYSTEM.md`, `PRINTING.md`, `BACKUP_RESTORE.md`, `TESTING.md`, `RELEASE.md` and `PROJECT_STATUS.md` for implementation contracts.
