const { packager } = require('@electron/packager');
const path = require('path');
const fs = require('fs');

async function build() {
    console.log('--- 🚀 Starting TouchAMP Portable Build ---');

    // Items that will NOT be included in ASAR (external)
    // These will be manually copied below.
    const ignoreList = [
        /^\/dist(\/.*)?$/,
        /^\/build(\/.*)?$/,
        /^\/data(\/.*)?$/,
        /^\/www(\/.*)?$/,
        /^\/backups(\/.*)?$/,
        /^\/mysql_exports(\/.*)?$/,
        /^\/bin(\/.*)?$/,
        /^\/etc(\/.*)?$/,
        /^\/lang(\/.*)?$/,
        // Do not include unnecessary source/config files in ASAR
        /^\/\.git(\/.*)?$/,
        /^\/\.gitignore$/,
        /^\/\.vscode(\/.*)?$/,
        /^\/README\.md$/,
        /^\/BENIOKU\.md$/,
        /^\/package-lock\.json$/,
        /^\/build-custom\.js$/,
        /^\/create-installer\.js$/,
        /^\/convert-icons\.js$/
    ];

    try {
        console.log('1. Packaging Application (Electron Packager)...');
        const appPaths = await packager({
            dir: __dirname,
            out: path.join(__dirname, 'dist'),
            name: 'TouchAMP',
            platform: 'win32',
            arch: 'x64',
            icon: path.join(__dirname, 'build', 'icon.ico'),
            overwrite: true,
            asar: true,
            ignore: ignoreList,
            win32metadata: {
                CompanyName: 'TouchAMP',
                FileDescription: 'TouchAMP Portable Server Environment',
                OriginalFilename: 'TouchAMP.exe',
                ProductName: 'TouchAMP',
                InternalName: 'TouchAMP'
            }
        });

        const appDir = appPaths[0];
        console.log(`   [OK] Packaging complete: ${appDir}`);

        console.log('2. Copying external resources (Portable Structure)...');
        // Only copy resources that are part of the application template (not user data).
        // User data folders (www, data, backups, mysql_exports, bin/versions, etc/apache2/sites-enabled)
        // and config files (settings.json, quick_access.json, cron.json) must NEVER end up in the
        // release ZIP, otherwise updates overwrite them on the host.
        const foldersToCopy = ['bin\\openssl', 'etc', 'lang'];
        const filesToCopy = [];

        // Subfolder filter: exclude any user-generated content that would otherwise
        // overwrite a host installation during the auto-update.
        const userExcludedDirs = new Set([
            'sites-enabled',  // etc/apache2/sites-enabled/ (auto-generated vhosts)
            'ssl',            // etc/ssl/ (auto-generated certs)
            'logs',
            'temp',
            'tmp',
            'node_modules',
            '.git',
            '.vscode',
            '.idea',
            'versions'        // bin/versions/ (user-installed PHP/Apache/MySQL)
        ]);

        foldersToCopy.forEach(folder => {
            const srcDir = path.join(__dirname, folder);
            const targetDir = path.join(appDir, folder);

            if (fs.existsSync(srcDir)) {
                try {
                    fs.cpSync(srcDir, targetDir, {
                        recursive: true,
                        force: true,
                        filter: (src) => {
                            const basename = path.basename(src).toLowerCase();
                            const ext = path.extname(src).toLowerCase();

                            // Debug dosyaları (.pdb, .lib vb.) ve log/temp klasörlerini filtrele
                            const excludedExts = ['.pdb', '.lib', '.obj', '.exp', '.ilk', '.bak', '.log', '.tmp'];
                            if (basename.startsWith('.git')) return false;
                            if (excludedExts.includes(ext)) return false;
                            if (basename.includes('.log')) return false;
                            // Exclude user data subfolders (absolute path under those excluded dirs)
                            const normalizedSrc = src.replace(/\\/g, '/');
                            for (const excluded of userExcludedDirs) {
                                if (normalizedSrc.includes('/' + excluded + '/') || normalizedSrc.endsWith('/' + excluded)) return false;
                            }
                            return true;
                        }
                    });
                    console.log(`   -> Folder ${folder} ready.`);
                } catch (err) {
                    console.error(`   [ERROR] Could not copy folder ${folder}:`, err.message);
                }
            } else {
                fs.mkdirSync(targetDir, { recursive: true });
                console.log(`   -> Folder ${folder} (empty) created.`);
            }
        });

        filesToCopy.forEach(file => {
            const srcFile = path.join(__dirname, file);
            const targetFile = path.join(appDir, file);
            if (fs.existsSync(srcFile)) {
                try {
                    fs.copyFileSync(srcFile, targetFile);
                    console.log(`   -> File ${file} added.`);
                } catch (err) {
                    console.error(`   [ERROR] Could not copy file ${file}:`, err.message);
                }
            }
        });

        console.log('\n--- ✨ TouchAMP Portable Version Successfully Created! ---');
        console.log(`Location: ${appDir}\n`);

    } catch (err) {
        console.error('\n[CRITICAL ERROR] A problem occurred during the build:', err);
        process.exit(1);
    }
}

build();
