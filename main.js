// ══════════════════════════════════════════════════════════
// TouchAMP — Electron Main Process
// System Tray, Window Management, Service Status Tracking
// ══════════════════════════════════════════════════════════

const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { fork } = require('child_process');

// ─── PATHS ───
const APP_DIR = __dirname;
const isPackaged = APP_DIR.includes('app.asar') || process.mainModule?.filename.includes('app.asar') || process.execPath.endsWith('TouchAMP.exe');

// ─── ADMIN CHECK & RE-ELEVATION (WINDOWS) ───
if (isPackaged && process.platform === 'win32') {
    try {
        const { execSync } = require('child_process');
        // 'net session' command requires admin rights, returns 1 if not admin
        execSync('net session', { stdio: 'ignore' });
    } catch (e) {
        // We are NOT admin! Relaunch with 'RunAs' verb.
        const { shell } = require('electron');
        try {
            const { execSync } = require('child_process');
            // Using PowerShell to relaunch as admin avoids needing external dependencies
            const psCmd = `Start-Process -FilePath "${process.execPath}" -Verb RunAs`;
            execSync(`powershell -WindowStyle Hidden -NoProfile -Command "${psCmd}"`, { stdio: 'ignore' });
            app.quit();
            process.exit(0);
        } catch (err) {
            // If user cancels UAC or relaunch fails, we continue but some features will fail.
        }
    }
}
const DATA_BASE_DIR = isPackaged ? path.dirname(process.execPath) : APP_DIR;

const SETTINGS_FILE = path.join(DATA_BASE_DIR, 'settings.json');
const ICONS_DIR = path.join(APP_DIR, 'public', 'icons');
const SERVER_FILE = path.join(APP_DIR, 'server.js');

// ─── STATE ───
let mainWindow = null;
let tray = null;
let serverProcess = null;
let statusPollTimer = null;
let currentTrayIcon = 'icon'; // Default icon
let isQuitting = false;
let appPort = 9090;

// ─── SETTINGS ───
function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
        }
    } catch (e) {}
    return {};
}

function getAppPort() {
    const settings = loadSettings();
    return settings.APP_PORT || 9090;
}

// ─── I18N FOR MAIN PROCESS ───
let translations = {};
function initI18n() {
    const settings = loadSettings();
    const lang = settings.LANGUAGE || 'en';
    const langFile = path.join(DATA_BASE_DIR, 'lang', `${lang}.json`);
    if (fs.existsSync(langFile)) {
        try { translations = JSON.parse(fs.readFileSync(langFile, 'utf-8')); }
        catch(e) { translations = {}; }
    }
}
function t(key, def) { return translations[key] || def; }

// ─── SINGLE INSTANCE ───
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // If a second instance is opened, bring the existing window to the front
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        } else {
            openInBrowser();
        }
    });
}

// ─── SERVER MANAGEMENT ───

function startServer() {
    if (serverProcess) return;

    serverProcess = fork(SERVER_FILE, [], {
        cwd: DATA_BASE_DIR,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        silent: true
    });

    const errLogPath = path.join(DATA_BASE_DIR, 'server-error.log');
    fs.writeFileSync(errLogPath, '--- START ---\n');

    // Write server stdout/stderr to a log file for debugging
    if (serverProcess.stdout) {
        serverProcess.stdout.on('data', (data) => {
            fs.appendFileSync(errLogPath, `[STDOUT] ${data}`);
        });
    }
    if (serverProcess.stderr) {
        serverProcess.stderr.on('data', (data) => {
            fs.appendFileSync(errLogPath, `[STDERR] ${data}`);
        });
    }

    serverProcess.on('exit', (code) => {
        fs.appendFileSync(errLogPath, `[EXIT] Process exited with code ${code}\n`);
        serverProcess = null;
        if (!isQuitting) {
            // Unexpected exit, restart after 2 seconds
            setTimeout(() => startServer(), 2000);
        }
    });

    serverProcess.on('error', (err) => {
        fs.appendFileSync(errLogPath, `[ERROR] Process error: ${err.message}\n`);
        serverProcess = null;
    });

    serverProcess.on('message', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'status') {
            globalStatus = msg.status;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('status-update', globalStatus);
            }
        } else if (msg.type === 'open-electron-window' && msg.url) {
            createProjectWindow(msg.url);
        } else if (msg.type === 'open-system-browser' && msg.url) {
            const { shell } = require('electron');
            let target = msg.url;
            
            // Resolve {APP} variable for local paths/apps
            if (target && target.includes('{APP}')) {
                // Ensure proper path separators
                target = target.replace(/\{APP\}/g, DATA_BASE_DIR).replace(/\//g, '\\');
            }

            // Check if it's a URL or a local path
            if (target.startsWith('http://') || target.startsWith('https://') || target.includes('://')) {
                shell.openExternal(target);
            } else {
                // Try to open as local path (file, folder or executable)
                shell.openPath(target).catch(err => {
                    // Fallback to exec for more complex system commands
                    require('child_process').exec(`start "" "${target}"`, { windowsHide: true });
                });
            }
        } else if (msg.type === 'restart-app') {
            // Stop all services first
            apiRequest('POST', '/api/services/stop-all').then(() => {
                isQuitting = true;
                stopStatusPolling();
                stopServer();
                
                // Relaunch the app
                app.relaunch();
                app.exit(0);
            });
        }
    });
}

function stopServer() {
    if (serverProcess) {
        serverProcess.kill('SIGTERM');
        serverProcess = null;
    }
}

// ─── HTTP HELPERS ───

function apiRequest(method, apiPath) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: appPort,
            path: apiPath,
            method: method,
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const errLogPath = path.join(DATA_BASE_DIR, 'server-error.log');
                if (res.statusCode !== 200) {
                    fs.appendFileSync(errLogPath, `[API HTTP ERROR] ${method} ${apiPath} -> Status: ${res.statusCode}, Body: ${data}\n`);
                }
                try { resolve(JSON.parse(data)); }
                catch (e) { resolve(null); }
            });
        });

        req.on('error', (err) => {
            fs.appendFileSync(path.join(DATA_BASE_DIR, 'server-error.log'), `[API ERROR] ${method} ${apiPath}: ${err.message}\n`);
            resolve(null);
        });
        req.on('timeout', () => { 
            fs.appendFileSync(path.join(DATA_BASE_DIR, 'server-error.log'), `[API TIMEOUT] ${method} ${apiPath}\n`);
            req.destroy(); 
            resolve(null); 
        });
        req.end();
    });
}

function waitForServer(maxAttempts = 30) {
    return new Promise((resolve) => {
        let attempts = 0;
        const check = () => {
            attempts++;
            apiRequest('GET', '/api/status').then(data => {
                if (data && data.services) {
                    resolve(true);
                } else if (attempts < maxAttempts) {
                    setTimeout(check, 500);
                } else {
                    resolve(false);
                }
            });
        };
        check();
    });
}

// ─── TRAY ICON ───

function getIconPath(name) {
    const icoPath = path.join(ICONS_DIR, `${name}.ico`);
    if (fs.existsSync(icoPath)) return icoPath;
    // If ICO doesn't exist, try SVG/PNG
    const svgPath = path.join(ICONS_DIR, `${name}.svg`);
    if (fs.existsSync(svgPath)) return svgPath;
    return path.join(ICONS_DIR, 'icon.ico');
}

function updateTrayIcon(iconName) {
    if (!tray || currentTrayIcon === iconName) return;
    currentTrayIcon = iconName;
    try {
        const icon = nativeImage.createFromPath(getIconPath(iconName));
        tray.setImage(icon);
    } catch (e) {}
}

function createTray() {
    const icon = nativeImage.createFromPath(getIconPath('icon'));
    tray = new Tray(icon);
    tray.setToolTip(t('app_title', 'TouchAMP — Local Development Environment'));

    updateTrayMenu(false, false);

    tray.on('double-click', () => {
        openInBrowser();
    });
}

function updateTrayMenu(apacheRunning, mysqlRunning) {
    const anyRunning = apacheRunning || mysqlRunning;

    const contextMenu = Menu.buildFromTemplate([
        {
            label: `TouchAMP v${app.getVersion()}`,
            enabled: false
        },
        { type: 'separator' },
        {
            label: `Dashboard — ${t('open', 'Open')}`,
            click: () => openInBrowser()
        },
        { type: 'separator' },
        {
            label: `Apache: ${apacheRunning ? '● ' + t('running', 'Running') : '○ ' + t('stopped_status', 'Stopped')}`,
            enabled: false
        },
        {
            label: `MySQL: ${mysqlRunning ? '● ' + t('running', 'Running') : '○ ' + t('stopped_status', 'Stopped')}`,
            enabled: false
        },
        { type: 'separator' },
        {
            label: t('restart_services', 'Restart Services'),
            click: () => restartAllServices()
        },
        {
            label: t('stop_services', 'Stop Services'),
            enabled: anyRunning,
            click: () => stopAllServices()
        },
        { type: 'separator' },
        {
            label: t('close_app', "Quit TouchAMP"),
            click: () => quitApp()
        }
    ]);

    tray.setContextMenu(contextMenu);
}

// ─── STATUS POLLING ───

let lastApacheStatus = false;
let lastMysqlStatus = false;
let lastHadError = false;

async function pollServiceStatus() {
    const data = await apiRequest('GET', '/api/status');

    if (!data || !data.services) {
        // Server unreachable, red icon
        updateTrayIcon('icon_red');
        tray.setToolTip(t('server_no_resp', 'TouchAMP — Server not responding'));
        lastHadError = true;
        return;
    }

    const apache = data.services.apache;
    const mysql = data.services.mysql;
    const apacheRunning = apache && apache.running;
    const mysqlRunning = mysql && mysql.running;

    // Update menu (only if status changed)
    if (apacheRunning !== lastApacheStatus || mysqlRunning !== lastMysqlStatus || lastHadError) {
        updateTrayMenu(apacheRunning, mysqlRunning);
        lastApacheStatus = apacheRunning;
        lastMysqlStatus = mysqlRunning;
        lastHadError = false;
    }

    // Determine icon color
    if (apacheRunning && mysqlRunning) {
        updateTrayIcon('icon_green');
        tray.setToolTip(t('all_services_running', 'TouchAMP — All services running'));
    } else if (apacheRunning || mysqlRunning) {
        updateTrayIcon('icon_yelow');
        const running = apacheRunning ? 'Apache' : 'MySQL';
        tray.setToolTip(`TouchAMP — ${t('only_x_running', 'Only {x} running').replace('{x}', running)}`);
    } else {
        updateTrayIcon('icon');
        tray.setToolTip(t('services_stopped', 'TouchAMP — Services stopped'));
    }
}

function startStatusPolling() {
    // Initial call
    pollServiceStatus();
    // Repeat every 3 seconds
    statusPollTimer = setInterval(pollServiceStatus, 3000);
}

function stopStatusPolling() {
    if (statusPollTimer) {
        clearInterval(statusPollTimer);
        statusPollTimer = null;
    }
}

// ─── SERVICE CONTROLS ───

async function restartAllServices() {
    // Stop first
    await apiRequest('POST', '/api/services/stop-all');
    // Wait 1 second
    await new Promise(r => setTimeout(r, 1000));
    // Start again
    await apiRequest('POST', '/api/services/start-all');
}

async function stopAllServices() {
    await apiRequest('POST', '/api/services/stop-all');
}

async function startAllServices() {
    await apiRequest('POST', '/api/services/start-all');
}

// ─── WINDOW & BROWSER ───

function openInBrowser() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        return;
    }

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 720,
        minHeight: 720,
        title: 'TouchAMP',
        icon: getIconPath('icon'),
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadURL(`http://localhost:${appPort}`);

    mainWindow.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });
}

function createProjectWindow(url) {
    const projWin = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 720,
        minHeight: 720,
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    projWin.setMenu(null);
    projWin.loadURL(url);
}


// ─── AUTO-START (Windows Registry) ───

function updateAutoStart(enabled) {
    try {
        const exePath = process.execPath;
        const args = app.isPackaged ? '' : ` "${path.join(APP_DIR, 'main.js')}"`;
        const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
        const valueName = 'TouchAMP';

        if (enabled) {
            const { execSync } = require('child_process');
            execSync(`reg add "${regKey}" /v "${valueName}" /t REG_SZ /d "\\"${exePath}\\"${args}" /f`, { stdio: 'ignore', windowsHide: true });
        } else {
            const { execSync } = require('child_process');
            execSync(`reg delete "${regKey}" /v "${valueName}" /f`, { stdio: 'ignore', windowsHide: true });
        }
    } catch (e) {}
}

// ─── QUIT ───

async function quitApp() {
    isQuitting = true;
    stopStatusPolling();

    // Stop services first if they are running
    try {
        const data = await apiRequest('GET', '/api/status');
        if (data && data.services) {
            const anyRunning = (data.services.apache && data.services.apache.running) ||
                              (data.services.mysql && data.services.mysql.running);
            if (anyRunning) {
                await apiRequest('POST', '/api/services/stop-all');
                // Wait for services to stop
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    } catch (e) {}

    // Stop the server
    stopServer();

    // Quit the application
    app.quit();
}

// ─── APP LIFECYCLE ───

app.whenReady().then(async () => {
    appPort = getAppPort();
    const settings = loadSettings();

    // Apply Windows startup setting
    updateAutoStart(!!settings.START_ON_WINDOWS);

    // Load translations
    initI18n();

    // Start server process
    startServer();

    // Create tray icon
    createTray();

    // Wait for the server to come up
    const serverReady = await waitForServer(30);

    if (serverReady) {
        // Auto-start services if enabled in settings
        if (settings.AUTO_START_SERVICES) {
            await startAllServices();
        }

        // Open panel in app window if not starting minimized
        if (!settings.START_MINIMIZED) {
            openInBrowser();
        }
    }

    // Start status polling
    startStatusPolling();
});

// ─── SSL BYPASS for .test domains ───
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    // Automatically trust self-signed certificates for local .test development sites
    if (url.includes('.test') || url.indexOf('https://localhost') === 0) {
        event.preventDefault();
        callback(true);
    } else {
        callback(false);
    }
});

app.on('window-all-closed', (e) => {
    // Don't quit even if window is closed, stay in tray
    e.preventDefault ? e.preventDefault() : null;
});

app.on('before-quit', () => {
    isQuitting = true;
});

// ─── SETTINGS WATCHER ───
// Watch settings.json changes (for auto-start setting)
let settingsWatcher = null;
try {
    settingsWatcher = fs.watch(SETTINGS_FILE, { persistent: false }, () => {
        const settings = loadSettings();
        updateAutoStart(!!settings.START_ON_WINDOWS);
        initI18n(); // Language might have changed
    });
} catch (e) {}

app.on('quit', () => {
    if (settingsWatcher) settingsWatcher.close();
});
