// ══════════════════════════════════════════════════════════
// TouchAMP — Deploy to Hosting (FTP/FTPS + Remote MySQL)
// Mappings modeli: from (proje) → to (hosting) kuralları,
// her dosya/klasör için ayrı hedef.
// ══════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn, execSync } = require('child_process');

// Lazy-load basic-ftp
let ftpClient = null;
function getFtp() {
    if (ftpClient === null) {
        try { ftpClient = require('basic-ftp'); }
        catch (e) { ftpClient = false; }
    }
    return ftpClient;
}

const DEPLOY_DIRNAME = '.touchamp';
const DEPLOY_FILENAME = 'deploy.json';

// User has full control. No automatic exclusions — mappings + exclude rules
// in deploy.json are the single source of truth. Nothing is hidden from the
// tree or auto-skipped at upload time.

function deployConfigPath(projectPath) {
    return path.join(projectPath, DEPLOY_DIRNAME, DEPLOY_FILENAME);
}

function defaultConfig() {
    return {
        mappings: [],   // [{ from: 'app', to: 'noykozmetik', type: 'folder'|'file' }, ...]
        exclude: [],    // relative paths
        ftp: {
            host: '', port: 21, user: '', password: '',
            secure: false, verifyTls: false
        },
        mysql: {
            enabled: false,
            host: '', port: 3306, user: '', password: '',
            remoteDb: '', localDb: ''
        },
        uploadedFiles: {}, // remotePosixPath -> mtimeMs
        lastUpload: null
    };
}

function isValidMapping(m) {
    return m && typeof m.from === 'string' && typeof m.to === 'string' &&
           (m.type === 'file' || m.type === 'folder') &&
           m.from.length > 0 && !m.from.includes('..') && !m.to.includes('..');
}

function loadConfig(projectPath) {
    const cfgPath = deployConfigPath(projectPath);
    if (!fs.existsSync(cfgPath)) return defaultConfig();
    try {
        const data = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        const base = defaultConfig();
        return {
            mappings: Array.isArray(data.mappings) ? data.mappings.filter(isValidMapping) : base.mappings,
            exclude: Array.isArray(data.exclude) ? data.exclude : base.exclude,
            ftp: Object.assign(base.ftp, data.ftp || {}),
            mysql: Object.assign(base.mysql, data.mysql || {}),
            uploadedFiles: data.uploadedFiles || {},
            lastUpload: data.lastUpload || null
        };
    } catch (e) {
        return defaultConfig();
    }
}

function saveConfig(projectPath, cfg) {
    const dir = path.join(projectPath, DEPLOY_DIRNAME);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(deployConfigPath(projectPath), JSON.stringify(cfg, null, 4));
}

// ─── EXCLUDE HELPERS ───

function buildExcludeSet(exclude) {
    const set = new Set();
    (exclude || []).forEach(p => {
        if (!p) return;
        let n = String(p).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
        if (n) set.add(n);
    });
    return set;
}

function isExcluded(relPath, excludeSet) {
    if (!relPath) return false;
    const parts = relPath.split('/');
    for (let i = 1; i <= parts.length; i++) {
        const candidate = parts.slice(0, i).join('/');
        if (excludeSet.has(candidate)) return true;
    }
    return excludeSet.has(relPath);
}

// ─── PROJECT TREE ───

function readTreeFolder(projectPath, relSubdir) {
    const absDir = relSubdir ? path.join(projectPath, relSubdir) : projectPath;
    if (!fs.existsSync(absDir)) return [];
    let entries = [];
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch (e) { return []; }
    const result = [];
    for (const e of entries) {
        const rel = relSubdir ? `${relSubdir}/${e.name}` : e.name;
        if (e.isDirectory()) {
            result.push({ name: e.name, type: 'dir', path: rel, hasChildren: true });
        } else if (e.isFile()) {
            result.push({ name: e.name, type: 'file', path: rel });
        }
    }
    result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    return result;
}

// ─── GIT DIFF / MTIME CHANGE DETECTION ───

// Returns a Set<relPath> of files changed since last commit (or staged/unstaged).
// Returns null if no .git, so caller can fall back to mtime.
function getGitChangedFiles(projectPath) {
    const gitDir = path.join(projectPath, '.git');
    if (!fs.existsSync(gitDir)) return null;
    try {
        // Show modified (staged + unstaged) + untracked, working-tree only
        const out = execSync(
            'git -c core.quotepath=false status --short --untracked-files=all --porcelain',
            { cwd: projectPath, encoding: 'utf-8', windowsHide: true, timeout: 15000 }
        );
        const changed = new Set();
        for (let line of out.split(/\r?\n/)) {
            if (!line || !line.trim()) continue;
            // Porcelain v1: XY <path>  (X=index, Y=worktree)
            // Rename: R  old -> new   (we want the new path)
            const m = line.match(/^(..)\s+(.+?)(?:\s+->\s+(.+))?$/);
            if (!m) continue;
            const xy = m[1];
            let p = (m[3] || m[2]).trim().replace(/\\/g, '/');
            // Strip surrounding quotes
            if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
            // Remove the "?? " prefix for untracked? --porcelain already strips it
            // Drop untracked folders' content? No — we use workingTree diff. We'll include the folder itself
            // and the recursive walker will expand it.
            // '??' is untracked, ' M' is modified, 'M ' is staged, 'A ' added, 'D ' deleted, 'R ' renamed, 'C ' copied
            if (xy === 'D ' || xy === ' D' || xy === 'DD') continue; // deleted locally
            // For untracked dirs git reports just the dir; expand later
            changed.add(p);
        }
        return changed;
    } catch (e) {
        return null;
    }
}

// Given a set of changed top-level paths (some may be files, some dirs),
// expand to all actual files (recursive).
function expandChangedToFiles(projectPath, changedTopPaths) {
    const files = new Set();
    for (const rel of changedTopPaths) {
        const abs = path.join(projectPath, rel.split('/').join(path.sep));
        try {
            const st = fs.statSync(abs);
            if (st.isFile()) {
                files.add(rel);
            } else if (st.isDirectory()) {
                walkAdd(abs, rel, files);
            }
        } catch (e) {}
    }
    return files;
}

function walkAdd(absDir, relDir, set) {
    let entries = [];
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
        const rel = relDir ? `${relDir}/${e.name}` : e.name;
        const abs = path.join(absDir, e.name);
        if (e.isDirectory()) walkAdd(abs, rel, set);
        else if (e.isFile()) set.add(rel);
    }
}

// ─── RESOLVE MAPPINGS TO (localAbs, remoteRel) PAIRS ───

// For each mapping, produce concrete (localAbs, remotePosixPath) pairs.
// Folders expand recursively. Only the user-defined exclude set filters files.
function resolveMappingFiles(projectPath, mapping, excludeSet) {
    const fromRel = posixNormalize(mapping.from);
    const fromAbs = path.join(projectPath, fromRel.split('/').join(path.sep));
    const toBaseRaw = String(mapping.to || '').replace(/\\/g, '/');
    const toBase = posixNormalize(toBaseRaw);
    const isFolderTarget = toBaseRaw.endsWith('/');
    const pairs = [];
    if (!fs.existsSync(fromAbs)) return pairs;
    const st = fs.statSync(fromAbs);
    if (st.isFile()) {
        if (!isExcluded(fromRel, excludeSet)) {
            let remote;
            if (isFolderTarget) {
                remote = toBase + '/' + path.basename(fromAbs);
            } else {
                remote = toBase;
            }
            pairs.push({ localAbs: fromAbs, remotePath: posixNormalize(remote) });
        }
    } else if (st.isDirectory()) {
        // Walk: relFromProject tracks the project-root-relative path (for exclude checks);
        // relWithin tracks the within-folder path (for the remote target).
        walkMapping(fromAbs, fromRel, '', toBase, excludeSet, pairs);
    }
    return pairs;
}

function walkMapping(absDir, relFromProject, relWithin, toBase, excludeSet, pairs) {
    let entries = [];
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
        const nextFromProject = relFromProject ? `${relFromProject}/${e.name}` : e.name;
        const nextWithin = relWithin ? `${relWithin}/${e.name}` : e.name;
        const abs = path.join(absDir, e.name);
        if (e.isSymbolicLink()) {
            continue; // Always ignore symlinks/junctions during upload walk (Yöntem A)
        }
        if (e.isDirectory()) {
            if (isExcluded(nextFromProject, excludeSet)) continue;
            walkMapping(abs, nextFromProject, nextWithin, toBase, excludeSet, pairs);
        } else if (e.isFile()) {
            if (isExcluded(nextFromProject, excludeSet)) continue;
            const remotePath = (toBase === '/' || toBase === '') ? '/' + nextWithin : toBase + '/' + nextWithin;
            pairs.push({ localAbs: abs, remotePath: posixNormalize(remotePath) });
        }
    }
}

function posixNormalize(p) {
    return String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
}

// ─── PROGRESS MAP ───
const deployProgressMap = {};

function setProgress(taskId, patch) {
    const cur = deployProgressMap[taskId];
    if (!cur) return;
    deployProgressMap[taskId] = Object.assign(cur, patch);
}

function isCancelled(taskId) {
    const cur = deployProgressMap[taskId];
    return !cur || cur.status === 'cancelled';
}

// ─── FTP PATH HELPERS ───

// Normalize a remote base path. Any ".." segment is dropped, so it can never
// escape the FTP root.
function absFtpPath(remotePath) {
    let combined = (remotePath || '/').replace(/\\/g, '/');
    const segs = [];
    for (const s of combined.split('/')) {
        if (s === '' || s === '.') continue;
        if (s === '..') continue;
        segs.push(s);
    }
    return '/' + segs.join('/');
}

async function withFtp(F, timeoutMs, work) {
    const ftp = getFtp();
    if (!ftp) throw new Error('FTP library (basic-ftp) is not installed.');
    if (!F.host || !F.user) throw new Error('FTP host/user not configured.');
    const client = new ftp.Client(timeoutMs || 60000);
    client.ftp.verbose = false;
    let connected = false;
    try {
        await client.access({
            host: F.host, port: F.port || 21, user: F.user,
            password: F.password || '', secure: !!F.secure,
            secureOptions: { rejectUnauthorized: !!F.verifyTls }
        });
        connected = true;
        return await work(client);
    } finally {
        if (connected) { try { await client.close(); } catch (e) {} }
    }
}

// Upload one file to its remote absolute path. Creates parent dirs as needed.
async function ftpUploadOne(client, localAbs, remotePath) {
    const abs = absFtpPath(remotePath);
    const remoteDir = abs.lastIndexOf('/') > 0 ? abs.slice(0, abs.lastIndexOf('/')) : '/';
    const remoteName = abs.slice(abs.lastIndexOf('/') + 1);
    if (remoteDir && remoteDir !== '/') {
        await client.ensureDir(remoteDir).catch(() => {});
    }
    await client.uploadFrom(localAbs, remoteName);
}

async function ftpUploadPairs(F, pairs, taskId, progressKey) {
    let client = null;
    let connected = false;

    const ftp = getFtp();
    if (!ftp) throw new Error('FTP library (basic-ftp) is not installed.');

    const connect = async () => {
        if (connected) return;
        client = new ftp.Client(60000);
        client.ftp.verbose = false;
        await client.access({
            host: F.host, port: F.port || 21, user: F.user,
            password: F.password || '', secure: !!F.secure,
            secureOptions: { rejectUnauthorized: !!F.verifyTls }
        });
        connected = true;
    };

    const close = async () => {
        if (connected && client) {
            try { await client.close(); } catch (e) {}
        }
        connected = false;
        client = null;
    };

    try {
        setProgress(taskId, { phase: 'ftp_connect', message: translate('deploy_connecting', 'Connecting to FTP server...') });
        await connect();

        for (let i = 0; i < pairs.length; i++) {
            if (isCancelled(taskId)) break;
            const { localAbs, remotePath } = pairs[i];
            
            let attempts = 0;
            let success = false;
            let lastError = null;

            while (attempts < 3 && !success) {
                if (isCancelled(taskId)) break;
                try {
                    await connect();
                    await ftpUploadOne(client, localAbs, remotePath);
                    success = true;
                } catch (err) {
                    attempts++;
                    lastError = err;
                    await close();
                    if (attempts < 3) {
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        setProgress(taskId, { message: translate('deploy_reconnecting', 'Connection lost. Reconnecting... (Attempt {x}/3)', { x: attempts }) });
                    }
                }
            }

            if (!success && lastError) {
                throw lastError;
            }

            try {
                const mtime = Math.round(fs.statSync(localAbs).mtimeMs / 1000) * 1000;
                deployProgressMap[taskId].uploadedFiles[remotePath] = mtime;
            } catch (e) {}

            setProgress(taskId, {
                progress: Math.round(((i + 1) / pairs.length) * 100),
                message: translate('deploy_uploading_file', 'Uploading: {x} ({y}/{z})', { x: remotePath, y: i + 1, z: pairs.length })
            });
        }
    } finally {
        await close();
    }
}

// ─── REMOTE MYSQL ───

const DB_NAME_RE = /^[A-Za-z0-9_$]{1,64}$/;

function mysqlPluginDir(config) {
    if (!config.MYSQL_BIN) return null;
    const binDir = path.dirname(config.MYSQL_BIN);
    const pluginDir = path.join(binDir, '..', 'lib', 'plugin');
    return fs.existsSync(pluginDir) ? path.resolve(pluginDir).replace(/\\/g, '/') : null;
}

function mysqlPluginArgs(config) {
    const dir = mysqlPluginDir(config);
    return dir ? [`--plugin-dir=${dir}`] : [];
}

function writeDefaultsFile(creds) {
    const tmp = path.join(os.tmpdir(), `ta_mysql_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.cnf`);
    const lines = ['[client]'];
    lines.push('default-character-set=utf8mb4');
    if (creds.host) lines.push(`host="${creds.host}"`);
    if (creds.port) lines.push(`port=${creds.port}`);
    if (creds.user) lines.push(`user="${creds.user}"`);
    const pwd = (creds.password || '').replace(/"/g, '\\"');
    lines.push(`password="${pwd}"`);
    fs.writeFileSync(tmp, lines.join('\n'), 'utf-8');
    return tmp;
}

function mysqlBinPath(config, exe) {
    if (!config.MYSQL_BIN || !fs.existsSync(config.MYSQL_BIN)) return null;
    return path.join(path.dirname(config.MYSQL_BIN), exe);
}

let _dumpMajorVer = null;
function dumpSupportsColumnStats(dumpBin) {
    if (_dumpMajorVer !== null) return _dumpMajorVer >= 8;
    try {
        const out = execFileSync(dumpBin, ['--version'], { encoding: 'utf-8', windowsHide: true, timeout: 8000 });
        const m = out.match(/Distrib\s+(\d+)/i) || out.match(/Ver\s+(\d+)/i);
        _dumpMajorVer = m ? parseInt(m[1], 10) : 0;
    } catch (e) { _dumpMajorVer = 0; }
    return _dumpMajorVer >= 8;
}

// Strip mysqldump output of statements that shared-hosting MySQL often rejects
// (binary-log toggles, GTID state, transactional wrappers, dump-completed comments).
// The result resembles a phpMyAdmin export and imports cleanly on most providers.
const DUMP_DROP_PATTERNS = [
    /^SET\s+@@SESSION\.SQL_LOG_BIN/i,
    /^SET\s+@MYSQLDUMP_TEMP_LOG_BIN/i,
    /^SET\s+@@GLOBAL\.GTID_PURGED/i,
    /^SET\s+@@SESSION\.SQL_LOG_BIN\s*=\s*@MYSQLDUMP_TEMP_LOG_BIN/i,
    /^SET\s+@@SESSION\.SQL_LOG_BIN\s*=\s*\d/i,
    /^\/\*!40103\s+SET\s+TIME_ZONE/i,
    /^START\s+TRANSACTION\s*;?$/i,
    /^COMMIT\s*;?$/i,
    /^--\s*Dump completed on/i,
    /^--\s*GTID\s+state\s+at\s+the\s+beginning/i
];
const DUMP_DROP_LINE_COMMENT = /^--\s*$/;

function transformDumpChunk(buffer) {
    const text = buffer.toString('utf-8');
    const lines = text.split(/\r?\n/);
    const out = [];
    let inGtidBlock = false;
    for (const raw of lines) {
        const line = raw.replace(/\s+$/, '');
        if (inGtidBlock) {
            // GTID block ends at the standalone '' (empty quoted) SET @@GLOBAL.GTID_PURGED line
            if (/^SET\s+@@GLOBAL\.GTID_PURGED\s*=/i.test(line) || /^\s*'\s*'\s*;?\s*$/.test(line)) {
                inGtidBlock = false;
                continue;
            }
            continue;
        }
        if (/^--\s*GTID\s+state\s+at/i.test(line)) { inGtidBlock = true; continue; }
        let drop = false;
        for (const p of DUMP_DROP_PATTERNS) { if (p.test(line)) { drop = true; break; } }
        if (drop) continue;
        if (DUMP_DROP_LINE_COMMENT.test(line)) continue;
        out.push(line);
    }
    return out.join('\n');
}

function dumpToFile(bin, args, outFile) {
    return new Promise((resolve, reject) => {
        const out = fs.createWriteStream(outFile);
        const child = spawn(bin, args, { windowsHide: true });
        let errBuf = '';
        let pending = '';
        child.stderr.on('data', d => { errBuf += d.toString(); });
        child.stdout.on('data', chunk => {
            pending += chunk.toString('utf-8');
            const idx = pending.lastIndexOf('\n');
            if (idx < 0) return;
            const complete = pending.slice(0, idx);
            pending = pending.slice(idx + 1);
            out.write(transformDumpChunk(complete));
        });
        child.on('error', reject);
        child.on('close', code => {
            if (pending) out.write(transformDumpChunk(pending));
            out.end(() => {
                if (code === 0) resolve();
                else reject(new Error(shortErr(errBuf || `process exited with code ${code}`)));
            });
        });
    });
}

function importFromFile(bin, args, inFile) {
    return new Promise((resolve, reject) => {
        const inp = fs.createReadStream(inFile);
        const child = spawn(bin, args, { windowsHide: true });
        let errBuf = '';
        child.stderr.on('data', d => { errBuf += d.toString(); });
        child.stdin.on('error', () => {});
        inp.pipe(child.stdin);
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(shortErr(errBuf || `process exited with code ${code}`)));
        });
    });
}

function mysqlQuery(bin, defaultsFile, sql, extraArgs) {
    return new Promise((resolve, reject) => {
        execFile(bin, [`--defaults-extra-file=${defaultsFile}`, ...(extraArgs || []), '-N', '-B', '-e', sql],
            { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 * 16 },
            (err, stdout, stderr) => {
                if (err) return reject(new Error(shortErr(stderr || err.message)));
                resolve(stdout);
            });
    });
}

function cleanupFile(p) { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {} }
function shortErr(s) { return String(s || '').split('\n')[0].slice(0, 300); }
function sanitizeName(s) { return String(s || '').replace(/[^A-Za-z0-9_$.-]/g, '_'); }
function tsStamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function syncRemoteMysql(cfg, config, taskId) {
    const dumpBin = mysqlBinPath(config, 'mysqldump.exe');
    const mysqlClient = mysqlBinPath(config, 'mysql.exe');
    if (!dumpBin || !mysqlClient || !fs.existsSync(dumpBin) || !fs.existsSync(mysqlClient)) {
        throw new Error(translate('mysql_bin_missing', 'MySQL client binaries not found. Install a MySQL version in TouchAMP first.'));
    }
    const M = cfg.mysql;
    const localDb = (M.localDb || '').trim();
    const remoteDb = (M.remoteDb || '').trim();
    if (!localDb) throw new Error(translate('deploy_local_db_required', 'A local database must be selected for sync.'));
    if (!remoteDb) throw new Error(translate('deploy_remote_db_required', 'A remote database name is required.'));
    if (!DB_NAME_RE.test(remoteDb)) {
        throw new Error(translate('deploy_remote_db_invalid', 'Remote database name may only contain letters, numbers, and underscore.'));
    }

    const pluginArgs = mysqlPluginArgs(config);
    const localCnf = writeDefaultsFile({ host: '127.0.0.1', port: config.MYSQL_PORT, user: 'root', password: '' });
    const remoteCnf = writeDefaultsFile({ host: M.host, port: M.port || 3306, user: M.user, password: M.password || '' });
    const sqlTmp = path.join(os.tmpdir(), `ta_deploy_${Date.now()}.sql`);
    const useColStats = dumpSupportsColumnStats(dumpBin);

    try {
        setProgress(taskId, { phase: 'mysql_dump', message: translate('deploy_dumping_db', 'Exporting local database ({x})...', { x: localDb }) });
        const dumpArgs = [`--defaults-extra-file=${localCnf}`, ...pluginArgs, '--no-tablespaces', '--add-drop-table'];
        if (useColStats) dumpArgs.push('--column-statistics=0');
        dumpArgs.push(localDb);
        await dumpToFile(dumpBin, dumpArgs, sqlTmp);
        if (!fs.existsSync(sqlTmp) || fs.statSync(sqlTmp).size === 0) {
            throw new Error(translate('deploy_dump_empty', 'Local database export returned empty content.'));
        }

        setProgress(taskId, { phase: 'mysql_check', message: translate('deploy_checking_remote', 'Verifying remote database...') });
        const showOut = await mysqlQuery(mysqlClient, remoteCnf, `SHOW DATABASES LIKE '${remoteDb}'`, pluginArgs);
        const dbExists = showOut.split(/\r?\n/).map(s => s.trim()).includes(remoteDb);
        if (!dbExists) {
            throw new Error(translate('deploy_remote_db_missing', 'Remote database "{x}" does not exist. Create it on the hosting first or check the name.', { x: remoteDb }));
        }

        let backupFile = null;
        try {
            setProgress(taskId, { phase: 'mysql_backup', message: translate('deploy_backing_up_remote', 'Backing up remote database...') });
            const backupDir = path.join(config.BACKUP_DIR, 'deploy');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            backupFile = path.join(backupDir, `${sanitizeName(remoteDb)}_${tsStamp()}.sql`);
            const bkpArgs = [`--defaults-extra-file=${remoteCnf}`, ...pluginArgs, '--no-tablespaces', '--add-drop-table'];
            if (useColStats) bkpArgs.push('--column-statistics=0');
            bkpArgs.push(remoteDb);
            await dumpToFile(dumpBin, bkpArgs, backupFile);
        } catch (be) {
            setProgress(taskId, { phase: 'mysql_backup', message: translate('deploy_backup_skipped', 'Remote backup skipped: {x}', { x: shortErr(be.message) }) });
            if (backupFile) cleanupFile(backupFile);
        }

        setProgress(taskId, { phase: 'mysql_import', message: translate('deploy_importing_db', 'Importing into remote database ({x})...', { x: remoteDb }) });
        await importFromFile(mysqlClient, [`--defaults-extra-file=${remoteCnf}`, ...pluginArgs, remoteDb], sqlTmp);
    } finally {
        cleanupFile(localCnf);
        cleanupFile(remoteCnf);
        cleanupFile(sqlTmp);
    }
}

// ─── TRANSLATION ───

let _t = (key, def, replacements = {}) => {
    let text = def || key;
    for (const [k, v] of Object.entries(replacements)) text = text.replace(`{${k}}`, v);
    return text;
};
function setTranslator(fn) { if (typeof fn === 'function') _t = fn; }
function translate(key, def, replacements = {}) { return _t(key, def, replacements); }

// ─── MAIN DEPLOY ORCHESTRATION ───

async function runDeploy(taskId, projectPath, projectCfg, config, fullSync, skipFiles, skipDb) {
    try {
        const excludeSet = buildExcludeSet(projectCfg.exclude);

        let toUpload = [];
        if (!skipFiles) {
            // Resolve all mappings to concrete file pairs
            let allPairs = [];
            for (const m of (projectCfg.mappings || [])) {
                if (!isValidMapping(m)) continue;
                allPairs = allPairs.concat(resolveMappingFiles(projectPath, m, excludeSet));
            }
            // Deduplicate by remotePath
            const seen = new Set();
            const uniquePairs = [];
            for (const p of allPairs) {
                if (seen.has(p.remotePath)) continue;
                seen.add(p.remotePath);
                uniquePairs.push(p);
            }

            // Change detection: git diff if available, else mtime
            toUpload = uniquePairs;
            if (!fullSync) {
                let changedSet = null;
                if (!projectCfg.__forceMtime) {
                    changedSet = getGitChangedFiles(projectPath);
                }
                if (changedSet) {
                    const expanded = expandChangedToFiles(projectPath, changedSet);
                    const uploaded = projectCfg.uploadedFiles || {};
                    const statP = fs.promises.stat;
                    const filtered = [];
                    for (let i = 0; i < uniquePairs.length; i++) {
                        if (isCancelled(taskId)) break;
                        const p = uniquePairs[i];
                        const rel = path.relative(projectPath, p.localAbs).split(path.sep).filter(Boolean).join('/');
                        if (expanded.has(rel)) {
                            filtered.push(p);
                            continue;
                        }
                        const stored = uploaded[p.remotePath];
                        if (stored === undefined) {
                            filtered.push(p);
                            continue;
                        }
                        try {
                            const st = await statP(p.localAbs);
                            const mtime = Math.round(st.mtimeMs / 1000) * 1000;
                            if (mtime > stored) filtered.push(p);
                        } catch (e) { filtered.push(p); }
                        if (i % 200 === 0) await new Promise(r => setImmediate(r));
                    }
                    toUpload = filtered;
                } else {
                    // mtime fallback
                    const uploaded = projectCfg.uploadedFiles || {};
                    const statP = fs.promises.stat;
                    const filtered = [];
                    for (let i = 0; i < uniquePairs.length; i++) {
                        if (isCancelled(taskId)) break;
                        const p = uniquePairs[i];
                        try {
                            const st = await statP(p.localAbs);
                            const mtime = Math.round(st.mtimeMs / 1000) * 1000;
                            const stored = uploaded[p.remotePath];
                            if (stored === undefined || mtime > stored) filtered.push(p);
                        } catch (e) { filtered.push(p); }
                        if (i % 200 === 0) await new Promise(r => setImmediate(r));
                    }
                    toUpload = filtered;
                }
            } else {
                projectCfg.uploadedFiles = {};
            }
        }
        if (isCancelled(taskId)) return finishCancelled(taskId, projectPath, projectCfg);

        if (skipFiles) {
            setProgress(taskId, { message: translate('deploy_files_skipped', 'File upload skipped by user.') });
        } else if (toUpload.length === 0) {
            setProgress(taskId, { message: translate('deploy_no_changes', 'No changed files to upload.') });
        } else {
            setProgress(taskId, { phase: 'ftp_upload', progress: 1, message: translate('deploy_uploading', 'Uploading {x} file(s) to hosting...', { x: toUpload.length }) });
            await ftpUploadPairs(projectCfg.ftp, toUpload, taskId);
        }
        if (isCancelled(taskId)) return finishCancelled(taskId, projectPath, projectCfg);

        if (projectCfg.mysql && projectCfg.mysql.enabled && !skipDb) {
            setProgress(taskId, { phase: 'mysql', progress: 99, message: translate('deploy_mysql_start', 'Synchronizing remote database...') });
            await syncRemoteMysql(projectCfg, config, taskId);
        } else if (skipDb) {
            setProgress(taskId, { message: translate('deploy_mysql_skipped', 'Database sync skipped by user.') });
        }

        projectCfg.lastUpload = new Date().toISOString();
        saveConfig(projectPath, projectCfg);

        setProgress(taskId, { status: 'done', progress: 100, phase: 'complete', message: translate('deploy_done', 'Deployment completed successfully!') });
    } catch (e) {
        try { saveConfig(projectPath, projectCfg); } catch (se) {}
        setProgress(taskId, { status: 'error', progress: 0, message: translate('deploy_failed', 'Deployment failed: {x}', { x: shortErr(e.message) }) });
    } finally {
        setTimeout(() => { delete deployProgressMap[taskId]; }, 120000);
    }
}

function finishCancelled(taskId, projectPath, projectCfg) {
    try { saveConfig(projectPath, projectCfg); } catch (e) {}
    setProgress(taskId, { status: 'cancelled', progress: 0, phase: 'cancelled', message: translate('deploy_cancelled', 'Deployment cancelled.') });
}

// ─── ROUTE REGISTRATION ───

function registerRoutes(app, config, t) {
    setTranslator(t);

    const safeProject = (name) => name && !name.includes('/') && !name.includes('\\') && !name.includes('..');
    const projectPathFrom = (name) => path.join(config.WWW_DIR, name);

    app.get('/api/deploy/tree', (req, res) => {
        const { project, dir } = req.query;
        if (!safeProject(project)) return res.json({ success: false, message: t('invalid_project_name', 'Invalid project name.') });
        const projectPath = projectPathFrom(project);
        if (!fs.existsSync(projectPath)) return res.json({ success: false, message: [] });
        const relSub = dir ? String(dir) : '';
        if (relSub.includes('..')) return res.json({ success: true, entries: [] });
        res.json({ success: true, entries: readTreeFolder(projectPath, relSub) });
    });

    app.get('/api/deploy/config', (req, res) => {
        const { project } = req.query;
        if (!safeProject(project)) return res.json({ success: false, message: t('invalid_project_name', 'Invalid project name.') });
        const projectPath = projectPathFrom(project);
        if (!fs.existsSync(projectPath)) return res.json({ success: false, message: t('project_not_found', 'Project folder not found.') });
        res.json({ success: true, config: loadConfig(projectPath) });
    });

    app.post('/api/deploy/config', (req, res) => {
        const { project, config: cfgIn } = req.body;
        if (!safeProject(project)) return res.json({ success: false, message: t('invalid_project_name', 'Invalid project name.') });
        const projectPath = projectPathFrom(project);
        if (!fs.existsSync(projectPath)) return res.json({ success: false, message: t('project_not_found', 'Project folder not found.') });
        const base = loadConfig(projectPath);
        const merged = {
            mappings: Array.isArray(cfgIn && cfgIn.mappings) ? cfgIn.mappings.filter(isValidMapping) : base.mappings,
            exclude: Array.isArray(cfgIn && cfgIn.exclude) ? cfgIn.exclude : base.exclude,
            ftp: Object.assign(base.ftp, (cfgIn && cfgIn.ftp) || {}),
            mysql: Object.assign(base.mysql, (cfgIn && cfgIn.mysql) || {}),
            uploadedFiles: base.uploadedFiles,
            lastUpload: base.lastUpload
        };
        saveConfig(projectPath, merged);
        res.json({ success: true, message: t('settings_updated', 'Settings updated.') });
    });

    app.post('/api/deploy/test-ftp', async (req, res) => {
        const F = req.body && req.body.ftp ? req.body.ftp : req.body;
        if (!F || !F.host || !F.user) return res.json({ success: false, message: t('deploy_ftp_required', 'Host and user are required.') });
        try {
            await withFtp(F, 20000, async () => {});
            res.json({ success: true, message: t('deploy_ftp_ok', 'FTP connection successful.') });
        } catch (e) {
            res.json({ success: false, message: translate('deploy_ftp_fail', 'FTP connection failed: {x}', { x: shortErr(e.message) }) });
        }
    });

    app.post('/api/deploy/test-mysql', (req, res) => {
        const M = req.body.mysql || req.body;
        const mysqlClient = mysqlBinPath(config, 'mysql.exe');
        if (!mysqlClient || !fs.existsSync(mysqlClient)) return res.json({ success: false, message: translate('mysql_bin_missing', 'MySQL client binaries not found. Install a MySQL version in TouchAMP first.') });
        if (!M.host || !M.user) return res.json({ success: false, message: t('deploy_mysql_required', 'Host and user are required.') });
        const cnf = writeDefaultsFile({ host: M.host, port: M.port || 3306, user: M.user, password: M.password || '' });
        const pArgs = mysqlPluginArgs(config);
        execFile(mysqlClient, [`--defaults-extra-file=${cnf}`, ...pArgs, '-e', 'SELECT 1;'], { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
            cleanupFile(cnf);
            if (err) return res.json({ success: false, message: translate('deploy_mysql_fail', 'MySQL connection failed: {x}', { x: shortErr(stderr || err.message) }) });
            res.json({ success: true, message: t('deploy_mysql_ok', 'MySQL connection successful.') });
        });
    });

    app.post('/api/deploy/start', (req, res) => {
        const { project, fullSync, forceMtime, skipFiles, skipDb } = req.body;
        if (skipFiles && skipDb) {
            return res.json({ success: false, message: t('deploy_select_one_sync', 'Please select at least one item to upload.') });
        }
        if (!safeProject(project)) return res.json({ success: false, message: t('invalid_project_name', 'Invalid project name.') });
        const projectPath = projectPathFrom(project);
        if (!fs.existsSync(projectPath)) return res.json({ success: false, message: t('project_not_found', 'Project folder not found.') });
        const cfg = loadConfig(projectPath);
        if (!cfg.ftp.host || !cfg.ftp.user) return res.json({ success: false, message: t('deploy_no_ftp', 'FTP settings are missing. Configure them first.') });
        if (cfg.mysql && cfg.mysql.enabled && !skipDb && !DB_NAME_RE.test((cfg.mysql.remoteDb || '').trim())) {
            return res.json({ success: false, message: t('deploy_remote_db_invalid', 'Remote database name may only contain letters, numbers, and underscore.') });
        }
        if (!skipFiles && Array.isArray(cfg.mappings) && cfg.mappings.length === 0) {
            return res.json({ success: false, message: t('deploy_no_mappings', 'No mapping rules defined. Add at least one rule.') });
        }
        cfg.__forceMtime = !!forceMtime;
        const taskId = `deploy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        deployProgressMap[taskId] = {
            status: 'running', phase: 'starting', progress: 0,
            message: t('backup_starting', 'Starting...'),
            uploadedFiles: cfg.uploadedFiles
        };
        res.json({ success: true, taskId, message: t('deploy_started', 'Deployment started.') });
        runDeploy(taskId, projectPath, cfg, config, !!fullSync, !!skipFiles, !!skipDb);
    });

    app.post('/api/deploy/cancel/:taskId', (req, res) => {
        const cur = deployProgressMap[req.params.taskId];
        if (cur && cur.status === 'running') {
            cur.status = 'cancelled';
            res.json({ success: true, message: t('deploy_cancelling', 'Cancelling deployment...') });
        } else {
            res.json({ success: false, message: t('deploy_no_active_task', 'No active deployment to cancel.') });
        }
    });

    app.get('/api/deploy/status/:taskId', (req, res) => {
        const st = deployProgressMap[req.params.taskId];
        if (!st) return res.json({ status: 'not_found', progress: 0, message: '' });
        res.json(st);
    });
}

module.exports = {
    registerRoutes,
    DEPLOY_DIRNAME,
    loadConfig,
    saveConfig,
    defaultConfig,
    buildExcludeSet,
    isExcluded,
    absFtpPath,
    isValidMapping,
    resolveMappingFiles,
    getGitChangedFiles
};
