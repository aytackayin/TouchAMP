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
        // const foldersToCopy = ['bin', 'data', 'www', 'etc', 'backups', 'mysql_exports', 'lang'];
        const foldersToCopy = ['bin\\openssl', 'etc', 'www', 'backups', 'mysql_exports', 'lang'];
        const filesToCopy = ['quick_access.json']; // settings.json'u da garantileyelim

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
                            const excludedDirs = ['logs', 'temp', 'tmp'];

                            return !basename.startsWith('.git') &&
                                !excludedExts.includes(ext) &&
                                !excludedDirs.includes(basename) &&
                                !basename.includes('.log');
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
