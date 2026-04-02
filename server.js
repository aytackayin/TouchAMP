const express = require('express');
const { spawn, exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');

const app = express();
app.use(express.json({ limit: '1024mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/lang', express.static(path.join(config.BASE_DIR, 'lang')));

// ─── LOCAL NETWORK RESTRICTION FOR API ───
// Only allow API requests from localhost/127.0.0.1
const isLocalRequest = (req) => {
    const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
};

// API endpoints restriction middleware
const restrictToLocal = (req, res, next) => {
    if (!isLocalRequest(req)) {
        return res.status(403).json({ success: false, message: 'Access denied. Only local requests are allowed.' });
    }
    next();
};

// Apply local restriction to all API routes
app.use('/api', restrictToLocal);

const SOURCES_FILE = path.join(config.BASE_DIR, 'sources.json');

// ─── I18N SUPPORT ───
let translations = {};
function loadServerI18n() {
    const lang = config.LANGUAGE || 'en';
    const langFile = path.join(config.BASE_DIR, 'lang', `${lang}.json`);
    if (fs.existsSync(langFile)) {
        try { translations = JSON.parse(fs.readFileSync(langFile, 'utf-8')); }
        catch(e) { translations = {}; }
    } else {
        translations = {};
    }
}
function t(key, def, replacements = {}) {
    let text = translations[key] || def || key;
    for (const [k, v] of Object.entries(replacements)) {
        text = text.replace(`{${k}}`, v);
    }
    return text;
}
loadServerI18n(); // Initial load


// ─── INITIALIZATION ───

// Track services that are in initialization phase
const initializingServices = { apache: false, mysql: false };

function initializeEnvironment(silent = false) {
    // Configure system

    // Clean logs and unnecessary files (only on startup)
    if (!silent) {
        const logFiles = [
            path.join(config.APACHE_DIR, 'logs', 'error_log'),
            path.join(config.APACHE_DIR, 'logs', 'access_log'),
        ];
        let cleanedCount = 0;
        let freedBytes = 0;

        try {
            const dataDir = config.DATA_DIR;
            const oldMysqlDir = path.join(dataDir, 'mysql');
            
            // Migrate old classic mysql folder if it exists (prevent data loss)
            if (fs.existsSync(oldMysqlDir) && fs.lstatSync(oldMysqlDir).isDirectory()) {
                if (!fs.existsSync(config.MYSQL_DATA_DIR) && oldMysqlDir !== config.MYSQL_DATA_DIR) {
                }
            }

            if (fs.existsSync(dataDir)) {
                fs.readdirSync(dataDir).forEach(sub => {
                    const subPath = path.join(dataDir, sub);
                    if (!sub.startsWith('mysql') || !fs.lstatSync(subPath).isDirectory()) return;

                    // Check if it's the active MySQL data directory
                    const isActiveDataDir = path.resolve(subPath) === path.resolve(config.MYSQL_DATA_DIR);

                    // NEVER delete inactive versions, skip them to protect data when switching versions
                    if (!isActiveDataDir) return;

                    // Clean unnecessary files in the active directory
                    fs.readdirSync(subPath).forEach(f => {
                        const filePath = path.join(subPath, f);
                        try {
                            // Binlog files (unnecessary since disable-log-bin is active)
                            if (/^binlog\.\d+$/.test(f) || f === 'binlog.index') {
                                freedBytes += fs.statSync(filePath).size;
                                fs.unlinkSync(filePath);
                                cleanedCount++;
                            }
                            // Old mysqld.log file (.err is used instead)
                            else if (f === 'mysqld.log') {
                                freedBytes += fs.statSync(filePath).size;
                                fs.unlinkSync(filePath);
                                cleanedCount++;
                            }
                            // Reset error log file
                            else if (f === `${os.hostname()}.err`) {
                                if (fs.statSync(filePath).size > 0) {
                                    freedBytes += fs.statSync(filePath).size;
                                    fs.writeFileSync(filePath, '');
                                    cleanedCount++;
                                }
                            }
                        } catch(e) {}
                    });
                });
            }
        } catch(e) {}

        // Reset Apache log files
        logFiles.forEach(logPath => {
            try {
                if (fs.existsSync(logPath) && fs.statSync(logPath).size > 0) {
                    freedBytes += fs.statSync(logPath).size;
                    fs.writeFileSync(logPath, '');
                    cleanedCount++;
                }
            } catch(e) {}
        });

        // Clean garbage test files
        const garbageFiles = [
            path.join(config.BASE_DIR, 'test-apache.js'),
            path.join(config.BASE_DIR, 'server-error.log')
        ];
        garbageFiles.forEach(f => {
            try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch(e) {}
        });
    }
    
    const initialDirs = [config.WWW_DIR, config.SSL_DIR, config.SITES_ENABLED_DIR];
    
    // Only create data/log folders if a valid version is selected and installed
    if (config.MYSQL_VERSION && fs.existsSync(config.MYSQL_BIN)) {
        initialDirs.push(config.MYSQL_DATA_DIR);
    }
    if (config.APACHE_VERSION && fs.existsSync(config.APACHE_BIN)) {
        initialDirs.push(path.join(config.APACHE_DIR, 'logs'));
    }

    initialDirs.forEach(dir => {
        try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch(e) {}
    });

    if (fs.existsSync(config.APACHE_BIN)) {
        const apacheConfPath = config.APACHE_CONF;
        if (fs.existsSync(apacheConfPath)) {
            let content = fs.readFileSync(apacheConfPath, 'utf-8');
            const srvRoot = config.APACHE_DIR.replace(/\\/g, '/');
            const wwwRoot = config.WWW_DIR.replace(/\\/g, '/');
            const phpRoot = config.PHP_DIR.replace(/\\/g, '/');
            const internalConf = path.join(config.ETC_DIR, 'apache2', 'sunucu.conf').replace(/\\/g, '/');
            const sitesDir = config.SITES_ENABLED_DIR.replace(/\\/g, '/');

            let lines = content.split(/\r?\n/);
            let cleanedLines = lines.filter(line => {
                const l = line.trim();
                if (l.startsWith('# --- SERVER MANAGER')) return false;
                if (l.startsWith('# --- SUNUCU YONETICI CONFIG')) return false;
                if (l.startsWith('Define PHP_DIR')) return false;
                if (l.startsWith('Define SITES_ENABLED_DIR')) return false;
                if (l.startsWith('Define SRVROOT')) return false;
                if (l.startsWith('Define APP_DIR')) return false;
                if (l.startsWith('ServerRoot')) return false;
                if (l.startsWith('DocumentRoot')) return false;
                if (l.startsWith('Include') && (l.includes('sunucu.conf') || l.includes('server.conf'))) return false;
                if (l.startsWith('Listen')) return false;
                if (l.startsWith('CustomLog')) return false;
                if (l.startsWith('PidFile')) return false;
                if (l.startsWith('ErrorLog')) return false;
                if (l.startsWith('ScriptAlias')) return false;
                if (l.startsWith('TypesConfig')) return false;
                return true;
            });

            let tempContent = cleanedLines.join('\n');
            // [Portable] Remove ALL <Directory> blocks with absolute paths (may contain stale drive letters)
            tempContent = tempContent.replace(/<Directory\s+"[A-Za-z]:[\\\/][^"]*">[\s\S]*?<\/Directory>/gi, '');
            // Also clean <IfModule alias_module> blocks that may contain old ScriptAlias paths
            tempContent = tempContent.replace(/<IfModule\s+alias_module>[\s\S]*?<\/IfModule>/gi, '');

            // Auto-enable required modules
            const modulesToEnable = [
                'ssl_module', 'socache_shmcb_module', 'rewrite_module', 'dir_module',
                'vhost_alias_module', 'expires_module', 'headers_module', 'deflate_module'
            ];
            modulesToEnable.forEach(mod => {
                const regex = new RegExp(`^#\\s*(LoadModule\\s+${mod}\\s+modules/mod_.*?\\.so)`, 'm');
                tempContent = tempContent.replace(regex, '$1');
            });
            
            const appRoot = config.BASE_DIR.replace(/\\/g, '/');
            let finalContent = `Define SRVROOT "${srvRoot}"\nDefine APP_DIR "${appRoot}"\nServerRoot "${srvRoot}"\nDocumentRoot "${wwwRoot}"\nListen ${config.HTTP_PORT}\n\n`;
            finalContent += `PidFile "${srvRoot}/logs/httpd.pid"\n`;
            finalContent += `Define PHP_DIR "\${APP_DIR}/bin/versions/php/${config.PHP_VERSION}"\nDefine SITES_ENABLED_DIR "\${APP_DIR}/etc/apache2/sites-enabled"\n\n`;
            finalContent += tempContent.trim();
            finalContent += `\n\n# --- SERVER MANAGER CONFIG ---\n`;
            finalContent += `<Directory "${wwwRoot}">\n    Options FollowSymLinks\n    AllowOverride All\n    Require all granted\n    DirectoryIndex index.php index.html\n</Directory>\n`;
            finalContent += `Include "${internalConf}"\n`;
            fs.writeFileSync(apacheConfPath, finalContent);
        }

        // Adjust sunucu.conf for PHP version and DLL names
        const internalConf = path.join(config.ETC_DIR, 'apache2', 'sunucu.conf');
        if (fs.existsSync(internalConf) && config.PHP_VERSION) {
            let conf = fs.readFileSync(internalConf, 'utf-8');
            const phpDir = config.PHP_DIR;
            let phpModuleDll = 'php8apache2_4.dll';
            if (fs.existsSync(path.join(phpDir, 'php7apache2_4.dll'))) phpModuleDll = 'php7apache2_4.dll';
            
            // OpenSSL DLLs (PHP 8.2+ uses v3, older uses v1.1)
            let cryptoDll = 'libcrypto-3-x64.dll';
            let sslDll = 'libssl-3-x64.dll';
            if (fs.existsSync(path.join(phpDir, 'libcrypto-1_1-x64.dll'))) {
                cryptoDll = 'libcrypto-1_1-x64.dll';
                sslDll = 'libssl-1_1-x64.dll';
            }

            conf = conf.replace(/^LoadFile.*libcrypto.*$/m, `LoadFile "\${PHP_DIR}/${cryptoDll}"`);
            conf = conf.replace(/^LoadFile.*libssl.*$/m, `LoadFile "\${PHP_DIR}/${sslDll}"`);
            conf = conf.replace(/^LoadModule\s+php_module.*$/m, `LoadModule php_module "\${PHP_DIR}/${phpModuleDll}"`);
            fs.writeFileSync(internalConf, conf);
        }

        // PHP DLL Synchronization: Clean old PHP DLLs in Apache bin directory.
        // Due to Windows DLL search order, DLLs in the httpd.exe directory
        // are found before the PATH, potentially causing the wrong PHP version to load.
        const apacheBinDir = path.join(config.APACHE_DIR, 'bin');
        let cleanedCount = 0;
        
        try {
            if (fs.existsSync(apacheBinDir)) {
                fs.readdirSync(apacheBinDir).forEach(f => {
                    if (/^php\d*(ts|apache2_4|phpdbg)\.dll$/i.test(f)) {
                        try { fs.unlinkSync(path.join(apacheBinDir, f)); cleanedCount++; } catch(e) {}
                    }
                });
            }
        } catch(e) {}
        
        // Copy php*ts.dll to Apache bin if it exists in selected PHP dir (for older PHP versions)
        try {
            const phpTsDlls = fs.readdirSync(config.PHP_DIR).filter(f => /^php\d*ts\.dll$/i.test(f));
            phpTsDlls.forEach(dll => {
                const src = path.join(config.PHP_DIR, dll);
                const dest = path.join(apacheBinDir, dll);
                try { fs.copyFileSync(src, dest); } catch(e) {}
            });
        } catch(e) {}
        
        if (!silent && cleanedCount > 0) process.stdout.write(`  [OK] Cleaned ${cleanedCount} old PHP DLLs from Apache bin directory.\n`);
    }

    // [Portable] Clean stale vhost configs that reference old disk paths
    try {
        if (fs.existsSync(config.SITES_ENABLED_DIR)) {
            const currentBaseNorm = config.BASE_DIR.replace(/\\/g, '/');
            fs.readdirSync(config.SITES_ENABLED_DIR).forEach(f => {
                if (!f.endsWith('.conf')) return;
                try {
                    const confContent = fs.readFileSync(path.join(config.SITES_ENABLED_DIR, f), 'utf-8');
                    // Check if config contains any absolute path that does NOT match current BASE_DIR
                    const absPathMatch = confContent.match(/[A-Za-z]:\/[^"\s]+/g);
                    if (absPathMatch && absPathMatch.some(p => !p.toLowerCase().startsWith(currentBaseNorm.toLowerCase()))) {
                        fs.unlinkSync(path.join(config.SITES_ENABLED_DIR, f));
                        if (!silent) process.stdout.write(`  [Portable] Removed stale vhost config: ${f}\n`);
                    }
                } catch(e) {}
            });
        }
    } catch(e) {}

    // Ensure VHosts are up to date with current ports and folders
    syncVhosts();

    // PHP php.ini automatic configuration
    const phpIniPath = path.join(config.PHP_DIR, 'php.ini');
    const phpIniDev = path.join(config.PHP_DIR, 'php.ini-development');
    if (!fs.existsSync(phpIniPath) && fs.existsSync(phpIniDev)) {
        try {
            let ini = fs.readFileSync(phpIniDev, 'utf-8');
            // Enable required extensions
            const extsToEnable = [
                'curl', 'fileinfo', 'gd', 'intl', 'mbstring', 'exif',
                'mysqli', 'openssl', 'pdo_mysql', 'pdo_sqlite',
                'sockets', 'sodium', 'sqlite3', 'zip'
            ];
            extsToEnable.forEach(ext => {
                ini = ini.replace(new RegExp(`^;extension=${ext}\\b`, 'm'), `extension=${ext}`);
            });
            // Enable OPcache
            ini = ini.replace(/^;zend_extension=opcache/m, 'zend_extension=opcache');
            fs.writeFileSync(phpIniPath, ini);
        } catch(e) {}
    }

    // [Portable] php.ini path dynamic update (ensures correct operation even if directory changes)
    if (fs.existsSync(phpIniPath)) {
        try {
            let ini = fs.readFileSync(phpIniPath, 'utf-8');
            const phpExtDir = path.join(config.PHP_DIR, 'ext').replace(/\\/g, '/');
            // Completely remove all previous extension_dir absolute/relative/commented lines
            ini = ini.replace(/^;?\s*extension_dir\s*=.*$/gm, '');
            // Insert a single up-to-date absolute extension_dir path under the Windows section
            ini = ini.replace(/(;\s*On windows:\s*\r?\n)/i, `$1extension_dir = "${phpExtDir}"\n`);
            fs.writeFileSync(phpIniPath, ini);
        } catch(e) {}
    }

    // [Portable] Sync phpMyAdmin Port with current MySQL Port
    const pmaConfigPath = path.join(config.ETC_DIR, 'apps', 'phpMyAdmin', 'config.inc.php');
    if (fs.existsSync(pmaConfigPath)) {
        try {
            let pma = fs.readFileSync(pmaConfigPath, 'utf-8');
            // Support both quoted and unquoted port values in config
            pma = pma.replace(/\$cfg\['Servers'\]\[\$i\]\['port'\]\s*=\s*(['"]?)\d+(['"]?);/g, `$cfg['Servers'][$i]['port'] = ${config.MYSQL_PORT};`);
            fs.writeFileSync(pmaConfigPath, pma);
        } catch(e) {}
    }

    const sunucuConfPath = path.join(config.ETC_DIR, 'apache2', 'sunucu.conf');
    if (fs.existsSync(sunucuConfPath)) {
        let content = fs.readFileSync(sunucuConfPath, 'utf-8');
        let phpDll = "php8apache2_4.dll"; // Default fallback
        let phpModuleName = "php_module";
        
        try {
            if (fs.existsSync(config.PHP_DIR)) {
                const dllMatch = fs.readdirSync(config.PHP_DIR).find(f => /^php(\d*)apache2_4\.dll$/i.test(f));
                if (dllMatch) {
                    phpDll = dllMatch;
                    const vNumStr = dllMatch.match(/^php(\d*)apache2_4\.dll$/i)[1];
                    const vNum = parseInt(vNumStr, 10);
                    // PHP 8 and later use the standard 'php_module' name
                    if (vNum >= 8 || vNumStr === '') phpModuleName = 'php_module';
                    else phpModuleName = `php${vNumStr}_module`;
                }
            }
        } catch(e) {}

        let cryptoDll = "libcrypto-3-x64.dll", sslDll = "libssl-3-x64.dll";
        if (fs.existsSync(path.join(config.PHP_DIR, 'libcrypto-1_1-x64.dll'))) {
            cryptoDll = "libcrypto-1_1-x64.dll"; sslDll = "libssl-1_1-x64.dll";
        }

        content = content.replace(/^Listen\s+\d+/m, `Listen ${config.HTTPS_PORT}`);
        content = content.replace(/LoadFile "\${PHP_DIR}\/libcrypto.*?"/m, `LoadFile "\${PHP_DIR}/${cryptoDll}"`);
        content = content.replace(/LoadFile "\${PHP_DIR}\/libssl.*?"/m, `LoadFile "\${PHP_DIR}/${sslDll}"`);
        content = content.replace(/LoadModule php\d*_module "\${PHP_DIR}\/.*?"/m, `LoadModule ${phpModuleName} "\${PHP_DIR}/${phpDll}"`);
        // PHPIniDir must be an absolute path
        const phpDirAbsolute = config.PHP_DIR.replace(/\\/g, '/');
        // PHPIniDir can use the defined PHP_DIR variable
        if (content.match(/^PHPINIDir\s+".*?"/mi)) {
            content = content.replace(/^PHPINIDir\s+".*?"/mi, `PHPINIDir "\${PHP_DIR}"`);
        } else {
            content = content.replace(/^LoadModule.*?\n/mi, `$0PHPINIDir "\${PHP_DIR}"\n`);
        }
        
        
        // Use dynamically defined APP_DIR for phpMyAdmin
        content = content.replace(/Alias \/phpmyadmin ".*?"/mi, `Alias /phpmyadmin "\${APP_DIR}/etc/apps/phpMyAdmin/"`);
        content = content.replace(/<(Directory|directory) ".*?etc\/apps\/phpMyAdmin\/"/mi, `<$1 "\${APP_DIR}/etc/apps/phpMyAdmin/"`);
        fs.writeFileSync(sunucuConfPath, content);
    }

    const myIniPath = path.join(config.MYSQL_DIR, 'my.ini');
    if (fs.existsSync(config.MYSQL_DIR)) {
        const mysqlRoot = config.MYSQL_DIR.replace(/\\/g, '/'), dataRoot = config.MYSQL_DATA_DIR.replace(/\\/g, '/');
        const uploadDir = path.join(config.BASE_DIR, 'mysql_exports').replace(/\\/g, '/');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        let mVer = 8.0;
        try {
            if (fs.existsSync(config.MYSQL_BIN)) {
                const output = require('child_process').execSync(`"${config.MYSQL_BIN}" --version`).toString();
                const match = output.match(/Ver\s+(\d+\.\d+)/i);
                if (match) mVer = parseFloat(match[1]);
            }
        } catch(e) {}

        const isModern = mVer >= 8.0;

        if (!fs.existsSync(myIniPath)) {
            const defaultIni = `[mysqld]\nport=${config.MYSQL_PORT}\nbasedir="${mysqlRoot}"\ndatadir="${dataRoot}"\nplugin_dir="${mysqlRoot}/lib/plugin"\nsecure-file-priv="${uploadDir}"\n${isModern ? 'innodb_redo_log_capacity=64M\ndisable-log-bin' : 'innodb_log_file_size=64M\nskip-log-bin'}\n`;
            fs.writeFileSync(myIniPath, defaultIni);
        }

        let lines = fs.readFileSync(myIniPath, 'utf-8').split(/\r?\n/);
        lines = lines.map(line => {
            let l = line.trim();
            if (l.startsWith('port=')) return `port=${config.MYSQL_PORT}`;
            if (l.startsWith('basedir=')) return `basedir="${mysqlRoot}"`;
            if (l.startsWith('datadir=')) return `datadir="${dataRoot}"`;
            if (l.startsWith('plugin_dir=')) return `plugin_dir="${mysqlRoot}/lib/plugin"`;
            if (l.startsWith('secure-file-priv=')) return `secure-file-priv="${uploadDir}"`;
            
            if (l.startsWith('innodb_log_file_size=') || l.startsWith('innodb_redo_log_capacity=')) {
                return isModern ? `innodb_redo_log_capacity=64M` : `innodb_log_file_size=64M`;
            }
            if (l.startsWith('disable-log-bin') || l.startsWith('skip-log-bin') || l.startsWith('log-bin=')) {
                return isModern ? `disable-log-bin` : `skip-log-bin`;
            }

            return line;
        });

        if (!lines.some(l => l.includes('disable-log-bin') || l.includes('skip-log-bin'))) {
            lines.push(isModern ? 'disable-log-bin' : 'skip-log-bin');
        }

        fs.writeFileSync(myIniPath, lines.join('\n'));
    }
}

// ─── HELPERS ───

function getSources() {
    if (!fs.existsSync(SOURCES_FILE)) return { php: {}, apache: {}, mysql: {} };
    try { return JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf-8')); } catch(e) { return { php: {}, apache: {}, mysql: {} }; }
}

function isProcessRunning(name) {
    try {
        const result = execSync(`tasklist /FI "IMAGENAME eq ${name}" /NH`, { encoding: 'utf-8', windowsHide: true });
        return result.toLowerCase().includes(name.toLowerCase());
    } catch { return false; }
}

function stopAllProcesses(name) {
    try { execSync(`taskkill /F /IM ${name}`, { stdio: 'ignore', windowsHide: true }); } catch {}
}

function isCertificateExpired(hostname) {
    const crtPath = path.join(config.SSL_DIR, `${hostname}.crt`);
    if (!fs.existsSync(crtPath)) return true;
    try {
        const output = execSync(`"${config.OPENSSL_BIN}" x509 -enddate -noout -in "${crtPath}"`, { encoding: 'utf-8', windowsHide: true });
        const dateStr = output.split('=')[1].trim();
        const expiryDate = new Date(dateStr);
        const now = new Date();
        return (expiryDate.getTime() - now.getTime()) < (30 * 24 * 60 * 60 * 1000);
    } catch (e) { return true; }
}

function updateHostsFile() {
    try {
        if (!fs.existsSync(config.WWW_DIR)) return;
        const folders = fs.readdirSync(config.WWW_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => `${d.name}${config.VHOST_SUFFIX}`);
        try { execSync(`attrib -s -h -r "${config.HOSTS_FILE}"`, { stdio: 'ignore', windowsHide: true }); } catch(ans) {}
        let hostsContent = fs.readFileSync(config.HOSTS_FILE, 'utf-8'), lines = hostsContent.split(/\r?\n/);
        
        // First clean ALL lines tagged with #sunucu-yonetici
        // (This way, even if the suffix changes, the old ones won't remain)
        const cleanedLines = lines.filter(line => !line.includes('#sunucu-yonetici'));
        
        let finalLines = [...cleanedLines];
        folders.forEach(hostname => {
            finalLines.push(`127.0.0.1 ${hostname} #sunucu-yonetici`);
        });
        
        const newHostsContent = finalLines.join('\r\n');
        if (newHostsContent.trim() === hostsContent.trim()) return; // Skip if no changes
        
        const tempFile = path.join(process.env.TEMP, 'hosts_temp.txt');
        fs.writeFileSync(tempFile, newHostsContent);
        
        try {
            // Try normal copy first 
            execSync(`copy /Y "${tempFile}" "${config.HOSTS_FILE}"`, { stdio: 'ignore', windowsHide: true });
            execSync('ipconfig /flushdns', { stdio: 'ignore', windowsHide: true });
        } catch (e) {
            // If normal copy fails (permission issue), try with UAC
            // -Wait removed because it should not block server startup
            const psCmd = `Start-Process powershell -WindowStyle Hidden -Verb RunAs -ArgumentList '-NoProfile', '-WindowStyle', 'Hidden', '-Command', 'Copy-Item -Path \"${tempFile.replace(/\\/g, '\\\\')}\" -Destination \"${config.HOSTS_FILE.replace(/\\/g, '\\\\')}\" -Force; ipconfig /flushdns'`;
            try {
                execSync(`powershell -WindowStyle Hidden -NoProfile -Command "${psCmd}"`, { stdio: 'ignore', windowsHide: true });
                process.stdout.write(`  [OK] Updating Hosts (Administrator privileges requested).\n`);
            } catch (e2) {
                process.stdout.write(`  [!] Error: Unable to update Hosts file.\n`);
            }
        }
    } catch (err) {}
}

function verifyAndTrustCerts(silent = true) {
    if (process.platform !== 'win32') return;
    try {
        if (!fs.existsSync(config.SSL_DIR)) return;
        const certFiles = fs.readdirSync(config.SSL_DIR).filter(f => f.endsWith('.crt'));
        if (certFiles.length === 0) return;

        // Windows sertifika deposunda yüklü olanları kontrol et.
        // Konu maskesi (örn: CN=localhost veya CN=proje.test) ve Thumbprint'i bulalım veya en azından subject araması yapalım.
        let installedSubjects = [];
        try {
            // Hızlı sorgu için PowerShell 
            const psScript = `Get-ChildItem Cert:\\LocalMachine\\Root | Select-Object -ExpandProperty Subject`;
            const psBase64 = Buffer.from(psScript, 'utf16le').toString('base64');
            const output = execSync(`powershell -NoProfile -EncodedCommand ${psBase64}`, { encoding: 'utf-8', windowsHide: true });
            installedSubjects = output.split('\n').filter(Boolean).map(s => s.trim().toLowerCase());
        } catch (e) {
            // Hata olursa (Powershell çalışmazsa vs.) bir şey yapma
        }

        let certsToInstall = [];
        
        for (const file of certFiles) {
            const crtPath = path.join(config.SSL_DIR, file);
            // Sertifika Subject'ini al (OpenSSL ile)
            let subjectStr = '';
            try {
                const out = execSync(`"${config.OPENSSL_BIN}" x509 -noout -subject -nameopt RFC2253 -in "${crtPath}"`, { encoding: 'utf-8', windowsHide: true });
                subjectStr = out.replace(/^subject=/, '').trim().toLowerCase();
            } catch (e) {
                // OpenSSL hatasıysa varsayılan olarak domain adını al
                subjectStr = 'cn=' + file.replace('.crt', '').toLowerCase();
            }

            // Dosya adı veya subject store'da var mı?
            const domainToken = 'cn=' + file.replace('.crt', '').toLowerCase();
            
            const isInstalled = installedSubjects.some(subj => subj.includes(subjectStr) || subj.includes(domainToken));
            if (!isInstalled) {
                certsToInstall.push(crtPath);
            }
        }

        if (certsToInstall.length > 0) {
            // Write a temporary PS1 script to avoid complex escaping issues
            const tempScriptPath = path.join(config.SSL_DIR, '_install_certs.ps1');
            try {
                const scriptLines = certsToInstall.map(cp => {
                    const safePath = cp.replace(/\\/g, '/');
                    return `Import-Certificate -FilePath "${safePath}" -CertStoreLocation Cert:\\LocalMachine\\Root | Out-Null`;
                });
                fs.writeFileSync(tempScriptPath, scriptLines.join('\r\n'));
                
                // Run the script elevated via PowerShell → Start-Process with RunAs verb
                const escapedScript = tempScriptPath.replace(/\\/g, '\\\\');
                execSync(
                    `powershell -NoProfile -WindowStyle Hidden -Command "Start-Process powershell -Wait -WindowStyle Hidden -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${escapedScript}'"`,
                    { stdio: 'ignore', windowsHide: true, timeout: 30000 }
                );
                if (!silent) process.stdout.write(`  [OK] Installed ${certsToInstall.length} SSL certificate(s) to Windows trust store.\n`);
            } catch (e) {
                if (!silent) process.stdout.write(`  [!] Error: Unable to install missing SSL certificates to Windows trust store.\n`);
                process.stdout.write(`  [!] SSL Trust Error: ${e.message}\n`);
            } finally {
                try { if (fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath); } catch(e) {}
            }
        }
    } catch(err) {
        if (!silent) process.stdout.write(`  [!] Error checking/trusting certificates: ${err.message}\n`);
    }
}

function generateSSLCert(hostname) {
    const sslDir = config.SSL_DIR, confFile = path.join(sslDir, `${hostname}.cnf`);
    const cnf = `[req]\ndefault_bits=2048\ndistinguished_name=dn\nx509_extensions=v3_req\nprompt=no\n[dn]\nCN=${hostname}\n[v3_req]\nsubjectAltName=DNS:${hostname},DNS:*.${hostname},IP:127.0.0.1\n`;
    fs.writeFileSync(confFile, cnf);
    try {
        const keyFile = path.join(sslDir, `${hostname}.key`), crtFile = path.join(sslDir, `${hostname}.crt`);
        if (fs.existsSync(crtFile)) fs.unlinkSync(crtFile);
        if (fs.existsSync(keyFile)) fs.unlinkSync(keyFile);
        execSync(`"${config.OPENSSL_BIN}" req -x509 -nodes -days 3650 -newkey rsa:2048 -keyout "${keyFile}" -out "${crtFile}" -config "${confFile}"`, { stdio: 'ignore', windowsHide: true });
    } catch (e) {}
    if (fs.existsSync(confFile)) fs.unlinkSync(confFile);
}

function syncVhosts() {
    if (!fs.existsSync(config.WWW_DIR)) return;
    let needsRestart = false;
    updateHostsFile();

    // 1. Create Default Localhost Configuration (Loaded first due to 000 prefix)
    const defaultConfPath = path.join(config.SITES_ENABLED_DIR, '000-default.conf');
    const wwwRoot = config.WWW_DIR.replace(/\\/g, '/'), sslDir = config.SSL_DIR.replace(/\\/g, '/');
    
    if (isCertificateExpired('localhost')) { generateSSLCert('localhost'); needsRestart = true; }
    
    let defaultConf = `<VirtualHost *:${config.HTTP_PORT}>\n  ServerName localhost\n  ServerAlias 127.0.0.1 ::1\n  DocumentRoot "${wwwRoot}"\n  <Directory "${wwwRoot}">\n    AllowOverride All\n    Require all granted\n    Options Indexes FollowSymLinks\n  </Directory>\n</VirtualHost>\n`;
    defaultConf += `<VirtualHost *:${config.HTTPS_PORT}>\n  ServerName localhost\n  ServerAlias 127.0.0.1 ::1\n  DocumentRoot "${wwwRoot}"\n  SSLEngine on\n  SSLCertificateFile "${sslDir}/localhost.crt"\n  SSLCertificateKeyFile "${sslDir}/localhost.key"\n  <Directory "${wwwRoot}">\n    AllowOverride All\n    Require all granted\n    Options Indexes FollowSymLinks\n  </Directory>\n</VirtualHost>\n`;

    if (!fs.existsSync(defaultConfPath) || fs.readFileSync(defaultConfPath, 'utf-8') !== defaultConf) {
        fs.writeFileSync(defaultConfPath, defaultConf);
        needsRestart = true;
    }

    // 2. Cleanup orphaned auto-generated vhosts
    const currentFolders = fs.readdirSync(config.WWW_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    const validHostnames = currentFolders.map(f => `${f}${config.VHOST_SUFFIX}`);
    fs.readdirSync(config.SITES_ENABLED_DIR).filter(f => f.startsWith('auto.')).forEach(file => {
        const hostname = file.replace('auto.', '').replace('.conf', '');
        if (!validHostnames.includes(hostname)) {
            try {
                fs.unlinkSync(path.join(config.SITES_ENABLED_DIR, file));
                if (fs.existsSync(path.join(config.SSL_DIR, `${hostname}.crt`))) fs.unlinkSync(path.join(config.SSL_DIR, `${hostname}.crt`));
                if (fs.existsSync(path.join(config.SSL_DIR, `${hostname}.key`))) fs.unlinkSync(path.join(config.SSL_DIR, `${hostname}.key`));
                needsRestart = true;
            } catch (e) {}
        }
    });

    // 3. Create/Update Project Virtual Hosts
    currentFolders.forEach(folder => {
        const hostname = `${folder}${config.VHOST_SUFFIX}`, confPath = path.join(config.SITES_ENABLED_DIR, `auto.${hostname}.conf`);
        if (isCertificateExpired(hostname)) { generateSSLCert(hostname); needsRestart = true; }
        
        const projectRoot = path.join(config.WWW_DIR, folder);
        let docRoot = projectRoot;
        
        // Laravel, Symfony vb. modern framework'ler için 'public' klasörünü otomatik algıla
        if (fs.existsSync(path.join(projectRoot, 'public')) && fs.lstatSync(path.join(projectRoot, 'public')).isDirectory()) {
            docRoot = path.join(projectRoot, 'public');
        }

        const projectRootFormatted = projectRoot.replace(/\\/g, '/');
        const docRootFormatted = docRoot.replace(/\\/g, '/');

        let vConf = `define ROOT "${projectRootFormatted}"\ndefine DOCROOT "${docRootFormatted}"\n<VirtualHost *:${config.HTTP_PORT}>\nServerName ${hostname}\nDocumentRoot "\${DOCROOT}"\n<Directory "\${DOCROOT}">\nAllowOverride All\nRequire all granted\n</Directory>\n</VirtualHost>\n`;
        vConf += `<VirtualHost *:${config.HTTPS_PORT}>\nServerName ${hostname}\nDocumentRoot "\${DOCROOT}"\nSSLEngine on\nSSLCertificateFile "${sslDir}/${hostname}.crt"\nSSLCertificateKeyFile "${sslDir}/${hostname}.key"\n<Directory "\${DOCROOT}">\nAllowOverride All\nRequire all granted\n</Directory>\n</VirtualHost>\n`;

        if (!fs.existsSync(confPath) || fs.readFileSync(confPath, 'utf-8') !== vConf) {
            fs.writeFileSync(confPath, vConf);
            needsRestart = true;
        }
    });

    // Check and trust all missing certificates (batches UAC requests if needed)
    verifyAndTrustCerts();

    if (needsRestart && isProcessRunning('httpd.exe') && fs.existsSync(config.APACHE_BIN)) {
        stopAllProcesses('httpd.exe');
        setTimeout(() => startService('apache'), 1500);
    }
}

// ─── SERVICES ───

function startService(name) {
    if (name === 'apache') {
        if (!fs.existsSync(config.APACHE_BIN)) return;
        
        const pidPath = path.join(config.APACHE_DIR, 'logs', 'httpd.pid');
        const apacheEnv = { ...process.env, PATH: `${config.PHP_DIR};${path.join(config.APACHE_DIR, 'bin')};${process.env.PATH}` };
        
        // [Portable] Pre-flight config test — catch errors before starting
        try {
            execSync(`"${config.APACHE_BIN}" -t -f "${config.APACHE_CONF}"`, {
                encoding: 'utf-8',
                windowsHide: true,
                env: apacheEnv,
                timeout: 10000
            });
        } catch (configErr) {
            const errMsg = (configErr.stderr || configErr.message || '').trim();
            const errLogPath = path.join(config.APACHE_DIR, 'logs', 'error_log');
            try { fs.appendFileSync(errLogPath, `\n[CONFIG TEST FAILED] ${errMsg}\n`); } catch(e) {}
            process.stdout.write(`  [!] Apache config test failed: ${errMsg}\n`);
            // Don't start Apache if config is broken
            return;
        }

        // Ensure process is stopped before PID cleanup (aggressive close)
        stopAllProcesses('httpd.exe');

        // Loop to delete PID file (handle file locks)
        for (let i = 0; i < 5; i++) {
            if (fs.existsSync(pidPath)) {
                try { fs.unlinkSync(pidPath); break; } catch(e) { 
                    execSync('timeout /t 1 /nobreak > nul 2>&1 || ping 127.0.0.1 -n 1 > nul', { shell: true });
                }
            } else break;
        }

        // Best practice on Windows: use spawn(bin, [args]) and keep shell: false.
        // Node.js will wrap arguments in quotes automatically.
        const child = spawn(config.APACHE_BIN, ['-f', config.APACHE_CONF], {
            cwd: path.join(config.APACHE_DIR, 'bin'),
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: apacheEnv
        });
        
        const errLogPath = path.join(config.APACHE_DIR, 'logs', 'error_log');
        if (child.stdout) child.stdout.on('data', data => { try { fs.appendFileSync(errLogPath, data); } catch(e){} });
        if (child.stderr) child.stderr.on('data', data => { try { fs.appendFileSync(errLogPath, data); } catch(e){} });
        child.unref();
    } else if (name === 'mysql') {
        if (!fs.existsSync(config.MYSQL_BIN)) return;
        if (initializingServices.mysql) return; // Already initializing

        const runMysqlCmd = () => {
            const child = spawn(config.MYSQL_BIN, [`--defaults-file=${path.join(config.MYSQL_DIR, 'my.ini')}`, `--datadir=${config.MYSQL_DATA_DIR}`, `--port=${config.MYSQL_PORT}`], {
                cwd: path.join(config.MYSQL_DIR, 'bin'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
            });
            
            const errLogPath = path.join(config.DATA_DIR, 'mysql-' + config.MYSQL_VERSION, `${os.hostname()}.err`);
            if (child.stdout) child.stdout.on('data', data => { try { fs.appendFileSync(errLogPath, data); } catch(e){} });
            if (child.stderr) child.stderr.on('data', data => { try { fs.appendFileSync(errLogPath, data); } catch(e){} });
            child.unref();
        };

        const mysqlSystemDb = path.join(config.MYSQL_DATA_DIR, 'mysql');
        if (!fs.existsSync(mysqlSystemDb)) {
            try {
                if (!fs.existsSync(config.MYSQL_DATA_DIR)) fs.mkdirSync(config.MYSQL_DATA_DIR, { recursive: true });
                process.stdout.write(`  [INFO] Initializing MySQL Database...\n`);
                initializingServices.mysql = true;

                let mVer = 8.0;
                try {
                    const output = execSync(`"${config.MYSQL_BIN}" --version`).toString();
                    const match = output.match(/Ver\s+(\d+\.\d+)/i);
                    if (match) mVer = parseFloat(match[1]);
                } catch(e) {}

                const onInitComplete = (err) => {
                    initializingServices.mysql = false;
                    if (err) {
                        process.stdout.write(`  [!] MySQL Initialization Error: ${err.message}\n`);
                    } else {
                        process.stdout.write(`  [INFO] MySQL Database Initialized.\n`);
                        runMysqlCmd();
                    }
                };

                if (mVer >= 5.7) {
                    exec(`"${config.MYSQL_BIN}" --defaults-file="${path.join(config.MYSQL_DIR, 'my.ini')}" --initialize-insecure`, { windowsHide: true }, onInitComplete);
                } else {
                    const defaultDataFolder = path.join(config.MYSQL_DIR, 'data');
                    if (fs.existsSync(defaultDataFolder)) {
                        // For old versions, we still copy synchronously as it's usually fast, 
                        // but if we wanted to be fully async we'd need a different approach.
                        const copyRecursiveSync = function(src, dest) {
                            if (fs.existsSync(src)) {
                                if (fs.statSync(src).isDirectory()) {
                                    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
                                    fs.readdirSync(src).forEach(child => copyRecursiveSync(path.join(src, child), path.join(dest, child)));
                                } else fs.copyFileSync(src, dest);
                            }
                        };
                        copyRecursiveSync(defaultDataFolder, config.MYSQL_DATA_DIR);
                        onInitComplete(null);
                    } else {
                        const installDbExe = path.join(config.MYSQL_DIR, 'bin', 'mysql_install_db.exe');
                        if (fs.existsSync(installDbExe)) {
                            exec(`"${installDbExe}" --defaults-file="${path.join(config.MYSQL_DIR, 'my.ini')}" --datadir="${config.MYSQL_DATA_DIR}"`, { windowsHide: true }, onInitComplete);
                        } else {
                            onInitComplete(new Error('mysql_install_db.exe not found'));
                        }
                    }
                }
            } catch (e) {
                initializingServices.mysql = false;
                process.stdout.write(`  [!] MySQL Initialization Error!\n`);
            }
        } else {
            runMysqlCmd();
        }
    }
}

// ─── API ROUTES ───

app.get('/api/logs/:type/:version', (req, res) => {
    const { type, version } = req.params;
    let logPath = '';
    
    if (type === 'apache') logPath = path.join(config.VERSIONS_DIR, 'apache', version, 'logs', 'error_log');
    else if (type === 'mysql') logPath = path.join(config.DATA_DIR, 'mysql-' + version, `${os.hostname()}.err`);

    if (!logPath || !fs.existsSync(logPath)) return res.json({ success: true, logs: `--- ${t('log_not_found', 'Log file not found')} ---` });
    try {
        const content = fs.readFileSync(logPath, 'utf-8');
        res.json({ success: true, logs: content.length ? content : `--- ${t('log_empty', 'Log file is empty (Clean)')} ---` });
    } catch (e) { res.json({ success: false, message: t('log_read_err', 'Error occurred while reading the log file.') }); }
});

app.post('/api/logs/:type/:version/clear', (req, res) => {
    const { type, version } = req.params;
    let logPath = '';
    
    if (type === 'apache') logPath = path.join(config.VERSIONS_DIR, 'apache', version, 'logs', 'error_log');
    else if (type === 'mysql') logPath = path.join(config.DATA_DIR, 'mysql-' + version, `${os.hostname()}.err`);

    if (logPath && fs.existsSync(logPath)) {
        try { fs.writeFileSync(logPath, ''); } catch (e) { return res.json({ success: false, message: t('log_clear_err', 'Could not clear the log file.')}); }
    }
    res.json({ success: true, message: t('log_cleared', 'Log records deleted successfully.') });
});


app.get('/api/versions', (req, res) => {
    const list = { php: [], apache: [], mysql: [] };
    ['php', 'apache', 'mysql'].forEach(type => {
        const dir = path.join(config.VERSIONS_DIR, type);
        if (fs.existsSync(dir)) list[type] = fs.readdirSync(dir).filter(f => fs.lstatSync(path.join(dir, f)).isDirectory());
    });
    res.json({ installed: list, available: getSources() });
});

app.post('/api/versions/add-source', (req, res) => {
    const { type, version, url } = req.body;
    if (!type || !version || !url) return res.status(400).json({ success: false, message: t('missing_info', 'Missing information.') });
    const sources = getSources(); if (!sources[type]) sources[type] = {};
    sources[type][version] = url;
    fs.writeFileSync(SOURCES_FILE, JSON.stringify(sources, null, 4));
    res.json({ success: true, message: t('new_version_added', 'New version added.') });
});


let downloadProgressMap = {};

app.post('/api/versions/download', (req, res) => {
    const { type, version } = req.body;
    const sources = getSources();
    const url = sources[type]?.[version];
    
    if (!url) return res.status(400).json({ success: false, message: t('url_not_found', 'URL not found.') });
    
    const targetDir = path.join(config.VERSIONS_DIR, type, version);
    if (fs.existsSync(targetDir)) return res.json({ success: true, message: 'Already installed.' });

    const dlKey = `${type}_${version}`;
    if (downloadProgressMap[dlKey] && downloadProgressMap[dlKey].status === 'downloading') {
        return res.json({ success: true, message: t('downloadAlreadyInProgress', 'Download already in progress.') });
    }

    downloadProgressMap[dlKey] = { status: 'downloading', progress: 0, message: t('downloading', 'Downloading... (0%)') };
    res.json({ success: true, dlKey, message: t('download_started', 'Download started.') });

    const tempZip = path.join(os.tmpdir(), `sunucu_${type}_${version}.zip`);
    const tmpDir = targetDir + '_tmp';
    const td = targetDir.replace(/\\/g, '/');
    const tz = tempZip.replace(/\\/g, '/');
    const tm = tmpDir.replace(/\\/g, '/');

    const downloadFile = (fileUrl, dest, cookies = []) => {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(fileUrl);
            const lib = parsedUrl.protocol === 'https:' ? require('https') : require('http');
            const referer = `${parsedUrl.protocol}//${parsedUrl.hostname}/`;
            const options = {
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'identity',
                    'Referer': referer,
                    'Connection': 'keep-alive'
                }
            };
            // Carry cookies between redirects (MySQL server performs session validation)
            if (cookies.length > 0) {
                options.headers['Cookie'] = cookies.map(c => c.split(';')[0]).join('; ');
            }

            const request = lib.get(options, (response) => {
                // Collect new cookies
                const newCookies = [...cookies];
                const setCookies = response.headers['set-cookie'];
                if (setCookies) {
                    setCookies.forEach(c => newCookies.push(c));
                }

                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    let redirectUrl = response.headers.location;
                    // Convert relative redirects to absolute URLs
                    if (redirectUrl.startsWith('/')) {
                        redirectUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${redirectUrl}`;
                    }
                    return downloadFile(redirectUrl, dest, newCookies).then(resolve).catch(reject);
                }
                if (response.statusCode !== 200) return reject(new Error('HTTP Error: ' + response.statusCode));
                
                const totalBytes = parseInt(response.headers['content-length'], 10);
                let downloadedBytes = 0;
                const file = fs.createWriteStream(dest);
                
                response.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    if (totalBytes) {
                        const pct = Math.round((downloadedBytes / totalBytes) * 100);
                        const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
                        const totalMb = (totalBytes / 1024 / 1024).toFixed(1);
                        downloadProgressMap[dlKey].progress = pct;
                        downloadProgressMap[dlKey].message = t('downloading_mb', 'Downloading... {x} MB / {y} MB ({z}%)', { x: mb, y: totalMb, z: pct });
                    }
                });
                
                response.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
                file.on('error', (e) => { fs.unlink(dest, () => {}); reject(e); });
            }).on('error', reject);
        });
    };

    (async () => {
        try {
            await downloadFile(url, tempZip);
            downloadProgressMap[dlKey].status = 'extracting';
            downloadProgressMap[dlKey].message = t('extracting', 'Extracting archive, please wait. This may take a moment depending on the file size...');

            const psScript = `$ProgressPreference='SilentlyContinue'
            try {
                Expand-Archive -Path '${tz}' -DestinationPath '${tm}' -Force
                if (!(Test-Path '${td}')) { New-Item -ItemType Directory -Path '${td}' -Force | Out-Null }
                
                $finalRoot = ''
                $binFile = Get-ChildItem -Path '${tm}' -Filter 'httpd.exe' -Recurse -Depth 2 | Select-Object -First 1
                if (!$binFile) { $binFile = Get-ChildItem -Path '${tm}' -Filter 'mysqld.exe' -Recurse -Depth 2 | Select-Object -First 1 }
                if (!$binFile) { $binFile = Get-ChildItem -Path '${tm}' -Filter 'php.exe' -Recurse -Depth 2 | Select-Object -First 1 }

                if ($binFile) {
                    if ($binFile.DirectoryName.EndsWith('\\bin') -or $binFile.DirectoryName.EndsWith('/bin')) {
                        $finalRoot = $binFile.Directory.Parent.FullName
                    } else {
                        $finalRoot = $binFile.DirectoryName
                    }
                } else {
                    $items = Get-ChildItem -Path '${tm}'
                    if ($items.Count -eq 1 -and $items[0].PSIsContainer) {
                        $finalRoot = $items[0].FullName
                    } else {
                        $finalRoot = '${tm}'
                    }
                }

                if ($finalRoot -and (Test-Path $finalRoot)) {
                    Get-ChildItem -Path $finalRoot | Move-Item -Destination '${td}' -Force
                }
                
                Remove-Item -Path '${tm}' -Recurse -Force -ErrorAction SilentlyContinue
                Remove-Item -Path '${tz}' -Force -ErrorAction SilentlyContinue
            } catch {
                Write-Error $_.Exception.Message
                exit 1
            }`;
            const psBase64 = Buffer.from(psScript, 'utf16le').toString('base64');
            require('child_process').execSync(`powershell -WindowStyle Hidden -NoProfile -EncodedCommand ${psBase64}`, { windowsHide: true });
            
            downloadProgressMap[dlKey].status = 'done';
            downloadProgressMap[dlKey].progress = 100;
            downloadProgressMap[dlKey].message = t('install_success', 'Installation completed successfully.');
            initializeEnvironment(true); // Restart environment dynamically
            
        } catch (e) {
            downloadProgressMap[dlKey].status = 'error';
            downloadProgressMap[dlKey].message = t('download_err', 'An error occurred: {x}', { x: e.message });
        }
    })();
});

app.get('/api/versions/download-status/:dlkey', (req, res) => {
    const st = downloadProgressMap[req.params.dlkey];
    if (st) res.json({ success: true, status: st.status, progress: st.progress, message: st.message });
    else res.json({ success: false });
});

app.post('/api/versions/install-local/:type/:version', (req, res) => {
    const { type, version } = req.params;
    const targetDir = path.join(config.VERSIONS_DIR, type, version);
    if (fs.existsSync(targetDir)) return res.json({ success: false, message: t('already_installed', 'This version is already installed. Please delete the existing version first or give it a different name.') });

    const dlKey = `${type}_${version}`;
    if (downloadProgressMap[dlKey] && downloadProgressMap[dlKey].status === 'downloading') {
        return res.json({ success: false, message: t('downloadAlreadyInProgress', 'Process already in progress.') });
    }

    downloadProgressMap[dlKey] = { status: 'downloading', progress: 0, message: t('uploading', 'File uploading... (0%)') };
    res.json({ success: true, dlKey, message: t('upload_started', 'Upload started.') });

    const tempZip = path.join(os.tmpdir(), `sunucu_${type}_${version}.zip`);
    const file = fs.createWriteStream(tempZip);
    const totalBytes = parseInt(req.headers['content-length'], 10) || 0;
    let uploadedBytes = 0;

    req.on('data', (chunk) => {
        uploadedBytes += chunk.length;
        if (totalBytes) {
            const pct = Math.round((uploadedBytes / totalBytes) * 100);
            downloadProgressMap[dlKey].progress = pct;
            downloadProgressMap[dlKey].message = t('uploading_mb', 'Uploading... ({z}%)', { z: pct });
        }
    });

    req.pipe(file);

    req.on('end', () => {
        file.close();
        downloadProgressMap[dlKey].status = 'extracting';
        downloadProgressMap[dlKey].message = t('extracting', 'Extracting archive, please wait. This may take a moment depending on the file size...');

        const tmpDir = targetDir + '_tmp';
        const td = targetDir.replace(/\\/g, '/');
        const tz = tempZip.replace(/\\/g, '/');
        const tm = tmpDir.replace(/\\/g, '/');

        const psScript = `$ProgressPreference='SilentlyContinue'
        try {
            Expand-Archive -Path '${tz}' -DestinationPath '${tm}' -Force
            if (!(Test-Path '${td}')) { New-Item -ItemType Directory -Path '${td}' -Force | Out-Null }
            
            $finalRoot = ''
            $binFile = Get-ChildItem -Path '${tm}' -Filter 'httpd.exe' -Recurse -Depth 2 | Select-Object -First 1
            if (!$binFile) { $binFile = Get-ChildItem -Path '${tm}' -Filter 'mysqld.exe' -Recurse -Depth 2 | Select-Object -First 1 }
            if (!$binFile) { $binFile = Get-ChildItem -Path '${tm}' -Filter 'php.exe' -Recurse -Depth 2 | Select-Object -First 1 }

            if ($binFile) {
                if ($binFile.DirectoryName.EndsWith('\\bin') -or $binFile.DirectoryName.EndsWith('/bin')) {
                    $finalRoot = $binFile.Directory.Parent.FullName
                } else {
                    $finalRoot = $binFile.DirectoryName
                }
            } else {
                $items = Get-ChildItem -Path '${tm}'
                if ($items.Count -eq 1 -and $items[0].PSIsContainer) {
                    $finalRoot = $items[0].FullName
                } else {
                    $finalRoot = '${tm}'
                }
            }

            if ($finalRoot -and (Test-Path $finalRoot)) {
                Get-ChildItem -Path $finalRoot | Move-Item -Destination '${td}' -Force
            }

            Remove-Item -Path '${tm}' -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item -Path '${tz}' -Force -ErrorAction SilentlyContinue
        } catch {
            Write-Error $_.Exception.Message
            exit 1
        }`;

        require('child_process').exec(`powershell -WindowStyle Hidden -NoProfile -EncodedCommand ${Buffer.from(psScript, 'utf16le').toString('base64')}`, { windowsHide: true }, (error) => {
            if (error) {
                downloadProgressMap[dlKey].status = 'error';
                downloadProgressMap[dlKey].message = t('download_err', 'An error occurred: {x}', { x: error.message });
            } else {
                downloadProgressMap[dlKey].status = 'done';
                downloadProgressMap[dlKey].progress = 100;
                downloadProgressMap[dlKey].message = t('install_success', 'Installation completed successfully.');
                initializeEnvironment(true); // Restart environment dynamically
            }
        });
    });

    req.on('error', (err) => {
        fs.unlink(tempZip, () => {});
        downloadProgressMap[dlKey].status = 'error';
        downloadProgressMap[dlKey].message = t('download_err', 'An error occurred: {x}', { x: err.message });
    });
});

app.get('/api/status', (req, res) => {
    res.json({
        services: {
            apache: { 
                running: isProcessRunning('httpd.exe'), 
                port: config.HTTP_PORT, 
                httpsPort: config.HTTPS_PORT,
                vhostSuffix: config.VHOST_SUFFIX,
                version: config.APACHE_VERSION, 
                phpVersion: config.PHP_VERSION, 
                exists: fs.existsSync(config.APACHE_BIN),
                initializing: initializingServices.apache 
            },
            mysql: { 
                running: isProcessRunning('mysqld.exe'), 
                port: config.MYSQL_PORT, 
                version: config.MYSQL_VERSION, 
                exists: fs.existsSync(config.MYSQL_BIN),
                initializing: initializingServices.mysql 
            }
        },
        paths: { wwwDir: config.WWW_DIR }
    });
});

app.get('/api/settings', (req, res) => {
    const raw = config.getRawSettings();
    res.json({
        wwwDir: raw.WWW_DIR, dataDir: raw.DATA_DIR, backupDir: raw.BACKUP_DIR, vhostSuffix: raw.VHOST_SUFFIX,
        phpVersion: raw.PHP_VERSION, apacheVersion: raw.APACHE_VERSION, mysqlVersion: raw.MYSQL_VERSION,
        ports: { http: raw.HTTP_PORT, https: raw.HTTPS_PORT, mysql: raw.MYSQL_PORT, app: raw.APP_PORT },
        startOnWindows: raw.START_ON_WINDOWS,
        startMinimized: raw.START_MINIMIZED,
        autoStartServices: raw.AUTO_START_SERVICES,
        language: raw.LANGUAGE,
        browserMode: raw.BROWSER_MODE,
        browserPath: raw.BROWSER_PATH
    });
});

app.get('/api/languages', (req, res) => {
    const langDir = path.join(config.BASE_DIR, 'lang');
    let langs = [];
    if (fs.existsSync(langDir)) {
        const files = fs.readdirSync(langDir).filter(f => f.endsWith('.json'));
        for (const f of files) {
            try {
                const content = JSON.parse(fs.readFileSync(path.join(langDir, f), 'utf-8'));
                langs.push({
                    code: f.replace('.json', ''),
                    name: content._name || f.replace('.json', '')
                });
            } catch(e) {}
        }
    }
    if (langs.length === 0) langs.push({ code: 'en', name: 'English' });
    res.json({ success: true, languages: langs });
});

app.post('/api/settings', (req, res) => {
    const { wwwDir, dataDir, backupDir, vhostSuffix, phpVersion, apacheVersion, mysqlVersion, ports, startOnWindows, startMinimized, autoStartServices, language, browserMode, browserPath } = req.body;
    
    if (phpVersion && !fs.existsSync(path.join(config.VERSIONS_DIR, 'php', phpVersion))) {
        return res.json({ success: false, message: t('php_not_installed_err', `Error: Selected PHP version ({x}) is not downloaded.`, { x: phpVersion }) });
    }
    if (apacheVersion && !fs.existsSync(path.join(config.VERSIONS_DIR, 'apache', apacheVersion))) {
        return res.json({ success: false, message: t('apache_not_installed_err', `Error: Selected Apache version ({x}) is not downloaded.`, { x: apacheVersion }) });
    }
    if (mysqlVersion && !fs.existsSync(path.join(config.VERSIONS_DIR, 'mysql', mysqlVersion))) {
        return res.json({ success: false, message: t('mysql_not_installed_err', `Error: Selected MySQL version ({x}) is not downloaded.`, { x: mysqlVersion }) });
    }


    // [Portable] Support for {APP} variable — normalize all paths to portable format
    const resolveAndClean = (p) => {
        if (!p) return p;
        if (p.toString().includes('{APP}')) return p;
        // Absolute path under BASE_DIR → convert to {APP}/relative
        const normBase = config.BASE_DIR.replace(/\\/g, '/').toLowerCase();
        const normP = p.replace(/\\/g, '/').toLowerCase();
        if (normP.startsWith(normBase)) {
            const relativePart = path.relative(config.BASE_DIR, p).replace(/\\/g, '/');
            return relativePart ? `{APP}/${relativePart}` : '{APP}';
        }
        // Relative path (no drive letter, not {APP}) → normalize to {APP}/path for portability
        if (!path.isAbsolute(p)) {
            const cleaned = p.replace(/\\/g, '/');
            return `{APP}/${cleaned}`;
        }
        // Absolute path outside BASE_DIR → keep as-is (user intentionally set external path)
        return p;
    };

    const finalWwwDir = resolveAndClean(wwwDir);
    const finalDataDir = resolveAndClean(dataDir);
    const finalBackupDir = resolveAndClean(backupDir || 'backups');
    const finalBrowserPath = resolveAndClean(browserPath);

    // Detect changes
    const raw = config.getRawSettings();
    const rApache = (raw.WWW_DIR !== finalWwwDir || raw.VHOST_SUFFIX !== vhostSuffix || raw.PHP_VERSION !== phpVersion || raw.APACHE_VERSION !== apacheVersion || raw.HTTP_PORT !== parseInt(ports.http) || raw.HTTPS_PORT !== parseInt(ports.https));
    const rMysql = (raw.DATA_DIR !== finalDataDir || raw.MYSQL_VERSION !== mysqlVersion || raw.MYSQL_PORT !== parseInt(ports.mysql));
    const rApp = (raw.APP_PORT !== parseInt(ports.app));

    const wasApacheRunning = isProcessRunning('httpd.exe');
    const wasMysqlRunning = isProcessRunning('mysqld.exe');

    fs.writeFileSync(config.SETTINGS_FILE, JSON.stringify({
        WWW_DIR: finalWwwDir, DATA_DIR: finalDataDir, BACKUP_DIR: finalBackupDir, VHOST_SUFFIX: vhostSuffix, 
        PHP_VERSION: phpVersion, APACHE_VERSION: apacheVersion, MYSQL_VERSION: mysqlVersion,
        HTTP_PORT: parseInt(ports.http), HTTPS_PORT: parseInt(ports.https),
        MYSQL_PORT: parseInt(ports.mysql), APP_PORT: parseInt(ports.app),
        START_ON_WINDOWS: !!startOnWindows,
        START_MINIMIZED: !!startMinimized,
        AUTO_START_SERVICES: !!autoStartServices,
        LANGUAGE: language,
        BROWSER_MODE: browserMode,
        BROWSER_PATH: finalBrowserPath
    }, null, 4));
    
    // Refresh memory and configuration immediately
    config.reload();
    loadServerI18n(); // Load if language changed
    initializeEnvironment(true);
    
    let msg = t('settings_updated', 'Settings updated.');
    
    // Handle App Port Change (Close/Restart App)
    if (rApp) {
        if (process.send) {
            // Give a small delay to allow response to reach the frontend
            setTimeout(() => {
                process.send({ type: 'restart-app', newPort: parseInt(ports.app) });
            }, 1500);
        }
        return res.json({ success: true, message: t('app_port_restart_msg', 'Application port changed. Restarting on port {x}...', { x: ports.app }), restart: true, newPort: parseInt(ports.app) });
    }

    if (rApache) {
        // Port changed! Clear old auto-generated vhosts so syncVhosts can recreate them with new ports
        try {
            const files = fs.readdirSync(config.SITES_ENABLED_DIR);
            files.forEach(file => {
                if (file.endsWith('.conf')) fs.unlinkSync(path.join(config.SITES_ENABLED_DIR, file));
            });
            // User requested to recreate certificates when port changes
            const sslFiles = fs.readdirSync(config.SSL_DIR);
            sslFiles.forEach(file => {
                if (file.endsWith('.crt') || file.endsWith('.key')) fs.unlinkSync(path.join(config.SSL_DIR, file));
            });
        } catch(e) {}
        
        if (wasApacheRunning) {
            stopAllProcesses('httpd.exe');
            setTimeout(() => {
                syncVhosts(); // This will recreate vhosts and certs with new settings
                startService('apache');
            }, 1500);
            msg += " " + t('apache_restarting', 'Apache is restarting...');
        } else {
            // Just sync files without starting the process
            syncVhosts();
        }
    }
    if (rMysql && wasMysqlRunning) {
        stopAllProcesses('mysqld.exe');
        setTimeout(() => startService('mysql'), 1000);
        msg += " " + t('mysql_restarting', 'MySQL is restarting...');
    }
    
    res.json({ success: true, message: msg.trim() });
});


// ─── PHP EXTENSIONS & SETTINGS API ───

// List available extensions for the selected PHP version
app.get('/api/php/extensions/:version', (req, res) => {
    const { version } = req.params;
    const phpDir = path.join(config.VERSIONS_DIR, 'php', version);
    const extDir = path.join(phpDir, 'ext');
    const phpIniPath = path.join(phpDir, 'php.ini');

    if (!fs.existsSync(extDir)) return res.json({ success: false, message: 'PHP ext folder not found.' });

    // Scan existing DLL extensions
    const allExts = fs.readdirSync(extDir)
        .filter(f => /^php_(.+)\.dll$/i.test(f))
        .map(f => f.match(/^php_(.+)\.dll$/i)[1])
        .filter(name => !['dl_test', 'zend_test'].includes(name))
        .sort();

    // Read enabled extensions from php.ini
    let enabledExts = [];
    if (fs.existsSync(phpIniPath)) {
        const ini = fs.readFileSync(phpIniPath, 'utf-8');
        const extLines = ini.match(/^extension=(\S+)/gm) || [];
        enabledExts = extLines.map(l => l.replace('extension=', '').trim());
        // OPcache specific (zend_extension)
        if (/^zend_extension=opcache/m.test(ini)) enabledExts.push('opcache');
    }

    const extensions = allExts.map(name => ({
        name,
        enabled: enabledExts.includes(name),
        description: getExtDescription(name)
    }));

    res.json({ success: true, extensions });
});

// Update PHP extensions
app.post('/api/php/extensions/:version', (req, res) => {
    const { version } = req.params;
    const { extensions } = req.body; // [{name, enabled}]
    const phpDir = path.join(config.VERSIONS_DIR, 'php', version);
    const phpIniPath = path.join(phpDir, 'php.ini');

    if (!fs.existsSync(phpIniPath)) return res.json({ success: false, message: 'php.ini not found.' });

    let ini = fs.readFileSync(phpIniPath, 'utf-8');

    extensions.forEach(ext => {
        if (ext.name === 'opcache') {
            // OPcache specific (zend_extension)
            if (ext.enabled) {
                ini = ini.replace(/^;zend_extension=opcache/m, 'zend_extension=opcache');
            } else {
                ini = ini.replace(/^zend_extension=opcache/m, ';zend_extension=opcache');
            }
        } else {
            if (ext.enabled) {
                // First uncomment the line
                const commentRegex = new RegExp(`^;extension=${ext.name}\\b`, 'm');
                if (commentRegex.test(ini)) {
                    ini = ini.replace(commentRegex, `extension=${ext.name}`);
                } else if (!new RegExp(`^extension=${ext.name}\\b`, 'm').test(ini)) {
                    // Add if not present
                    ini = ini.replace(/(\[ExtensionList\]|\n;extension=|^extension=)/m, (match) => {
                        return `extension=${ext.name}\n${match}`;
                    });
                    // If still not added, append to the end of file
                    if (!new RegExp(`^extension=${ext.name}\\b`, 'm').test(ini)) {
                        ini += `\nextension=${ext.name}`;
                    }
                }
            } else {
                // Disable active extension (comment it out)
                const activeRegex = new RegExp(`^extension=${ext.name}\\b`, 'gm');
                ini = ini.replace(activeRegex, `;extension=${ext.name}`);
            }
        }
    });

    fs.writeFileSync(phpIniPath, ini);

    // Restart Apache if it's running
    let restartMsg = '';
    if (isProcessRunning('httpd.exe') && version === config.PHP_VERSION) {
        stopAllProcesses('httpd.exe');
        setTimeout(() => startService('apache'), 1000);
        restartMsg = t('apache_restarting', ' Apache is restarting...');
    }

    res.json({ success: true, message: t('php_ext_updated', 'Extension settings updated.') + restartMsg });
});


// Read PHP settings
app.get('/api/php/settings/:version', (req, res) => {
    const { version } = req.params;
    const phpDir = path.join(config.VERSIONS_DIR, 'php', version);
    const phpIniPath = path.join(phpDir, 'php.ini');

    if (!fs.existsSync(phpIniPath)) return res.json({ success: false, message: 'php.ini not found.' });

    const ini = fs.readFileSync(phpIniPath, 'utf-8');

    // Read popular PHP settings
    const settingsToRead = [
        { key: 'max_execution_time', label: t('php_set_max_exec_time', 'Max Execution Time'), unit: t('unit_sec', 'seconds'), default: '30' },
        { key: 'max_input_time', label: t('php_set_max_input_time', 'Max Input Time'), unit: t('unit_sec', 'seconds'), default: '60' },
        { key: 'memory_limit', label: t('php_set_mem_limit', 'Memory Limit'), unit: '', default: '128M' },
        { key: 'upload_max_filesize', label: t('php_set_upload_max', 'Max Upload Size'), unit: '', default: '2M' },
        { key: 'post_max_size', label: t('php_set_post_max', 'Max POST Size'), unit: '', default: '8M' },
        { key: 'max_file_uploads', label: t('php_set_file_uploads', 'Max File Uploads'), unit: t('unit_pcs', 'pcs'), default: '20' },
        { key: 'max_input_vars', label: t('php_set_input_vars', 'Max Input Vars'), unit: t('unit_pcs', 'pcs'), default: '1000' },
        { key: 'display_errors', label: t('php_set_disp_err', 'Display Errors'), unit: '', default: 'Off', type: 'toggle' },
        { key: 'display_startup_errors', label: t('php_set_startup_err', 'Display Startup Errors'), unit: '', default: 'Off', type: 'toggle' },
        { key: 'error_reporting', label: t('php_set_err_rep', 'Error Reporting Level'), unit: '', default: 'E_ALL & ~E_DEPRECATED & ~E_STRICT' },
        { key: 'log_errors', label: t('php_set_log_err', 'Log Errors'), unit: '', default: 'On', type: 'toggle' },
        { key: 'date.timezone', label: t('php_set_timezone', 'Timezone'), unit: '', default: '' },
        { key: 'realpath_cache_size', label: t('php_set_realpath_size', 'Realpath Cache Size'), unit: '', default: '4096k' },
        { key: 'realpath_cache_ttl', label: t('php_set_realpath_ttl', 'Realpath Cache TTL'), unit: t('unit_sec', 'seconds'), default: '120' },
        { key: 'session.gc_maxlifetime', label: t('php_set_session_gc', 'Session Lifetime (GC)'), unit: t('unit_sec', 'seconds'), default: '1440' },

    ];

    const result = settingsToRead.map(s => {
        // Read value from php.ini (detect even if commented out)
        const activeMatch = ini.match(new RegExp(`^${s.key.replace('.', '\\.')}\\s*=\\s*(.+)`, 'm'));
        const commentedMatch = ini.match(new RegExp(`^;\\s*${s.key.replace('.', '\\.')}\\s*=\\s*(.+)`, 'm'));
        
        let value = s.default;
        let isCommented = true;

        if (activeMatch) {
            value = activeMatch[1].trim();
            isCommented = false;
        } else if (commentedMatch) {
            value = commentedMatch[1].trim();
            isCommented = true;
        }

        return { ...s, value, isCommented };
    });

    res.json({ success: true, settings: result });
});

// Update PHP settings
app.post('/api/php/settings/:version', (req, res) => {
    const { version } = req.params;
    const { settings } = req.body; // [{key, value}]
    const phpDir = path.join(config.VERSIONS_DIR, 'php', version);
    const phpIniPath = path.join(phpDir, 'php.ini');

    if (!fs.existsSync(phpIniPath)) return res.json({ success: false, message: 'php.ini not found.' });

    let ini = fs.readFileSync(phpIniPath, 'utf-8');

    settings.forEach(s => {
        const escapedKey = s.key.replace('.', '\\.');
        const activeRegex = new RegExp(`^${escapedKey}\\s*=\\s*.+`, 'm');
        const commentedRegex = new RegExp(`^;\\s*${escapedKey}\\s*=\\s*.+`, 'm');

        if (activeRegex.test(ini)) {
            ini = ini.replace(activeRegex, `${s.key} = ${s.value}`);
        } else if (commentedRegex.test(ini)) {
            ini = ini.replace(commentedRegex, `${s.key} = ${s.value}`);
        } else {
            // Append if setting doesn't exist
            ini += `\n${s.key} = ${s.value}`;
        }
    });

    fs.writeFileSync(phpIniPath, ini);

    // Restart Apache if it's running  
    let restartMsg = '';
    if (isProcessRunning('httpd.exe') && version === config.PHP_VERSION) {
        stopAllProcesses('httpd.exe');
        setTimeout(() => startService('apache'), 1000);
        restartMsg = ' Apache is restarting...';
    }

    res.json({ success: true, message: `PHP settings updated.${restartMsg}` });
});

// Extension descriptions
function getExtDescription(name) {
    const descriptions = {
        'bz2': t('ext_bz2', 'BZip2 compression'),
        'com_dotnet': t('ext_com_dotnet', '.NET and COM objects'),
        'curl': t('ext_curl', 'HTTP client library'),
        'dba': t('ext_dba', 'Database abstraction layer'),
        'enchant': t('ext_enchant', 'Spell checking'),
        'exif': t('ext_exif', 'Photo EXIF metadata'),
        'ffi': t('ext_ffi', 'Foreign Function Interface'),
        'fileinfo': t('ext_fileinfo', 'File info detection'),
        'ftp': t('ext_ftp', 'FTP protocol'),
        'gd': t('ext_gd', 'Image processing (GD Library)'),
        'gettext': t('ext_gettext', 'Multi-language support'),
        'gmp': t('ext_gmp', 'High precision math'),
        'imap': t('ext_imap', 'Email (IMAP/POP3)'),
        'intl': t('ext_intl', 'Internationalization'),
        'ldap': t('ext_ldap', 'LDAP directory services'),
        'mbstring': t('ext_mbstring', 'Multi-byte character support'),
        'mysqli': t('ext_mysqli', 'MySQL database access'),
        'oci8_19': t('ext_oci8', 'Oracle database'),
        'odbc': t('ext_odbc', 'ODBC database connection'),
        'opcache': t('ext_opcache', 'OPcode cache (performance)'),
        'openssl': t('ext_openssl', 'SSL/TLS encryption'),
        'pdo_firebird': t('ext_pdo_firebird', 'PDO Firebird driver'),
        'pdo_mysql': t('ext_pdo_mysql', 'PDO MySQL driver'),
        'pdo_oci': t('ext_pdo_oci', 'PDO Oracle driver'),
        'pdo_odbc': t('ext_pdo_odbc', 'PDO ODBC driver'),
        'pdo_pgsql': t('ext_pdo_pgsql', 'PDO PostgreSQL driver'),
        'pdo_sqlite': t('ext_pdo_sqlite', 'PDO SQLite driver'),
        'pgsql': t('ext_pgsql', 'PostgreSQL database'),
        'shmop': t('ext_shmop', 'Shared memory'),
        'snmp': t('ext_snmp', 'SNMP network management'),
        'soap': t('ext_soap', 'SOAP web services'),
        'sockets': t('ext_sockets', 'Socket programming'),
        'sodium': t('ext_sodium', 'Modern encryption'),
        'sqlite3': t('ext_sqlite3', 'SQLite database'),
        'sysvshm': t('ext_sysvshm', 'System V shared memory'),
        'tidy': t('ext_tidy', 'HTML check/repair'),
        'xsl': t('ext_xsl', 'XSLT transformations'),
        'zip': t('ext_zip', 'ZIP archive support')
    };
    return descriptions[name] || '';
}

// ─── LIST MYSQL TABLES AND DATABASES ───

app.get('/api/mysql/tables', (req, res) => {
    if (!isProcessRunning('mysqld.exe')) return res.json({ success: false, message: t('mysql_closed_err', 'MySQL is closed or an error occurred') });

    // List DB and Table names except default DBs using mysql.exe
    const psw = `
        $out = & "${config.MYSQL_BIN}" -uroot --port=${config.MYSQL_PORT} -e "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')"
        Write-Output $out
    `;

    exec(`powershell -NoProfile -Command "${psw.replace(/\n/g, ' ')}"`, (err, stdout) => {
        if (err || !stdout.trim()) return res.json({ success: true, databases: [] });
        
        // table_schema    table_name\nDb1    Table1\n
        const lines = stdout.trim().split('\n').map(l => l.trim()).filter(l => l);
        lines.shift(); // remove header
        
        const dbMap = {};
        for(const line of lines) {
            const parts = line.split(/\s+/);
            const db = parts[0];
            const tb = parts[1];
            if (!dbMap[db]) dbMap[db] = [];
            if (tb) dbMap[db].push(tb);
        }
        res.json({ success: true, databases: dbMap });
    });
});

// ─── DATABASE OPERATIONS ───

const { execFile } = require('child_process');

// Middleware to block MySQL operations if initializing
const blockIfMysqlInitializing = (req, res, next) => {
    if (initializingServices.mysql) {
        return res.json({ success: false, message: t('wait_setup', 'Setting up database, this might take a few minutes. Please wait...') });
    }
    next();
};

app.use('/api/mysql', blockIfMysqlInitializing);

app.get('/api/mysql/db-list', (req, res) => {
    if (!isProcessRunning('mysqld.exe')) return res.json({ success: false, message: t('mysql_closed_err', 'MySQL is closed or an error occurred') });
    const mysqlClient = path.join(path.dirname(config.MYSQL_BIN), 'mysql.exe');
    execFile(mysqlClient, ['-uroot', `--port=${config.MYSQL_PORT}`, '-e', 'SHOW DATABASES;'], (err, stdout) => {
        if (err || !stdout) return res.json({ success: false, databases: [] });
        const lines = stdout.trim().split('\n').map(l => l.trim()).filter(l => l && !['Database', 'information_schema', 'mysql', 'performance_schema', 'sys'].includes(l));
        res.json({ success: true, databases: lines });
    });
});

app.post('/api/mysql/db-tables', (req, res) => {
    const { db } = req.body;
    if (!db || !isProcessRunning('mysqld.exe')) return res.json({ success: false, tables: [] });
    const mysqlClient = path.join(path.dirname(config.MYSQL_BIN), 'mysql.exe');
    execFile(mysqlClient, ['-uroot', `--port=${config.MYSQL_PORT}`, '-e', `SHOW TABLES FROM \`${db}\`;`], (err, stdout) => {
        if (err || !stdout) return res.json({ success: false, tables: [] });
        const lines = stdout.trim().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('Tables_in_'));
        res.json({ success: true, tables: lines });
    });
});

app.post('/api/mysql/create-db', (req, res) => {
    const { name, collation } = req.body;
    const col = collation || 'utf8mb4_general_ci';
    const mysqlClient = path.join(path.dirname(config.MYSQL_BIN), 'mysql.exe');
    execFile(mysqlClient, ['-uroot', `--port=${config.MYSQL_PORT}`, '-e', `CREATE DATABASE IF NOT EXISTS \`${name}\` COLLATE \`${col}\`;`], (err) => {
        if (err) return res.json({ success: false, message: t('create_err', 'Unable to create: ') + err.message });
        res.json({ success: true, message: t('db_created', 'Database created.') });
    });
});

app.post('/api/mysql/delete-db', (req, res) => {
    const { db } = req.body;
    if (!db) return res.json({ success: false });
    const mysqlClient = path.join(path.dirname(config.MYSQL_BIN), 'mysql.exe');
    execFile(mysqlClient, ['-uroot', `--port=${config.MYSQL_PORT}`, '-e', `DROP DATABASE IF EXISTS \`${db}\`;`], (err) => {
        if (err) return res.json({ success: false, message: t('delete_err', 'Unable to delete: ') + err.message });
        res.json({ success: true, message: t('db_deleted', 'Database deleted.') });
    });
});

app.post('/api/mysql/truncate-table', (req, res) => {
    const { db, table } = req.body;
    const mysqlClient = path.join(path.dirname(config.MYSQL_BIN), 'mysql.exe');
    // Temporarily disable foreign key checks (forced clear)
    const sql = `SET FOREIGN_KEY_CHECKS = 0; TRUNCATE TABLE \`${db}\`.\`${table}\`; SET FOREIGN_KEY_CHECKS = 1;`;
    execFile(mysqlClient, ['-uroot', `--port=${config.MYSQL_PORT}`, '-e', sql], (err) => {
        if (err) return res.json({ success: false, message: t('table_truncate_err', 'Unable to clear table: ') + err.message });
        res.json({ success: true, message: t('table_truncated', 'Table cleared.') });
    });
});

app.post('/api/mysql/delete-table', (req, res) => {
    const { db, table } = req.body;
    const mysqlClient = path.join(path.dirname(config.MYSQL_BIN), 'mysql.exe');
    // Temporarily disable foreign key checks (forced delete)
    const sql = `SET FOREIGN_KEY_CHECKS = 0; DROP TABLE IF EXISTS \`${db}\`.\`${table}\`; SET FOREIGN_KEY_CHECKS = 1;`;
    execFile(mysqlClient, ['-uroot', `--port=${config.MYSQL_PORT}`, '-e', sql], (err) => {
        if (err) return res.json({ success: false, message: t('table_delete_err', 'Unable to delete table: ') + err.message });
        res.json({ success: true, message: t('table_deleted', 'Table deleted.') });
    });
});

app.get('/api/mysql/export', (req, res) => {
    const { db, table } = req.query;
    if (!db) return res.status(400).send('DB parameter required');
    
    const dumpBin = path.join(path.dirname(config.MYSQL_BIN), 'mysqldump.exe');
    const downloadName = `${table || db}.sql`;
    const localName = `${table || db}_export_${Date.now()}.sql`; // Keep unique for temp storage
    const outFile = path.join(process.env.TEMP, localName);
    
    const args = ['--no-defaults', '-uroot', `--port=${config.MYSQL_PORT}`, db];
    if (table) args.push(table);
    
    execFile(dumpBin, args, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout) => {
        if (err) return res.status(500).send('Export error: ' + err.message);
        fs.writeFileSync(outFile, stdout);
        res.download(outFile, downloadName, err => {
            try { fs.unlinkSync(outFile); } catch(e){}
        });
    });
});

app.post('/api/mysql/import', (req, res) => {
    const { db, sqlContent } = req.body;
    if (!db || !sqlContent) return res.json({ success: false, message: t('db_sql_req', 'DB and SQL content are required.') });
    
    const tempSqlFile = path.join(process.env.TEMP, `import_${Date.now()}.sql`);
    const mysqlClient = path.join(path.dirname(config.MYSQL_BIN), 'mysql.exe');
    try {
        fs.writeFileSync(tempSqlFile, sqlContent, 'utf-8');
        const sqlCmd = `"${mysqlClient}" --no-defaults -uroot --port=${config.MYSQL_PORT} -e "CREATE DATABASE IF NOT EXISTS \`${db}\`;" && "${mysqlClient}" --no-defaults -uroot --port=${config.MYSQL_PORT} "${db}" < "${tempSqlFile}"`;
        exec(sqlCmd, { windowsHide: true }, (err, stdout, stderr) => {
            try { fs.unlinkSync(tempSqlFile); } catch(e){}
            if (err) return res.json({ success: false, message: t('import_err', 'Import error: ') + err.message });
            res.json({ success: true, message: t('sql_imported', 'SQL successfully imported.') });
        });
    } catch(e) {
        return res.json({ success: false, message: t('file_write_err', 'File write error: ') + e.message });
    }
});

// ─── BACKUP (SQL + ZIP) ───

let backupProgressMap = {};

app.post('/api/backup', (req, res) => {
    const { projectName, projectPath, dbName, tableName } = req.body;
    if (!fs.existsSync(projectPath)) return res.json({ success: false, message: t('project_not_found', 'Project folder not found.') });
    if (!fs.existsSync(config.BACKUP_DIR)) fs.mkdirSync(config.BACKUP_DIR, { recursive: true });

    const taskId = `backup_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    backupProgressMap[taskId] = { status: 'running', phase: 'starting', progress: 0, message: t('backup_starting', 'Starting backup...') };

    // Return immediately — frontend will poll for progress
    res.json({ success: true, taskId, message: t('backup_started', 'Backup started.') });

    // Run backup in background
    (async () => {
        let sqlFile = null;
        try {
            // Phase 1: SQL Export (if database selected)
            if (dbName && isProcessRunning('mysqld.exe')) {
                backupProgressMap[taskId] = { status: 'running', phase: 'sql_export', progress: 10, message: t('backup_exporting_db', 'Exporting database ({x})...', { x: dbName }) };

                const dumpBin = path.join(path.dirname(config.MYSQL_BIN), 'mysqldump.exe');
                sqlFile = path.join(projectPath, (tableName ? (tableName + '.sql') : (dbName + '.sql')));

                try {
                    // Direct execSync with stdout capture — no cmd.exe wrapping
                    const args = ['--no-defaults', '-uroot', `--port=${config.MYSQL_PORT}`, dbName];
                    if (tableName) args.push(tableName);

                    const dumpOutput = execSync(`"${dumpBin}" ${args.join(' ')}`, {
                        encoding: 'utf-8',
                        maxBuffer: 1024 * 1024 * 200,
                        windowsHide: true,
                        timeout: 300000
                    });

                    if (dumpOutput && dumpOutput.trim().length > 0) {
                        fs.writeFileSync(sqlFile, dumpOutput, 'utf-8');
                    } else {
                        throw new Error('mysqldump returned empty output');
                    }
                } catch(e) {
                    const errDetail = (e.stderr || e.message || '').substring(0, 300);
                    backupProgressMap[taskId] = { status: 'error', phase: 'sql_export', progress: 0, message: t('sql_export_err_msg', 'ERROR exporting SQL. ') + errDetail };
                    try { if (sqlFile && fs.existsSync(sqlFile)) fs.unlinkSync(sqlFile); } catch(ce) {}
                    setTimeout(() => { delete backupProgressMap[taskId]; }, 60000);
                    return; // STOP — don't create ZIP with missing database
                }
            }

            // Phase 2: ZIP Compression
            backupProgressMap[taskId] = { status: 'running', phase: 'compressing', progress: 30, message: t('backup_compressing', 'Compressing project files...') };

            const dt = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const ts = pad(dt.getDate()) + '-' + pad(dt.getMonth() + 1) + '-' + dt.getFullYear() + '_' + pad(dt.getHours()) + '-' + pad(dt.getMinutes());
            const zipName = projectName + '_' + ts + '.zip';
            const zipDest = path.join(config.BACKUP_DIR, zipName);

            const psSafeProject = projectPath.replace(/'/g, "''");
            const psSafeZip = zipDest.replace(/'/g, "''");
            const psScript = `$ProgressPreference='SilentlyContinue'; Compress-Archive -Path '${psSafeProject}\\*' -DestinationPath '${psSafeZip}' -Force`;
            const psBase64 = Buffer.from(psScript, 'utf16le').toString('base64');

            // Simulate progress during compression
            const progressTimer = setInterval(() => {
                const current = backupProgressMap[taskId];
                if (current && current.status === 'running' && current.progress < 90) {
                    backupProgressMap[taskId] = { ...current, progress: Math.min(current.progress + 5, 90) };
                }
            }, 3000);

            exec(`powershell -NoProfile -WindowStyle Hidden -EncodedCommand ${psBase64}`, { windowsHide: true, timeout: 600000 }, (err) => {
                clearInterval(progressTimer);

                // Clean up SQL file from project folder (it's already in the ZIP)
                try { if (sqlFile && fs.existsSync(sqlFile)) fs.unlinkSync(sqlFile); } catch(ce) {}

                if (err) {
                    backupProgressMap[taskId] = { status: 'error', phase: 'compressing', progress: 0, message: t('zip_err', 'Error creating ZIP backup.') + ' ' + (err.message || '').substring(0, 200) };
                } else {
                    backupProgressMap[taskId] = { status: 'done', phase: 'complete', progress: 100, message: t('project_archived_as', "Project archived as '{x}' in Backup folder.", { x: zipName }) };
                }
                setTimeout(() => { delete backupProgressMap[taskId]; }, 60000);
            });
        } catch(e) {
            try { if (sqlFile && fs.existsSync(sqlFile)) fs.unlinkSync(sqlFile); } catch(ce) {}
            backupProgressMap[taskId] = { status: 'error', phase: 'unknown', progress: 0, message: t('backup_general_err', 'Unexpected backup error: ') + (e.message || '').substring(0, 200) };
            setTimeout(() => { delete backupProgressMap[taskId]; }, 60000);
        }
    })();
});

app.get('/api/backup/status/:taskId', (req, res) => {
    const task = backupProgressMap[req.params.taskId];
    if (!task) return res.json({ status: 'not_found', progress: 0, message: '' });
    res.json(task);
});

app.post('/api/services/:name/:action', async (req, res) => {
    const { name, action } = req.params;
    
    if (initializingServices[name]) {
        return res.json({ success: false, message: t('service_initializing_err', 'Service is currently being initialized. Please wait a moment...') });
    }

    const exe = name === 'apache' ? 'httpd.exe' : 'mysqld.exe';
    
    if (action === 'stop' || action === 'restart') { 
        if (!isProcessRunning(exe)) {
            if (action === 'stop') return res.json({ success: false, message: t('service_already_stopped', 'Service is already stopped.') });
        } else {
            stopAllProcesses(exe); 
            // Wait for stop
            for(let i=0; i<20; i++) {
                if (!isProcessRunning(exe)) break;
                await new Promise(r => setTimeout(r, 200));
            }
        }
    }
    
    if (action === 'start' || action === 'restart') { 
        config.reload();

        const bin = name === 'apache' ? config.APACHE_BIN : config.MYSQL_BIN;
        if (!fs.existsSync(bin)) {
            return res.json({ success: false, message: t('service_not_installed', 'Service binary not found. Please check your settings.') });
        }

        initializeEnvironment(true); // Silent configuration
        startService(name);
        
        if (name === 'mysql' && initializingServices.mysql) {
            return res.json({ success: true, message: t('wait_setup', 'Setting up database, this might take a few minutes. Please wait...') });
        }
        
        // Wait for start
        let started = false;
        for(let i=0; i<30; i++) {
            if (isProcessRunning(exe)) {
                started = true;
                break;
            }
            await new Promise(r => setTimeout(r, 200));
        }
        
        if (!started) {
            return res.json({ success: false, message: t('service_start_err', 'Failed to start the service. Please check the logs.') });
        }

        // Additional 500ms for Apache (to start listening on port)
        if (name === 'apache') await new Promise(r => setTimeout(r, 500));
    }
    res.json({ success: true, message: action === 'stop' ? t('stopped', 'stopped') : t('active', 'Active') });
});

app.post('/api/services/start-all', async (req, res) => { 
    config.reload(); 
    initializeEnvironment(true); 

    const apacheAvailable = fs.existsSync(config.APACHE_BIN);
    const mysqlAvailable = fs.existsSync(config.MYSQL_BIN);

    if (!apacheAvailable && !mysqlAvailable) {
        return res.json({ success: false, message: t('no_services_found', 'No installed services found to start.') });
    }

    if (apacheAvailable) startService('apache'); 
    if (mysqlAvailable) startService('mysql'); 

    // If MySQL is initializing, we return a special message since it won't start immediately
    if (mysqlAvailable && initializingServices.mysql) {
        return res.json({ success: true, message: t('wait_setup', 'Setting up database, this might take a few minutes. Please wait...') });
    }

    // Wait for services to start
    let anyStarted = false;
    for(let i=0; i<30; i++) {
        const apacheRunning = apacheAvailable ? isProcessRunning('httpd.exe') : false;
        const mysqlRunning = mysqlAvailable ? isProcessRunning('mysqld.exe') : false;
        
        if (apacheAvailable && mysqlAvailable) {
            if (apacheRunning && mysqlRunning) { anyStarted = true; break; }
        } else if (apacheAvailable) {
            if (apacheRunning) { anyStarted = true; break; }
        } else if (mysqlAvailable) {
            if (mysqlRunning) { anyStarted = true; break; }
        }
        await new Promise(r => setTimeout(r, 200));
    }
    
    if (!anyStarted) {
        return res.json({ success: false, message: t('no_services_started_err', 'Failed to start any services. Please check the logs.') });
    }

    await new Promise(r => setTimeout(r, 500));
    res.json({ success: true, message: t('all_started', 'All services started') }); 
});

app.post('/api/services/stop-all', async (req, res) => { 
    const apacheRunning = isProcessRunning('httpd.exe');
    const mysqlRunning = isProcessRunning('mysqld.exe');

    if (initializingServices.mysql) {
        return res.json({ success: false, message: t('service_initializing_err', 'Service is currently being initialized. Please wait a moment...') });
    }

    if (!apacheRunning && !mysqlRunning) {
        return res.json({ success: false, message: t('no_services_running', 'No services are currently running.') });
    }

    if (apacheRunning) stopAllProcesses('httpd.exe'); 
    if (mysqlRunning) stopAllProcesses('mysqld.exe'); 

    // Wait for stop
    let allStopped = false;
    for(let i=0; i<20; i++) {
        if (!isProcessRunning('httpd.exe') && !isProcessRunning('mysqld.exe')) {
            allStopped = true;
            break;
        }
        await new Promise(r => setTimeout(r, 200));
    }

    if (!allStopped) {
        return res.json({ success: false, message: t('some_services_stop_err', 'Some services could not be stopped.') });
    }

    res.json({ success: true, message: t('all_stopped', 'All services stopped') }); 
});
app.post('/api/services/sync', (req, res) => { syncVhosts(); res.json({ success: true }); });
app.get('/api/projects', (req, res) => {
    const folders = fs.existsSync(config.WWW_DIR) 
        ? fs.readdirSync(config.WWW_DIR, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => ({ 
                name: d.name, 
                hostname: `${d.name}${config.VHOST_SUFFIX}`,
                path: path.join(config.WWW_DIR, d.name)
            })) 
        : [];
    res.json({ projects: folders });
});

// ─── GIT CLONE API ───

app.post('/api/clone', (req, res) => {
    const { url } = req.body;
    if (!url || !url.trim()) return res.json({ success: false, message: t('clone_url_empty_err', 'Clone URL cannot be empty.') });

    const cloneUrl = url.trim();
    
    // Extract repo name from URL (last part, excluding .git)
    let repoName = '';
    try {
        const parts = cloneUrl.replace(/\.git\s*$/, '').split('/');
        repoName = parts[parts.length - 1] || '';
        // SSH format (git@github.com:user/repo.git)
        if (repoName.includes(':')) {
            repoName = repoName.split(':').pop().split('/').pop();
        }
    } catch(e) {}

    if (!repoName) return res.json({ success: false, message: t('invalid_clone_repo_name', 'Invalid clone address. Could not extract repo name.') });

    const targetDir = path.join(config.WWW_DIR, repoName);

    // Already exists?
    if (fs.existsSync(targetDir)) {
        return res.json({ success: false, message: t('clone_folder_exists', 'Folder "{x}" already exists. Please delete it first or try a different repo.', { x: repoName }) });
    }

    // Check if Git is installed
    try {
        execSync('git --version', { stdio: 'ignore', windowsHide: true });
    } catch(e) {
        return res.json({ success: false, message: t('git_not_installed', 'Git is not installed! Please install Git from git-scm.com.') });
    }

    // Start cloning
    // process.stdout.write... removed

    exec(`git clone "${cloneUrl}" "${targetDir}"`, { timeout: 120000, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
            // process.stdout.write... removed
            // Clean up partial folder if failed
            try { if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true }); } catch(e) {}
            return res.json({ success: false, message: t('clone_failed', 'Clone failed: {x}', { x: stderr || err.message }) });
        }
        // process.stdout.write... removed
        // Note: VHost sync intentionally NOT called to prevent Apache restart after clone
        res.json({ success: true, message: t('clone_success', '"{x}" successfully cloned!', { x: repoName }), repoName });
    });
});

app.post('/api/projects/delete', (req, res) => {
    const { name } = req.body;
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
        return res.json({ success: false, message: t('invalid_project_name', 'Invalid project name.') });
    }
    const targetDir = path.join(config.WWW_DIR, name);
    if (!fs.existsSync(targetDir)) {
        return res.json({ success: false, message: t('project_not_found_err', 'Project folder not found.') });
    }
    try {
        // Delete folder completely
        fs.rmSync(targetDir, { recursive: true, force: true });
        
        // Cleans Vhost and SSL certificates along with C:\Windows\System32\drivers\etc\hosts records 
        syncVhosts();

        // Restarting Apache if it's running to apply new settings
        if (isProcessRunning('httpd.exe') && fs.existsSync(config.APACHE_BIN)) {
            stopAllProcesses('httpd.exe');
            setTimeout(() => startService('apache'), 1500);
        }

        res.json({ success: true, message: t('project_deleted', 'Project "{x}" and all virtual server settings have been deleted.', { x: name }) });
    } catch (e) {
        res.json({ success: false, message: t('project_delete_err_msg', 'Error deleting project: {x}', { x: e.message }) });
    }
});

app.post('/api/projects/open-folder', (req, res) => {
    const { name } = req.body;
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
        return res.json({ success: false, message: t('invalid_project_name', 'Invalid project name.') });
    }
    const targetDir = path.join(config.WWW_DIR, name);
    if (!fs.existsSync(targetDir)) {
        return res.json({ success: false, message: t('project_not_found', 'Project folder not found.') });
    }
    try {
        exec(`start "" "${targetDir}"`, { windowsHide: true });
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: t('folder_open_err_msg', 'Unable to open folder: {x}', { x: e.message }) });
    }
});

app.post('/api/projects/rename', (req, res) => {
    const { oldName, newName } = req.body;
    
    // Validate input
    if (!oldName || !newName) {
        return res.json({ success: false, message: t('invalid_project_name', 'Invalid project name.') });
    }
    
    if (newName.includes('/') || newName.includes('\\') || newName.includes('..')) {
        return res.json({ success: false, message: t('invalid_project_name', 'Invalid project name.') });
    }
    
    const oldDir = path.join(config.WWW_DIR, oldName);
    const newDir = path.join(config.WWW_DIR, newName);
    
    // Check if old folder exists
    if (!fs.existsSync(oldDir)) {
        return res.json({ success: false, message: t('project_not_found_err', 'Project folder not found.') });
    }
    
    // Check if new name already exists
    if (fs.existsSync(newDir)) {
        return res.json({ success: false, message: t('project_name_exists', 'A project with this name already exists.') });
    }
    
    try {
        // Rename the folder
        fs.renameSync(oldDir, newDir);
        
        // Sync vhosts to update Apache config
        syncVhosts();
        
        // Restart Apache if running to apply new settings
        if (isProcessRunning('httpd.exe') && fs.existsSync(config.APACHE_BIN)) {
            stopAllProcesses('httpd.exe');
            setTimeout(() => startService('apache'), 1500);
        }
        
        res.json({ success: true, message: t('project_renamed_msg', 'Project "{x}" has been renamed to "{y}".', { x: oldName, y: newName }) });
    } catch (e) {
        res.json({ success: false, message: t('project_rename_err_msg', 'Error renaming project: {x}', { x: e.message }) });
    }
});



app.post('/api/open-url', (req, res) => {
    const { url, browserMode, browserPath } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'URL required' });

    const mode = browserMode || config.BROWSER_MODE;
    const pathValue = browserPath || config.BROWSER_PATH;

    try {
        const resolveP = (p) => {
            if (!p || typeof p !== 'string') return p;
            return p.replace(/\{APP\}/g, config.BASE_DIR);
        };

        const finalUrl = resolveP(url);
        const finalPath = resolveP(pathValue);

        if (mode === 'path' && finalPath) {
            exec(`"${finalPath}" "${finalUrl}"`, { windowsHide: true });
        } else if (mode === 'electron') {
            if (process.send) process.send({ type: 'open-electron-window', url: finalUrl });
        } else {
            // Default system browser
            if (process.send) process.send({ type: 'open-system-browser', url: finalUrl });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ─── BACKUP MANAGEMENT API ───

app.get('/api/backups', (req, res) => {
    if (!fs.existsSync(config.BACKUP_DIR)) return res.json({ success: true, backups: [] });
    const files = fs.readdirSync(config.BACKUP_DIR)
        .filter(f => f.endsWith('.zip'))
        .map(f => {
            const stats = fs.statSync(path.join(config.BACKUP_DIR, f));
            return {
                filename: f,
                size: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
                date: stats.mtime.toLocaleString('en-US')
            };
        });
    res.json({ success: true, backups: files.reverse() });
});

app.delete('/api/backups/:filename', (req, res) => {
    const filePath = path.join(config.BACKUP_DIR, req.params.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return res.json({ success: true, message: t('backup_deleted', 'Backup file deleted.') });
    }
    res.status(404).json({ success: false, message: t('backup_not_found', 'Backup file not found.') });
});

app.post('/api/backups/restore', async (req, res) => {
    const { filename, targetPath, eraseTarget, restoreDb } = req.body;
    const backupPath = path.join(config.BACKUP_DIR, filename);
    
    if (!fs.existsSync(backupPath)) return res.json({ success: false, message: t('backup_not_found', 'Backup file not found.') });
    
    // Extract to a temporary folder
    const tempDir = path.join(config.BACKUP_DIR, 'temp_restore_' + Date.now());
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    try {
        // Extract from ZIP (PowerShell)
        execSync(`powershell -NoProfile -WindowStyle Hidden -Command "Expand-Archive -Path '${backupPath.replace(/'/g, "''")}' -DestinationPath '${tempDir.replace(/'/g, "''")}' -Force"`, { windowsHide: true });

        // Find SQL files
        const files = fs.readdirSync(tempDir);
        const sqlFiles = files.filter(f => f.endsWith('.sql'));

        let sqlMsg = '';
        if (restoreDb && sqlFiles.length > 0) {
            const wasMysqlRunning = isProcessRunning('mysqld.exe');
            if (!wasMysqlRunning) {
                config.reload();
                initializeEnvironment(true);
                startService('mysql');
                for(let i=0; i<30; i++) {
                    if (isProcessRunning('mysqld.exe')) break;
                    await new Promise(r => setTimeout(r, 200));
                }
                await new Promise(r => setTimeout(r, 1000));
            }

            if (isProcessRunning('mysqld.exe')) {
                const mysqlClient = path.join(path.dirname(config.MYSQL_BIN), 'mysql.exe');
                for (const sql of sqlFiles) {
                    const dbName = sql.replace('.sql', '');
                    const sqlPath = path.join(tempDir, sql);
                    
                    // If database exists, truncate tables and import (Drop/Create DB is cleanest)
                    const sqlSetup = `"${mysqlClient}" --no-defaults -uroot --port=${config.MYSQL_PORT} -e "DROP DATABASE IF EXISTS \`${dbName}\`; CREATE DATABASE \`${dbName}\`;" && "${mysqlClient}" --no-defaults -uroot --port=${config.MYSQL_PORT} "${dbName}" < "${sqlPath}"`;
                    try {
                        execSync(sqlSetup, { windowsHide: true });
                        sqlMsg += t('db_restored_msg', '[{x}] database restored. ', { x: dbName });
                    } catch (e) {
                        sqlMsg += t('db_restore_err_msg', '[{x}] SQL error: {y}. ', { x: dbName, y: e.message });
                    }
                }
            } else {
                sqlMsg += t('mysql_closed_err', 'MySQL is closed or an error occurred') + '. ';
            }

            if (!wasMysqlRunning) {
                stopAllProcesses('mysqld.exe');
                for(let i=0; i<20; i++) {
                    if (!isProcessRunning('mysqld.exe')) break;
                    await new Promise(r => setTimeout(r, 200));
                }
            }
        }

        // Determine target path (attach to WWW_DIR if not absolute)
        let finalPath = targetPath;
        if (!path.isAbsolute(targetPath)) {
            finalPath = path.join(config.WWW_DIR, targetPath);
        }

        // Clear target and move
        if (eraseTarget && fs.existsSync(finalPath)) {
            const oldFiles = fs.readdirSync(finalPath);
            for (const f of oldFiles) {
                const fp = path.join(finalPath, f);
                try {
                    if (fs.lstatSync(fp).isDirectory()) fs.rmSync(fp, { recursive: true, force: true });
                    else fs.unlinkSync(fp);
                } catch(e) {}
            }
        } else if (!fs.existsSync(finalPath)) {
            fs.mkdirSync(finalPath, { recursive: true });
        }

        // Move files
        const extractedFiles = fs.readdirSync(tempDir);
        for (const f of extractedFiles) {
            const src = path.join(tempDir, f);
            const dst = path.join(finalPath, f);
            // cp+rm in case of different partition (renameSync might fail)
            fs.cpSync(src, dst, { recursive: true });
        }

        // Clean up temp
        fs.rmSync(tempDir, { recursive: true, force: true });
        
        res.json({ success: true, message: sqlMsg + t('files_restored', 'Files successfully restored.') });
    } catch (e) {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        res.json({ success: false, message: t('error_msg', 'Error: ') + e.message });
    }
});

// ─── CRON SCHEDULED TASKS ───

const CRON_FILE = path.join(config.BASE_DIR, 'cron.json');

function loadCronJobs() {
    if (!fs.existsSync(CRON_FILE)) return [];
    try { return JSON.parse(fs.readFileSync(CRON_FILE, 'utf-8')); }
    catch (e) { return []; }
}

function saveCronJobs(jobs) {
    fs.writeFileSync(CRON_FILE, JSON.stringify(jobs, null, 4));
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Simple cron expression parser: "minute hour day month day_of_week"
function cronMatches(schedule, now) {
    const parts = schedule.trim().split(/\s+/);
    if (parts.length < 5) return false;

    const [minPart, hourPart, domPart, monthPart, dowPart] = parts;
    const minute = now.getMinutes();
    const hour = now.getHours();
    const day = now.getDate();
    const month = now.getMonth() + 1;
    const dow = now.getDay(); // 0=Sunday

    return fieldMatches(minPart, minute, 0, 59) &&
           fieldMatches(hourPart, hour, 0, 23) &&
           fieldMatches(domPart, day, 1, 31) &&
           fieldMatches(monthPart, month, 1, 12) &&
           fieldMatches(dowPart, dow, 0, 6);
}

function fieldMatches(field, value, min, max) {
    if (field === '*') return true;

    // Comma-separated lists: "1,5,10"
    const parts = field.split(',');
    for (const part of parts) {
        // Ranges: "1-5"
        if (part.includes('-')) {
            const [a, b] = part.split('-').map(Number);
            if (value >= a && value <= b) return true;
        }
        // Slash: "*/5"
        else if (part.includes('/')) {
            const [base, step] = part.split('/');
            const stepNum = parseInt(step, 10);
            const baseNum = base === '*' ? min : parseInt(base, 10);
            if (stepNum > 0 && (value - baseNum) % stepNum === 0 && value >= baseNum) return true;
        }
        // Constant value
        else {
            if (parseInt(part, 10) === value) return true;
        }
    }
    return false;
}

// Cron runner: Check every minute
let cronInterval = null;
function startCronRunner() {
    cronInterval = setInterval(() => {
        const now = new Date();
        const jobs = loadCronJobs();

        for (const job of jobs) {
            if (!job.enabled) continue;
            if (cronMatches(job.schedule, now)) {
                // Run command in background
                try {
                    const child = spawn(job.command, {
                        cwd: config.BASE_DIR,
                        stdio: 'ignore',
                        shell: true,
                        windowsHide: true
                    });
                    child.unref();
                } catch (e) {
                }
            }
        }
    }, 60000); // 60 seconds
}

// API Endpoints
app.get('/api/cron', (req, res) => {
    res.json({ success: true, jobs: loadCronJobs() });
});

app.post('/api/cron', (req, res) => {
    const { name, schedule, command, enabled } = req.body;
    if (!name || !schedule || !command) {
        return res.json({ success: false, message: t('cron_fields_required', 'Name, schedule and command fields are required.') });
    }

    const jobs = loadCronJobs();
    const newJob = {
        id: generateId(),
        name: name.trim(),
        schedule: schedule.trim(),
        command: command.trim(),
        enabled: enabled !== false,
        createdAt: new Date().toISOString()
    };
    jobs.push(newJob);
    saveCronJobs(jobs);

    res.json({ success: true, message: t('cron_added', 'Scheduled task added.'), job: newJob });
});

app.put('/api/cron/:id', (req, res) => {
    const { id } = req.params;
    const { name, schedule, command, enabled } = req.body;
    const jobs = loadCronJobs();
    const idx = jobs.findIndex(j => j.id === id);

    if (idx === -1) return res.json({ success: false, message: t('cron_not_found', 'Task not found.') });

    if (name !== undefined) jobs[idx].name = name.trim();
    if (schedule !== undefined) jobs[idx].schedule = schedule.trim();
    if (command !== undefined) jobs[idx].command = command.trim();
    if (enabled !== undefined) jobs[idx].enabled = !!enabled;

    saveCronJobs(jobs);
    res.json({ success: true, message: t('cron_updated', 'Task updated.') });
});

app.delete('/api/cron/:id', (req, res) => {
    const { id } = req.params;
    let jobs = loadCronJobs();
    const before = jobs.length;
    jobs = jobs.filter(j => j.id !== id);

    if (jobs.length === before) return res.json({ success: false, message: t('cron_not_found', 'Task not found.') });

    saveCronJobs(jobs);
    res.json({ success: true, message: t('cron_deleted', 'Task deleted.') });
});

// ─── QUICK ACCESS API ───

function loadQuickAccess() {
    if (!fs.existsSync(config.QUICK_ACCESS_FILE)) return [];
    try { return JSON.parse(fs.readFileSync(config.QUICK_ACCESS_FILE, 'utf-8')); } catch (e) { return []; }
}

function saveQuickAccess(items) {
    fs.writeFileSync(config.QUICK_ACCESS_FILE, JSON.stringify(items, null, 4));
}

app.get('/api/quick-access', (req, res) => {
    res.json({ success: true, items: loadQuickAccess() });
});

app.post('/api/quick-access', (req, res) => {
    const { title, url, icon, browserMode, browserPath } = req.body;
    if (!title || !url) {
        return res.json({ success: false, message: t('quick_access_fields_required', 'Title and URL are required.') });
    }

    const items = loadQuickAccess();
    const newItem = {
        id: generateId(),
        title: title.trim(),
        url: url.trim(),
        icon: (icon || 'external-link').trim(),
        browserMode: browserMode || 'system',
        browserPath: browserPath || ''
    };
    items.push(newItem);
    saveQuickAccess(items);
    res.json({ success: true, message: t('quick_access_added', 'Quick access item added.'), item: newItem });
});

app.put('/api/quick-access/:id', (req, res) => {
    const { id } = req.params;
    const { title, url, icon, browserMode, browserPath } = req.body;
    const items = loadQuickAccess();
    const idx = items.findIndex(i => i.id === id);

    if (idx === -1) return res.json({ success: false, message: t('quick_access_not_found', 'Item not found.') });

    if (title !== undefined) items[idx].title = title.trim();
    if (url !== undefined) items[idx].url = url.trim();
    if (icon !== undefined) items[idx].icon = icon.trim();
    if (browserMode !== undefined) items[idx].browserMode = browserMode;
    if (browserPath !== undefined) items[idx].browserPath = browserPath;

    saveQuickAccess(items);
    res.json({ success: true, message: t('quick_access_updated', 'Item updated.') });
});

app.delete('/api/quick-access/:id', (req, res) => {
    const { id } = req.params;
    let items = loadQuickAccess();
    const before = items.length;
    items = items.filter(i => i.id !== id);

    if (items.length === before) return res.json({ success: false, message: t('quick_access_not_found', 'Item not found.') });

    saveQuickAccess(items);
    res.json({ success: true, message: t('quick_access_deleted', 'Item deleted.') });
});

app.post('/api/quick-access/move', (req, res) => {
    const { id, direction } = req.body; // direction: 'up' or 'down'
    const items = loadQuickAccess();
    const index = items.findIndex(i => i.id === id);
    if (index === -1) return res.json({ success: false, message: t('quick_access_not_found', 'Item not found.') });

    if (direction === 'up' && index > 0) {
        [items[index], items[index - 1]] = [items[index - 1], items[index]];
    } else if (direction === 'down' && index < items.length - 1) {
        [items[index], items[index + 1]] = [items[index + 1], items[index]];
    }

    saveQuickAccess(items);
    res.json({ success: true });
});

if (require.main === module) {
    initializeEnvironment();
    syncVhosts();
    app.listen(config.APP_PORT, '0.0.0.0', () => {
        process.stdout.write(`\n  TouchAMP PANEL: http://localhost:${config.APP_PORT}\n\n`);
        
        // File watcher and polling disabled - manual sync only
        startCronRunner();
    });
}

