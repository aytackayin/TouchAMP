# 🚀 TouchAMP v1.0.12

## ✨ Improvements

### Scheduled Tasks — friendly schedule input (no more `*****` errors)
The cron schedule field used to reject common shorthand entries like `*****` (every minute) or `*/5****` (every 5 minutes) because the fields weren't space-separated. Users had to know the exact 5-field syntax up-front, which led to confusing "Invalid schedule format" errors.

- The schedule input now **auto-formats** as you type: once 5 cron tokens are detected, missing spaces are inserted automatically (e.g. `*****` → `* * * * *`, `*/5****` → `*/5 * * * *`).
- The **Add** button also normalizes the value before saving, and shows a friendly toast (`Schedule auto-formatted: * * * * *`) so you always see what was stored.
- The same normalization runs **server-side** (POST/PUT endpoints and the cron runner) so direct API calls and existing cron files are also protected.
- Existing 5-field expressions like `0 3 * * *`, `*/15 * * * *`, `0,15,30,45 * * * *`, and `1-5/2 * * * *` are recognized correctly and pass through untouched.

## 🛠️ Documentation
- README and BENIOKU now document the **Deploy to Hosting** feature (FTP/FTPS + remote MySQL) that shipped in v1.0.5 but was missing from the public docs.

## 📥 Download Instructions
Download the `TouchAMP_v1.0.12-win32-x64.zip` file below, extract it anywhere on your Windows PC, and double click `TouchAMP.exe` to launch.

---
*Developed with ❤️ by Aytaç KAYIN.*

# 🚀 TouchAMP v1.0.11

## ✨ Improvements

### Clear update progress — no more wondering "what's happening?"
The update used to show a single silent "Applying update..." spinner for the whole process (including a ~296 MB download), and after the app closed there was no feedback at all for ~30 s. Now:

- The updater shows a **live download progress** with MB and percentage ("Downloading update... 142 / 296 MB (48%)").
- When the download finishes, it clearly says **"Applying update... the app will close and restart in a moment."** so you know what to expect.
- After the restart, a toast confirms **"TouchAMP updated to v1.0.11."**
- Reduced unnecessary wait time (services-stopping and pre-extract sleeps shortened).

## 📥 Download Instructions
Download the `TouchAMP_v1.0.11-win32-x64.zip` file below, extract it anywhere on your Windows PC, and double click `TouchAMP.exe` to launch.

---
*Developed with ❤️ by Aytaç KAYIN.*

# 🚀 TouchAMP v1.0.10

## 🛠️ Fixes

### Auto-update now works reliably (no more broken-junction / multi-GB copy failure)
v1.0.9 escaped the Electron Job Object correctly, but the updater still tried to **move all user data aside** (www, data, etc.) before extracting — and back afterwards. This copied the entire `www` folder (5 GB+) across drives (F: → C:\Temp) and crashed on a broken junction (`www\blg\public\attachments`), leaving the app closed and never restarted.

This was pointless: the release ZIP **never contains user data** (excluded by the build). So the fix is to stop moving anything aside.

- The updater now simply extracts the release ZIP directly over the install folder and launches the new build. Application files are overwritten; **user data is never touched**.
- Result: updates complete in seconds instead of minutes, and can't be broken by large folders or broken junctions in `www`.

## 📥 Download Instructions
Download the `TouchAMP_v1.0.10-win32-x64.zip` file below, extract it anywhere on your Windows PC, and double click `TouchAMP.exe` to launch.

---
*Developed with ❤️ by Aytaç KAYIN.*

# 🚀 TouchAMP v1.0.9

## 🛠️ Fixes

### Auto-update now completes reliably (synchronous Task Scheduler registration)
v1.0.8 tried to escape Electron's Windows Job Object by re-launching the updater through Task Scheduler, but that re-launch itself happened in a detached process that was still killed by the job before it could register the task — so the update still silently failed.

- The updater task is now registered and started **synchronously** (before the app quits), so the Task Scheduler service has taken over the job before Electron tears down its job object. The scheduled task runs completely outside the Electron process tree and performs the extraction + relaunch at Highest privilege.
- The one-shot task removes itself when the update finishes.

## 📥 Download Instructions
Download the `TouchAMP_v1.0.9-win32-x64.zip` file below, extract it anywhere on your Windows PC, and double click `TouchAMP.exe` to launch.

---
*Developed with ❤️ by Aytaç KAYIN.*

# 🚀 TouchAMP v1.0.8

## 🛠️ Fixes

### Auto-update now actually restarts the app (Job Object fix)
v1.0.7 fixed the endless "Applying update..." screen, but the app would still **close and never come back**. The detached updater PowerShell process was being killed by Electron's Windows Job Object the moment the app quit — so the download finished but the extraction never happened.

- The updater now re-launches itself through **Task Scheduler**, which runs completely detached from the Electron Job Object and at Highest privilege. It survives the app quitting and correctly extracts the new build and relaunches it.
- The one-shot scheduled task cleans itself up after the update completes.

## 📥 Download Instructions
Download the `TouchAMP_v1.0.8-win32-x64.zip` file below, extract it anywhere on your Windows PC, and double click `TouchAMP.exe` to launch.

---
*Developed with ❤️ by Aytaç KAYIN.*

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
