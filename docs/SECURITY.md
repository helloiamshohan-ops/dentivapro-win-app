# Security, permission contract and threat model

Every IPC request must verify an authenticated, unlocked session and effective permission in the main process; renderer visibility is only a convenience. Passwords: Argon2id with per-password random salt and versioned parameters (or scrypt with documented parameters if dependency risk dictates); never store plaintext, never log secrets. Failed login throttling and generic login error, lock/logout clear session, idle timeout 5/10/15/30/off only with admin permission. Activation code verifier is a single salted derived digest in one main-process module; static offline code is extractable with sufficient reverse engineering. No arbitrary URL load; navigation/permission requests denied by default. CSP; HTML escapes user content, printable content sanitized. Attachment MIME + magic-byte validation, random filename, size bound, no script execution. DB bound parameters and transactions. Reauth for destructive operations. Audit mutation and outcome. Ordinary users cannot read audit or passwords.

Permission keys and default role matrix: O Owner, A Administrator, D Dentist, R Receptionist, N Nurse, F Accountant, I Inventory Manager. `✓` default grant, `—` denied. Custom roles receive **no** permissions by default. Administrator cannot silently grant Owner or remove last Owner. Sensitive staff salary needs its own permission.

| Permission | O | A | D | R | N | F | I |
|---|---|---|---|---|---|---|---|
| patients.view/create/edit | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| patients.archive | ✓ | ✓ | — | — | — | — | — |
| clinical.view/visits.write/chart.write/notes.write | ✓ | ✓ | ✓ | — | view | — | — |
| clinical.prescriptions.write | ✓ | ✓ | ✓ | — | — | — | — |
| clinical.treatments.write | ✓ | ✓ | ✓ | — | — | — | — |
| clinical.attachments.write/referrals.write | ✓ | ✓ | ✓ | — | — | — | — |
| appointments.view/create/edit/cancel | ✓ | ✓ | ✓ | ✓ | view | — | — |
| queue.manage | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| billing.invoices.create | ✓ | ✓ | — | ✓ | — | ✓ | — |
| billing.invoices.view | ✓ | ✓ | — | ✓ | — | ✓ | — |
| billing.invoices.void | ✓ | ✓ | — | — | — | ✓ | — |
| billing.payments.record | ✓ | ✓ | — | ✓ | — | ✓ | — |
| billing.payments.view | ✓ | ✓ | — | ✓ | — | ✓ | — |
| finance.reports.view/export | ✓ | ✓ | — | — | — | ✓ | — |
| accounting.view/write | ✓ | ✓ | — | — | — | ✓ | — |
| inventory.view/write | ✓ | ✓ | — | — | — | — | ✓ |
| staff.view/edit | ✓ | ✓ | — | — | — | — | — |
| staff.salary.view/edit | ✓ | ✓ | — | — | — | — | — |
| users.manage/roles.manage | ✓ | ✓* | — | — | — | — | — |
| backup.create | ✓ | ✓ | — | — | — | — | — |
| backup.restore | ✓ | — | — | — | — | — | — |
| settings.manage/printers.manage | ✓ | ✓ | — | — | — | — | — |
| audit.view/destructive.execute | ✓ | — | — | — | — | — | — |

*Admin cannot create an Owner role assignment or grant owner-only permissions. Reports/exports/dashboard financial widgets use `finance.reports.view`/`export`; invoice/payment screens do not imply report access. PHI-bearing search, notifications, printing and attachments require the underlying entity permission. No secret-knowledge backdoor. RBAC tests must enumerate every role × every sensitive IPC operation, including request tampering.
