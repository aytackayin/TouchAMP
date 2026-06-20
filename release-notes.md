# 🚀 TouchAMP v1.0.7

## 🛠️ Fixes

### Auto-update no longer gets stuck ("Applying update..." forever)
A critical bug caused the update process to hang indefinitely on the "Applying update..." screen. The root cause: the update endpoint exited the forked server process, which the Electron main process interpreted as an unexpected crash and **immediately restarted** — so the app never closed and the loader stayed on screen forever.

- The update endpoint now signals the Electron main process to **quit cleanly** via a new `apply-update` IPC message instead of force-exiting. The detached updater script (which already relaunches the new build) is unaffected.
- Removed the duplicate confirmation dialog (the same message appeared twice — once as a confirm prompt, once as an alert).
- The confirmation prompt now asks an actual question instead of showing a status sentence.

## 📥 Download Instructions
Download the `TouchAMP_v1.0.7-win32-x64.zip` file below, extract it anywhere on your Windows PC, and double click `TouchAMP.exe` to launch.

---
*Developed with ❤️ by Aytaç KAYIN.*

# 🚀 TouchAMP v1.0.6

## 🛠️ Fixes

### Auto-update rewritten (fast + safe)
The previous updater copied files one-by-one through PowerShell, which was slow (often 15-25 minutes) and exposed user data to risk. It is now replaced with a bulk-extract approach:

- The new ZIP is extracted directly over the existing installation in one go, instead of 3000+ individual `Copy-Item` calls.
- Before the extract, the following user data is **moved aside** (not copied, so antivirus does not rescan it):
  - `www/`, `data/`, `backups/`, `mysql_exports/`, `bin/versions/`
  - `etc/apache2/sites-enabled/`, `etc/ssl/`
  - `settings.json`, `cron.json`, `quick_access.json`
- After the extract, the preserved items are moved back to their original locations.
- If anything fails, the catch block restores everything from the backup.

Typical update time drops from 15-25 minutes to 1-3 minutes on a normal disk.

### Release ZIP is now clean of user data
`build-custom.js` no longer copies `www/`, `backups/`, `mysql_exports/`, `etc/apache2/sites-enabled/`, `etc/ssl/`, or `quick_access.json` into the release artifact. User data only ever lives in the host installation, never in the published ZIP.

## 📥 Download Instructions
Download the `TouchAMP_v1.0.6-win32-x64.zip` file below, extract it anywhere on your Windows PC, and double click `TouchAMP.exe` to launch.

---
*Developed with ❤️ by Aytaç KAYIN.*

## ✨ What's New in v1.0.5 — Deploy to Hosting (FTP/FTPS + Remote MySQL)

A new one-click **Deploy to Hosting** feature for every project in `www/`. Configure mappings, exclusions, FTP/FTPS and remote MySQL — then upload changed files with a single click.

### 🆕 Deploy to Hosting (Mapping Rules)
- **Per-project Deploy Settings** — every project has its own settings (stored inside the project folder at `<project>/.touchamp/deploy.json`).
- **Settings button + Upload button** on each project card. The settings gear opens the deploy modal; the cloud-upload button deploys in one click.
- **3-tab settings modal**:
  1. **Mapping Rules** — define rules `from (project) → to (hosting)`. Each rule has a `from` (file or folder), a target path, and a type. Add, remove, and reorder rules (order matters — first match wins). Use a tree-based picker to select sources.
  2. **Exclusions** — select files/folders to never upload (e.g. `.env`, local-only files). The exclusion tree is fully manual — nothing is hidden or auto-excluded.
  3. **FTP / FTPS & MySQL** — host, port, user, password, FTPS toggle, optional TLS-strict mode. Remote MySQL: host, port, user, password, remote DB name, local DB source, "update database" enable.
- **Folder → folder mapping** (e.g. `app` → `noykozmetik/app` keeps the directory structure). **File → path** or **file → folder** (drop into a folder keeping its name).
- **Incremental uploads** — only files changed since the last successful deploy are uploaded. Detected via `git status` if the project has a `.git` directory, otherwise by file mtime. "Full upload" option forces re-upload of everything.
- **Automatic remote DB backup** before the import (stored under `backups/deploy/`). The remote DB must exist on the hosting first; the import replaces shared tables and keeps remote-only tables.
- **Server-side cancel** — the in-progress deploy can be cancelled (Cancel button in the progress view).
- **Security** — strict remote DB name validation, no shell in MySQL dump/import (uses `spawn` + `defaults-extra-file`), `..` segments clamped in remote paths, FTPS cert verification is opt-in per project.

### 🛠️ Backup System — Shared-Hosting-Friendly SQL Export
- The `mysqldump` output is now post-processed to strip statements that shared-hosting MySQL often rejects (binary-log toggles, GTID state, transactional wrappers, dump-completed comments, etc.). The result resembles a phpMyAdmin export and imports cleanly on most providers.

### 🔧 Other Changes
- Settings, exclude rules and the deploy modal are fully under user control — **no automatic file filtering**. Nothing is hidden from the tree or auto-skipped at upload time.
- The deploy config is now per-project (`<project>/.touchamp/deploy.json`) so each project ships its own deploy setup.
- Migrated, hardened and tested: pickers, modal tabs, exclude tree, MySQL dump streaming, change detection, cancel flow.

## 📥 Download Instructions
Download the `TouchAMP_v1.0.5-win32-x64.zip` file below, extract it anywhere on your Windows PC, and double click `TouchAMP.exe` to launch.

---
*Developed with ❤️ by Aytaç KAYIN.*
