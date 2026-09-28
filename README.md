# Dentiva Pro

**Development build only — not for clinical use or distribution.** This repository is an in-progress offline Windows dental practice manager for Bangladesh, not a validated production product.

Architecture and contractual checklist: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md). Missing modules and release blockers are recorded there.

## Development

Requires Node 22+, npm and a native C++ toolchain for `better-sqlite3`. On Windows, install with `npm ci`; run `npm run dev` and (in a separate terminal) `npx electron .`. This is only a development workflow; end users must not have to do this. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run audit:deps` verify the current implementation. `npm run package:win` is reserved for Windows CI and does not imply a validated release.

The application stores SQLite in Electron's Windows user-data directory, not the installation folder. Do not store real patient information in this development build. The application currently implements only activation, basic owner setup/login, patient registration/list/profile, visit recording, invoice creation, and partial payments. Many contractual features remain incomplete; see the status file.
