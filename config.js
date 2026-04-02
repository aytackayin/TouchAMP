const path = require('path');
const fs = require('fs');

const APP_DIR = __dirname;
const isPackaged = APP_DIR.includes('app.asar') || process.execPath.endsWith('TouchAMP.exe');
const BASE_DIR = isPackaged ? path.dirname(process.execPath) : APP_DIR;
const SETTINGS_FILE = path.join(BASE_DIR, 'settings.json');
const QUICK_ACCESS_FILE = path.join(BASE_DIR, 'quick_access.json');

function getLatestVersion(type, fallback) {
    const versionsDir = path.join(BASE_DIR, 'bin', 'versions', type);
    if (!fs.existsSync(versionsDir)) return fallback;
    try {
        const dirs = fs.readdirSync(versionsDir)
            .map(name => ({ name, fullPath: path.join(versionsDir, name) }))
            .filter(item => fs.lstatSync(item.fullPath).isDirectory())
            .map(item => ({ ...item, mtime: fs.statSync(item.fullPath).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        return dirs.length > 0 ? dirs[0].name : fallback;
    } catch (e) {
        return fallback;
    }
}

const defaults = {
    APP_PORT: 9090,
    HTTP_PORT: 80,
    HTTPS_PORT: 443,
    MYSQL_PORT: 3306,
    VHOST_SUFFIX: '.test',
    WWW_DIR: '{APP}\\www',
    DATA_DIR: '{APP}\\data',
    BACKUP_DIR: '{APP}\\backups',
    APACHE_VERSION: getLatestVersion('apache', ''),
    PHP_VERSION: getLatestVersion('php', ''),
    MYSQL_VERSION: getLatestVersion('mysql', ''),
    START_ON_WINDOWS: false,
    START_MINIMIZED: false,
    AUTO_START_SERVICES: false,
    BROWSER_MODE: 'system', // system, electron, path
    BROWSER_PATH: '',
    LANGUAGE: 'en'
};

const configObj = { ...defaults };

function resolvePath(p) {
    if (!p || typeof p !== 'string') return p;
    // Replace {APP} with the actual Base Dir, then resolve safely
    let resolved = p.replace(/\{APP\}/g, BASE_DIR);
    if (!path.isAbsolute(resolved)) {
        resolved = path.join(BASE_DIR, resolved);
    }
    return path.normalize(resolved);
}

function loadSettings() {
    if (fs.existsSync(SETTINGS_FILE)) {
        try {
            const userSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
            Object.assign(configObj, userSettings);
        } catch (e) {}
    }
}

loadSettings();

const config = {
    get BASE_DIR() { return BASE_DIR; },
    get SETTINGS_FILE() { return SETTINGS_FILE; },
    get QUICK_ACCESS_FILE() { return QUICK_ACCESS_FILE; },
    get VERSIONS_DIR() { return path.join(BASE_DIR, 'bin', 'versions'); },
    get ETC_DIR() { return path.join(BASE_DIR, 'etc'); },
    get SITES_ENABLED_DIR() { return path.join(BASE_DIR, 'etc', 'apache2', 'sites-enabled'); },
    get SSL_DIR() { return path.join(BASE_DIR, 'etc', 'ssl'); },
    get OPENSSL_BIN() { return path.join(BASE_DIR, 'bin', 'openssl', 'openssl.exe'); },
    get HOSTS_FILE() { return 'C:/Windows/System32/drivers/etc/hosts'; },
    
    // Dynamic Settings
    get APP_PORT() { return configObj.APP_PORT; },
    get HTTP_PORT() { return configObj.HTTP_PORT; },
    get HTTPS_PORT() { return configObj.HTTPS_PORT; },
    get MYSQL_PORT() { return configObj.MYSQL_PORT; },
    get VHOST_SUFFIX() { return configObj.VHOST_SUFFIX; },
    get WWW_DIR() { return resolvePath(configObj.WWW_DIR); },
    get DATA_DIR() { return resolvePath(configObj.DATA_DIR); },
    get BACKUP_DIR() { return resolvePath(configObj.BACKUP_DIR); },
    get APACHE_VERSION() { return configObj.APACHE_VERSION; },
    get PHP_VERSION() { return configObj.PHP_VERSION; },
    get MYSQL_VERSION() { return configObj.MYSQL_VERSION; },
    get START_ON_WINDOWS() { return configObj.START_ON_WINDOWS; },
    get START_MINIMIZED() { return configObj.START_MINIMIZED; },
    get AUTO_START_SERVICES() { return configObj.AUTO_START_SERVICES; },
    get BROWSER_MODE() { return configObj.BROWSER_MODE; },
    get BROWSER_PATH() { return resolvePath(configObj.BROWSER_PATH); },
    get LANGUAGE() { return configObj.LANGUAGE; },

    // Dynamic Paths (Update when version changes)
    get APACHE_DIR() { return path.join(this.VERSIONS_DIR, 'apache', this.APACHE_VERSION); },
    get PHP_DIR() { return path.join(this.VERSIONS_DIR, 'php', this.PHP_VERSION); },
    get MYSQL_DIR() { return path.join(this.VERSIONS_DIR, 'mysql', this.MYSQL_VERSION); },
    get APACHE_BIN() { return path.join(this.APACHE_DIR, 'bin', 'httpd.exe'); },
    get MYSQL_BIN() { return path.join(this.MYSQL_DIR, 'bin', 'mysqld.exe'); },
    get PHP_BIN() { return path.join(this.PHP_DIR, 'php.exe'); },
    get APACHE_CONF() { return path.join(this.APACHE_DIR, 'conf', 'httpd.conf'); },
    get MYSQL_DATA_DIR() { return path.join(this.DATA_DIR, 'mysql-' + this.MYSQL_VERSION); },

    getRawSettings() { return { ...configObj }; },
    reload() { loadSettings(); }
};

module.exports = config;
