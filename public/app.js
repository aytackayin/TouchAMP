// ══════════════════════════════════════════════════════════
// TouchAMP — Frontend Application
// ══════════════════════════════════════════════════════════

const API = '';
let pollInterval = null;
let currentSection = 'dashboard';

let currentLangData = {};
let availableLangs = [];
let isApacheRunning = false;
let currentHttpPort = 80;
let currentHttpsPort = 443;

let wasInitializing = { apache: false, mysql: false };

function getDynamicUrl(protocol, hostname, path = '') {
    const port = protocol === 'https' ? currentHttpsPort : currentHttpPort;
    const defaultPort = protocol === 'https' ? 443 : 80;
    const portStr = (port && parseInt(port) !== defaultPort) ? `:${port}` : '';
    return `${protocol}://${hostname}${portStr}${path}`;
}

// ─── SIDEBAR TOGGLE FOR MOBILE ───
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const body = document.body;
    
    if (sidebar && overlay) {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
        body.classList.toggle('sidebar-open');
    }
}

// Close sidebar when pressing escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar && sidebar.classList.contains('open')) {
            toggleSidebar();
        }
    }
});

// Handle window resize - close sidebar on resize to desktop
let resizeTimer;
window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
        if (window.innerWidth > 1024) {
            const sidebar = document.querySelector('.sidebar');
            const overlay = document.getElementById('sidebar-overlay');
            if (sidebar) sidebar.classList.remove('open');
            if (overlay) overlay.classList.remove('active');
            document.body.classList.remove('sidebar-open');
        }
    }, 250);
});

// Handle orientation change
window.addEventListener('orientationchange', function() {
    setTimeout(function() {
        if (window.innerWidth > 1024) {
            const sidebar = document.querySelector('.sidebar');
            const overlay = document.getElementById('sidebar-overlay');
            if (sidebar) sidebar.classList.remove('open');
            if (overlay) overlay.classList.remove('active');
            document.body.classList.remove('sidebar-open');
        }
    }, 100);
});

// ─── INITIALIZATION ───
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize lucide icons for the entire page (including mobile header)
    if (window.lucide) {
        lucide.createIcons();
    }
    
    // Load current section from storage or use dashboard as default
    const savedSection = sessionStorage.getItem('currentSection') || 'dashboard';
    const savedTab = sessionStorage.getItem('currentSettingsTab') || 'general';

    initNavigation();
    switchSection(savedSection, savedTab); // Use the saved state
    refreshStatus();
    loadProjects();
    loadQuickAccess().catch(() => {});
    startPolling();

    // Load language and settings in the background to avoid blocking initial flow
    loadLanguageList().catch(() => {});
    loadSettings().catch(() => {});

    // Make select boxes in static areas (like modals) custom if init function exists
    if (typeof initCustomSelect === 'function') {
        initCustomSelect('new-version-type');
    }

    // Settings Form Submit
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveSettings();
        });
    }

    // ─── CUSTOM CONTEXT MENU ───
    const contextMenuHtml = `
        <div id="touchamp-context-menu" class="custom-context-menu"></div>
    `;
    document.body.insertAdjacentHTML('beforeend', contextMenuHtml);
    const cm = document.getElementById('touchamp-context-menu');
    
    window.lastTargetInput = null;

    window.addEventListener('contextmenu', (e) => {
        e.preventDefault(); // Varsayılan tarayıcı / Electron sağ tık menüsünü engelle
        
        window.lastTargetInput = null;
        const isInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable;
        
        cm.innerHTML = '';
        
        if (isInput) {
            window.lastTargetInput = e.target;
            
            cm.innerHTML = `
                <div class="context-menu-item" onmousedown="event.preventDefault(); window.handleMenuAction('cut')">
                    <i data-lucide="scissors" style="width:14px;height:14px;opacity:0.8;"></i> <span>${currentLangData.cut || 'Kes'}</span>
                </div>
                <div class="context-menu-item" onmousedown="event.preventDefault(); window.handleMenuAction('copy')">
                    <i data-lucide="copy" style="width:14px;height:14px;opacity:0.8;"></i> <span>${currentLangData.copy || 'Kopyala'}</span>
                </div>
                <div class="context-menu-item" onmousedown="event.preventDefault(); window.handleMenuPaste(event)">
                    <i data-lucide="clipboard-paste" style="width:14px;height:14px;opacity:0.8;"></i> <span>${currentLangData.paste || 'Yapıştır'}</span>
                </div>
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" onmousedown="event.preventDefault(); window.handleMenuAction('select_all')">
                    <i data-lucide="scan-line" style="width:14px;height:14px;opacity:0.8;"></i> <span>${currentLangData.select_all || 'Tümünü Seç'}</span>
                </div>
            `;
        } else {
            cm.innerHTML = `
                <div class="context-menu-item" onmousedown="event.preventDefault(); location.reload()">
                    <i data-lucide="refresh-cw" style="width:14px;height:14px;opacity:0.8;"></i> <span>${currentLangData.refresh || 'Yenile'}</span>
                </div>
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" onmousedown="event.preventDefault(); switchSection('dashboard')">
                    <i data-lucide="layout-dashboard" style="width:14px;height:14px;opacity:0.8;"></i> <span>${currentLangData.nav_dashboard || 'Dashboard'}</span>
                </div>
                <div class="context-menu-item" onmousedown="event.preventDefault(); switchSection('settings')">
                    <i data-lucide="settings" style="width:14px;height:14px;opacity:0.8;"></i> <span>${currentLangData.nav_settings || 'Settings'}</span>
                </div>
            `;
        }
        
        if (window.lucide) lucide.createIcons({ root: cm });
        
        cm.classList.add('show');
        
        let x = e.clientX;
        let y = e.clientY;
        const rect = cm.getBoundingClientRect();
        if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 5;
        if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 5;
        
        cm.style.left = x + 'px';
        cm.style.top = y + 'px';
    });

    window.addEventListener('click', (e) => {
        if (cm.classList.contains('show')) cm.classList.remove('show');
    });
    
    window.addEventListener('scroll', () => {
        cm.classList.remove('show');
    }, { capture: true });
    
    window.handleMenuAction = function(action) {
        if (!window.lastTargetInput) return;
        
        // Focus kaybını onmousedown ile engelledik ancak emin olmak için focusluyoruz
        window.lastTargetInput.focus();
        
        if (action === 'select_all') {
            window.lastTargetInput.select();
        } else if (action === 'cut') {
            document.execCommand('cut');
        } else if (action === 'copy') {
            document.execCommand('copy');
        }
        
        cm.classList.remove('show');
    };
    
    window.handleMenuPaste = async function(e) {
        if (!window.lastTargetInput) return;
        window.lastTargetInput.focus();
        try {
            const text = await navigator.clipboard.readText();
            const start = window.lastTargetInput.selectionStart ?? 0;
            const end = window.lastTargetInput.selectionEnd ?? 0;
            window.lastTargetInput.setRangeText(text, start, end, 'end');
            window.lastTargetInput.dispatchEvent(new Event('input', { bubbles: true }));
        } catch(err) {
            document.execCommand('paste');
        }
        cm.classList.remove('show');
    };
});

// ─── LANGUAGE ENGINE ───
async function loadLanguageList() {
    const data = await apiCall('/api/languages');
    if (data && data.success) {
        availableLangs = data.languages || [];
        const select = document.getElementById('setting-language');
        if (select) {
            select.innerHTML = availableLangs.map(l => `<option value="${l.code}">${l.name}</option>`).join('');
        }
    }
}

async function loadLanguage(langCode) {
    try {
        const res = await fetch(`/lang/${langCode}.json`);
        if (!res.ok) return;
        currentLangData = await res.json();
        applyTranslations();
        // Show body after FOUC (Flash of Unstyled Content) prevention
        document.body.classList.add('i18n-ready');
    } catch (e) {
        document.body.classList.add('i18n-ready'); // Show even if error occurs
    }
}

function t(key, def = '') { return currentLangData[key] || def; }
window.t = t;
function applyTranslations() {
    if (!currentLangData) return;
    document.querySelectorAll('[data-i18n], [data-i18n-attr]').forEach(el => {
        const key = el.getAttribute('data-i18n');

        const attrKey = el.getAttribute('data-i18n-attr');
        if (attrKey) {
            const [attr, k] = attrKey.split('|');
            if (currentLangData[k]) el.setAttribute(attr, currentLangData[k]);
        }

        if (key && currentLangData[key]) {
            if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'password')) {
                el.placeholder = currentLangData[key];
            } else {
                el.innerHTML = currentLangData[key];
            }
        }
    });
}


// ─── NAVIGATION ───

function initNavigation() {
    document.querySelectorAll('.nav-item[data-section]').forEach(item => {
        item.addEventListener('click', () => {
            const section = item.dataset.section;
            switchSection(section);
            // Close sidebar on mobile after navigation
            if (window.innerWidth <= 1024) {
                const sidebar = document.querySelector('.sidebar');
                if (sidebar && sidebar.classList.contains('open')) {
                    toggleSidebar();
                }
            }
        });
    });
}

function switchSection(section, initialTab = null) {
    currentSection = section;
    sessionStorage.setItem('currentSection', section); // Save to session storage

    // Update nav
    document.querySelectorAll('.nav-item[data-section]').forEach(el => {
        el.classList.toggle('active', el.dataset.section === section);
    });

    // Update sections
    document.querySelectorAll('.section').forEach(el => {
        el.classList.toggle('active', el.id === `section-${section}`);
    });

    if (section === 'settings') {
        const tabToOpen = initialTab || sessionStorage.getItem('currentSettingsTab') || 'general';
        loadSettings();
        switchSettingsTab(tabToOpen);
    }
    if (section === 'projects') loadProjects();
    if (section === 'backups') loadBackups();
    if (section === 'database') loadDatabaseList();
}

function switchSettingsTab(tab) {
    sessionStorage.setItem('currentSettingsTab', tab); // Save settings tab to session storage
    document.querySelectorAll('.settings-tab').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tab);
    });
    document.querySelectorAll('.settings-tab-content').forEach(el => {
        el.classList.toggle('active', el.id === `settings-tab-${tab}`);
    });
    if (tab === 'cron') loadCronJobs();
    if (tab === 'quick-access') loadQuickAccess();
}

// ─── API CALLS ───

function showLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.classList.add('active');
}

function hideLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.classList.remove('active');
}

let isServerDown = false;

function toggleConnectionOverlay(show) {
    const overlay = document.getElementById('connection-error-overlay');
    if (!overlay) return;
    
    if (show) {
        if (isServerDown) return;
        overlay.classList.add('active');
        isServerDown = true;
        pollReconnection();
    } else {
        if (!isServerDown) return;
        overlay.classList.remove('active');
        isServerDown = false;
        refreshStatus();
    }
}

function pollReconnection() {
    if (!isServerDown) return;
    fetch(`${API}/api/status`)
        .then(res => {
            if (res.ok) toggleConnectionOverlay(false);
            else setTimeout(pollReconnection, 2000);
        })
        .catch(() => setTimeout(pollReconnection, 2000));
}

async function apiCall(url, options = {}, showLoading = false, timeoutMs = 30000) {
    if (showLoading) showLoader();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        
        const res = await fetch(`${API}${url}`, {
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            ...options
        });
        clearTimeout(timeoutId);
        
        const data = await res.json();
        if (showLoading) hideLoader();
        if (isServerDown) toggleConnectionOverlay(false);
        return data;
    } catch (err) {
        if (showLoading) hideLoader();
        
        // Server is down or unreachable
        if (err.name === 'AbortError') {
            // If it's a timeout, don't immediately show the "Server Disconnected" screen.
            // Just show a toast message. Show disconnect screen only for real network errors.
            if (!options.silent) {
                showToast(`${t("conn_timeout", "Connection timed out")}: ${t("operation_taking_too_long", "The operation is taking longer than expected.")}`, 'error');
            }
        } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
            toggleConnectionOverlay(true);
        } else {
            if (!options.silent) {
                showToast(`${t("conn_err", "Connection error")}: ${err.message}`, 'error');
            }
        }
        return null;
    }
}

// ─── SERVICE STATUS ───

async function refreshStatus() {
    const data = await apiCall('/api/status', { silent: true });
    if (!data) return;

    updateServiceCard('apache', data.services.apache);
    updateServiceCard('mysql', data.services.mysql);
    
    // Detection for initialization complete
    ['apache', 'mysql'].forEach(svc => {
        if (data.services[svc] && wasInitializing[svc] && !data.services[svc].initializing) {
            // Setup just finished
            if (data.services[svc].running) {
                showToast(t('setup_finished', 'Service setup finished and started successfully!'), 'success');
            } else {
                showToast(t('setup_finished_error', 'Service setup finished, but service failed to start. Check logs.'), 'error');
            }
        }
        if (data.services[svc]) wasInitializing[svc] = !!data.services[svc].initializing;
    });
    
    isApacheRunning = data.services.apache && data.services.apache.running;

    // Update Quick Access Links Visibility
    const qaSection = document.getElementById('quick-access-section');
    const qlLocalhost = document.getElementById('quick-link-localhost');
    const qlPhpMyAdmin = document.getElementById('quick-link-phpmyadmin');

    if (qaSection && qlLocalhost && qlPhpMyAdmin) {
        const isApacheRunning = data.services.apache && data.services.apache.running;
        const isMysqlRunning = data.services.mysql && data.services.mysql.running;
        
        // Update ports for link generation
        currentHttpPort = data.services.apache.port || 80;
        currentHttpsPort = data.services.apache.httpsPort || 443;

        // Requirement 2: Apache on -> Localhost visible
        qlLocalhost.style.display = isApacheRunning ? 'flex' : 'none';
        // Requirement 4: MySQL and Apache on -> phpMyAdmin visible
        qlPhpMyAdmin.style.display = (isApacheRunning && isMysqlRunning) ? 'flex' : 'none';

        // Update URLs with proper ports
        const localhostUrl = getDynamicUrl('http', 'localhost');
        const pmaUrl = getDynamicUrl('http', 'localhost', '/phpmyadmin');
        qlLocalhost.setAttribute('onclick', `openUrlInBrowser('${localhostUrl}')`);
        qlPhpMyAdmin.setAttribute('onclick', `openUrlInBrowser('${pmaUrl}')`);

        // Custom items are managed via loadQuickAccess and are always added to the DOM.
        // We show the section if we have custom links OR if at least one service link is visible.
        const customItems = document.getElementById('quick-access-custom-items');
        const hasCustomItems = customItems && customItems.children.length > 0;
        
        if (isApacheRunning || hasCustomItems) {
            qaSection.style.display = 'block';
        } else {
            qaSection.style.display = 'none';
        }
    }

    // Update WWW dir display
    const wwwDirDisplay = document.getElementById('www-dir-display');
    if (wwwDirDisplay) {
        wwwDirDisplay.textContent = data.paths.wwwDir;
    }
}

function updateServiceCard(name, service) {
    const card = document.getElementById(`service-${name}`);
    if (!card) return;

    const isRunning = !!service.running;
    const isInitializing = !!service.initializing;
    card.classList.toggle('running', isRunning);
    card.classList.toggle('initializing', isInitializing);

    // Status badge
    const badge = card.querySelector('.status-badge');
    badge.className = `status-badge ${isRunning ? 'running' : (isInitializing ? 'starting' : 'stopped')}`;
    badge.innerHTML = `
        <span class="status-dot"></span>
        ${isRunning ? t('running', 'Running') : (isInitializing ? t('initializing', 'Initializing...') : t('stopped_status', 'Stopped'))}
    `;

    // Version info
    if (name === 'apache') {
        const apacheVer = document.getElementById('apache-version-display');
        const phpVer = document.getElementById('php-version-display');
        if (apacheVer) apacheVer.textContent = service.version ? `httpd ${service.version}` : t('not_installed', 'Not installed');
        if (phpVer) phpVer.textContent = service.phpVersion ? `PHP ${service.phpVersion}` : t('php_not_selected', 'Not selected');
    } else if (name === 'mysql') {
        const mysqlVer = document.getElementById('mysql-version-display');
        if (mysqlVer) mysqlVer.textContent = service.version ? `mysql ${service.version}` : t('not_installed', 'Not installed');
    }

    // Port info
    const portEl = card.querySelector('.port-value');
    if (portEl) portEl.textContent = service.port;

    const httpsPortEl = card.querySelector('.port-value-https');
    if (httpsPortEl) httpsPortEl.textContent = service.httpsPort;

    // Buttons
    const startBtn = card.querySelector('.btn-start');
    const stopBtn = card.querySelector('.btn-stop');
    const restartBtn = card.querySelector('.btn-restart');

    const hasVersion = !!service.version;

    if (startBtn && !startBtn.hasAttribute('data-loading')) startBtn.disabled = isRunning || isInitializing || !hasVersion;
    if (stopBtn && !stopBtn.hasAttribute('data-loading')) stopBtn.disabled = !isRunning || isInitializing;
    if (restartBtn && !restartBtn.hasAttribute('data-loading')) restartBtn.disabled = !isRunning || isInitializing || !hasVersion;

    // Update footer indicators
    const footerIndicator = document.getElementById(`footer-${name}-status`);
    if (footerIndicator) {
        footerIndicator.classList.toggle('active', isRunning);
        footerIndicator.classList.toggle('inactive', !isRunning);
    }
}

function startPolling() {
    pollInterval = setInterval(() => {
        refreshStatus();
        if (currentSection === 'projects') loadProjects();
        if (currentSection === 'backups') loadBackups();
        if (currentSection === 'database') loadDatabaseList();
    }, 4000);
}

// ─── SERVICE CONTROLS ───

async function startService(name, btn) {
    if (!btn) btn = event.target.closest('.btn');
    setLoadingBtn(btn, true);

    const data = await apiCall(`/api/services/${name}/start`, { method: 'POST' });

    setLoadingBtn(btn, false);

    if (data && data.success) {
        showToast(data.message || `${name} ${t("starting", "is starting")}`, 'success');
        refreshStatus();
    } else if (data) {
        showToast(data.message, 'error');
    }
}

async function stopService(name, btn) {
    if (!btn) btn = event.target.closest('.btn');
    setLoadingBtn(btn, true);

    const data = await apiCall(`/api/services/${name}/stop`, { method: 'POST' });

    setLoadingBtn(btn, false);

    if (data && data.success) {
        showToast(data.message || `${name} ${t("stopped", "stopped")}`, 'success');
        refreshStatus();
    } else if (data) {
        showToast(data.message, 'error');
    }
}

async function restartService(name, btn) {
    if (!btn) btn = event.target.closest('.btn');
    setLoadingBtn(btn, true);

    const data = await apiCall(`/api/services/${name}/restart`, { method: 'POST' });

    setLoadingBtn(btn, false);

    if (data && data.success) {
        showToast(data.message || `${name} ${t("restarting", "is restarting")}`, 'success');
        refreshStatus();
    } else if (data) {
        showToast(data.message, 'error');
    }
}

async function startAll(btn) {
    if (!btn) btn = event.target.closest('.quick-action-btn');
    setLoadingBtn(btn, true);

    const data = await apiCall('/api/services/start-all', { method: 'POST' });

    setLoadingBtn(btn, false);

    if (data && data.success) {
        showToast(data.message || t('all_started', 'All services started'), 'success');
        refreshStatus();
    } else if (data) {
        showToast(data.message, 'error');
    }
}

async function stopAll(btn) {
    if (!btn) btn = event.target.closest('.quick-action-btn');
    setLoadingBtn(btn, true);

    const data = await apiCall('/api/services/stop-all', { method: 'POST' });

    setLoadingBtn(btn, false);

    if (data && data.success) {
        showToast(data.message || t('all_stopped', 'All services stopped'), 'success');
        refreshStatus();
    } else if (data) {
        showToast(data.message, 'error');
    }
}

// ─── PROJECTS & VHOSTS ───

async function loadProjects() {
    const data = await apiCall('/api/projects');
    if (!data) return;

    const grid = document.getElementById('projects-grid');
    if (data.projects.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1">
                <div class="empty-state-icon"><i data-lucide="folder-search" style="width: 48px; height: 48px;"></i></div>
                <div class="empty-state-title" data-i18n="no_proj_title">No projects found</div>
                <div class="empty-state-text" data-i18n="no_proj_desc">Add a folder to the www directory. Virtual server and SSL will be created automatically.</div>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        applyTranslations();
        return;
    }

    grid.innerHTML = data.projects.map(proj => `
        <div class="vhost-item">
            <div class="vhost-info" style="flex: 1;">
                <div>
                    <div class="vhost-name"><i data-lucide="folder" style="width: 17px; height: 17px; position:relative; bottom: -2px; margin-right: 5px; color: var(--accent-amber);"></i> ${proj.name}</div>
                    <div class="vhost-path" style="opacity: 0.6;">${proj.hostname}</div>
                </div>
            </div>
            
            <div class="vhost-actions">
                <button type="button" class="btn btn-secondary btn-sm" title="${t('open_folder', 'Open Folder')}" data-i18n-attr="title|open_folder" style="border-color: rgba(59, 130, 246, 0.3); color: var(--accent-blue-light); padding: 6px 10px;" onclick="openProjectFolder('${proj.name}')">
                    <i data-lucide="folder-open" style="width: 14px; height: 14px;"></i>
                </button>
                <button type="button" class="btn btn-secondary btn-sm" title="${t('rename_proj', 'Rename Project')}" data-i18n-attr="title|rename_proj" style="border-color: rgba(139, 92, 246, 0.3); color: var(--accent-emerald); padding: 6px 10px;" onclick="openRenameModal('${proj.name}')">
                    <i data-lucide="text-cursor-input" style="width: 14px; height: 14px;"></i>
                </button>
                <button type="button" class="btn btn-secondary btn-sm" title="${t('open_http', 'Open HTTP Site')}" data-i18n-attr="title|open_http" style="padding: 6px 10px; display: ${isApacheRunning ? 'inline-flex' : 'none'};" onclick="openProjectUrl('${getDynamicUrl('http', proj.hostname)}')">
                    <i data-lucide="external-link" style="width: 14px; height: 14px;"></i>
                </button>
                <button type="button" class="btn btn-secondary btn-sm" title="${t('open_https', 'Open HTTPS (SSL) Site')}" data-i18n-attr="title|open_https" style="border-color: rgba(16, 185, 129, 0.3); color: var(--accent-emerald); padding: 6px 10px; display: ${isApacheRunning ? 'inline-flex' : 'none'};" onclick="openProjectUrl('${getDynamicUrl('https', proj.hostname)}')">
                    <i data-lucide="lock" style="width: 14px; height: 14px;"></i>
                </button>
                <button type="button" class="btn btn-secondary btn-sm" title="${t('backup_proj', 'Backup Project')}" data-i18n-attr="title|backup_proj" style="border-color: rgba(245, 158, 11, 0.3); color: var(--accent-amber); padding: 6px 10px;" onclick="openBackupModal('${proj.name}', '${proj.path.replace(/\\/g, '\\\\')}')">
                    <i data-lucide="package" style="width: 14px; height: 14px;"></i>
                </button>
                <button type="button" class="btn btn-secondary btn-sm" title="${t('del_proj', 'Delete Project')}" data-i18n-attr="title|del_proj" style="border-color: rgba(239, 68, 68, 0.3); color: var(--accent-rose); padding: 6px 10px;" onclick="confirmDeleteProject('${proj.name}', this)">
                    <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                </button>
            </div>
        </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
    applyTranslations();
}

async function syncNow() {
    const btn = event.target.closest('.btn');
    setLoadingBtn(btn, true);

    const data = await apiCall('/api/services/sync', { method: 'POST' });

    setLoadingBtn(btn, false);

    if (data && data.success) {
        showToast(data.message || t('sync_done', 'Synchronization complete'), 'success');
        loadProjects();
    } else if (data) {
        showToast(data.message, 'error');
    }
}

// ─── SETTINGS ───

// ─── SETTINGS ───

function openVersionModal() {
    document.getElementById('modal-version').classList.add('active');
    initCustomSelect('new-version-type');
}

function closeVersionModal() {
    document.getElementById('modal-version').classList.remove('active');
    
    // Cleanup process
    const versionNumberInput = document.getElementById('new-version-number');
    const versionFileInput = document.getElementById('new-version-file');
    const installFileName = document.getElementById('install-file-name');
    const installFileBtn = document.getElementById('install-file-btn');
    const wrap = document.getElementById('install-progress-wrap');
    const btnInstall = document.getElementById('btn-install-local');

    if (versionNumberInput) versionNumberInput.value = '';
    if (versionFileInput) versionFileInput.value = '';
    
    if (installFileName) {
        installFileName.setAttribute('data-i18n', 'select_file');
        installFileName.innerText = window.t ? window.t('select_file', 'Select File') : 'Select File';
    }
    
    if (installFileBtn) {
        installFileBtn.removeAttribute('title');
        installFileBtn.removeAttribute('data-tooltip');
    }
    if (wrap) wrap.style.display = 'none';
    
    if (btnInstall) {
        setLoadingBtn(btnInstall, false);
        btnInstall.innerHTML = window.t ? window.t('install', 'Install / Upload') : 'Install / Upload';
    }
}

async function installLocalVersion() {
    const type = document.getElementById('new-version-type').value;
    const version = document.getElementById('new-version-number').value.trim();
    const fileInput = document.getElementById('new-version-file');

    if (!version || !fileInput.files.length) {
        showToast(t('fill_fields', 'Please fill all fields and select a file.'), 'error');
        return;
    }

    const file = fileInput.files[0];
    if (!file.name.toLowerCase().endsWith('.zip')) {
        showToast(t('only_zip', 'Only ZIP files are supported.'), 'error');
        return;
    }

    const isApache = type.toLowerCase() === 'apache';
    const fileNameLower = file.name.toLowerCase();
    const typeLower = type.toLowerCase();

    if (!fileNameLower.includes(typeLower) && !(isApache && fileNameLower.includes('httpd'))) {
        showToast(t('invalid_file_type', `Selected filename must contain the word '{x}'!`).replace('{x}', type), 'error');
        return;
    }

    const btn = document.getElementById('btn-install-local');
    const originalText = btn.innerHTML;
    const wrap = document.getElementById('install-progress-wrap');
    const fill = document.getElementById('install-progress-fill');
    const text = document.getElementById('install-progress-text');

    setLoadingBtn(btn, true);
    wrap.style.display = 'block';
    fill.style.width = '0%';
    text.innerHTML = t('uploading', 'Uploading... (0%)');

    try {
        const res = await fetch(`${API}/api/versions/install-local/${type}/${version}`, {
            method: 'POST',
            body: file,
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': file.size.toString()
            }
        });
        const data = await res.json();

        if (data && data.success && data.dlKey) {
            showToast(data.message, 'info');
            
            const interval = setInterval(async () => {
                const st = await apiCall(`/api/versions/download-status/${data.dlKey}`);
                if (st && st.success) {
                    if (st.status === 'downloading') {
                        fill.style.width = st.progress + '%';
                        text.innerHTML = st.message;
                    } else if (st.status === 'extracting') {
                        fill.style.width = '100%';
                        fill.classList.add('indeterminate'); // if you have an indeterminate animation style
                        text.innerHTML = st.message || t('extracting', 'Extracting...');
                    }

                    if (st.status === 'done' || st.status === 'error') {
                        clearInterval(interval);
                        setLoadingBtn(btn, false);
                        btn.innerHTML = originalText;
                        wrap.style.display = 'none';
                        fill.classList.remove('indeterminate');
                        showToast(st.message, st.status === 'done' ? 'success' : 'error');
                        if (st.status === 'done') {
                            closeVersionModal();
                            loadSettings();
                        }
                    }
                } else {
                    clearInterval(interval);
                    setLoadingBtn(btn, false);
                    btn.innerHTML = originalText;
                    wrap.style.display = 'none';
                }
            }, 1000);
        } else {
            setLoadingBtn(btn, false);
            btn.innerHTML = originalText;
            wrap.style.display = 'none';
            if (data && data.message) showToast(data.message, data.success ? 'success' : 'error');
        }
    } catch (err) {
        setLoadingBtn(btn, false);
        btn.innerHTML = originalText;
        wrap.style.display = 'none';
        showToast(`${t("conn_err", "Connection error")}: ${err.message}`, 'error');
    }
}

async function loadSettings() {
    const data = await apiCall('/api/settings');
    const versionData = await apiCall('/api/versions');
    if (!data || !versionData) return;

    document.getElementById('setting-wwwDir').value = data.wwwDir || '';
    document.getElementById('setting-dataDir').value = data.dataDir || '';
    document.getElementById('setting-backupDir').value = data.backupDir || '';
    document.getElementById('setting-vhostSuffix').value = data.vhostSuffix;
    document.getElementById('setting-httpPort').value = data.ports.http;
    document.getElementById('setting-httpsPort').value = data.ports.https;
    document.getElementById('setting-mysqlPort').value = data.ports.mysql;
    document.getElementById('setting-appPort').value = data.ports.app;

    // New Fields
    document.getElementById('setting-startOnWindows').checked = !!data.startOnWindows;
    document.getElementById('setting-startMinimized').checked = !!data.startMinimized;
    document.getElementById('setting-autoStartServices').checked = !!data.autoStartServices;

    // Browser Settings
    const browserModeSelect = document.getElementById('setting-browserMode');
    if (browserModeSelect) {
        browserModeSelect.value = data.browserMode || 'system';
        document.getElementById('setting-browserPath').value = data.browserPath || '';
        toggleBrowserPath();
    }

    // Load app language
    const langCode = data.language || 'en';
    const langSelect = document.getElementById('setting-language');
    if (langSelect) {
        // Ensure language list is populated before setting value
        if (langSelect.options.length === 0) {
            await loadLanguageList();
        }
        langSelect.value = langCode;
    }
    loadLanguage(langCode);

    // Populate Versions
    fillVersionSelect('apache', versionData, data.apacheVersion);
    fillVersionSelect('php', versionData, data.phpVersion);
    fillVersionSelect('mysql', versionData, data.mysqlVersion);

    // Toggle panels based on initial selection
    togglePhpPanels();
}

/**
 * Toggles visibility of PHP Extensions and PHP Settings panels
 * based on whether a PHP version is selected.
 */
function togglePhpPanels() {
    const phpVersion = document.getElementById('setting-phpVersion').value;
    const extPanel = document.getElementById('php-extensions-panel');
    const settingsPanel = document.getElementById('php-settings-panel');
    
    if (extPanel) extPanel.style.display = phpVersion ? 'block' : 'none';
    if (settingsPanel) settingsPanel.style.display = phpVersion ? 'block' : 'none';
}

function fillVersionSelect(type, data, current) {
    const select = document.getElementById(`setting-${type}Version`);
    const installed = data.installed[type] || [];
    
    // Only show installed versions
    const all = Array.from(new Set([...installed])).sort().reverse();

    // Default option to disable service selection
    let html = `<option value="">-- ${t('php_not_selected', 'Not selected')} --</option>`;
    
    if (all.length > 0) {
        html += all.map(v => `<option value="${v}" ${v === current ? 'selected' : ''}>${v}</option>`).join('');
    }

    select.innerHTML = html;

    // Re-initialize Custom Select component
    initCustomSelect(`setting-${type}Version`);
}



async function saveSettings() {
    const settings = {
        wwwDir: document.getElementById('setting-wwwDir').value,
        dataDir: document.getElementById('setting-dataDir').value,
        backupDir: document.getElementById('setting-backupDir').value,
        vhostSuffix: document.getElementById('setting-vhostSuffix').value,
        phpVersion: document.getElementById('setting-phpVersion').value,
        apacheVersion: document.getElementById('setting-apacheVersion').value,
        mysqlVersion: document.getElementById('setting-mysqlVersion').value,
        ports: {
            http: document.getElementById('setting-httpPort').value,
            https: document.getElementById('setting-httpsPort').value,
            mysql: document.getElementById('setting-mysqlPort').value,
            app: document.getElementById('setting-appPort').value
        },
        startOnWindows: document.getElementById('setting-startOnWindows').checked,
        startMinimized: document.getElementById('setting-startMinimized').checked,
        autoStartServices: document.getElementById('setting-autoStartServices').checked,
        language: document.getElementById('setting-language').value,
        browserMode: document.getElementById('setting-browserMode').value,
        browserPath: document.getElementById('setting-browserPath').value
    };

    const data = await apiCall('/api/settings', {
        method: 'POST',
        body: JSON.stringify(settings)
    });

    if (data && data.success) {
        showToast(data.message, 'success');

        if (data.restart) {
            // Application port changed, wait and redirect
            const newPort = data.newPort || settings.ports.app;
            setTimeout(() => {
                const newUrl = window.location.protocol + '//' + window.location.hostname + ':' + newPort;
                window.location.href = newUrl;
            }, 3000);
            return;
        }

        // Immediately load new language to UI if changed
        loadLanguage(settings.language);
    } else if (data) {
        showToast(data.message || t('settings_save_err', 'Error saving settings'), 'error');
    }
}

// ─── LOGS MANAGEMENT ───

async function viewLogs(type) {
    const btn = event.target.closest('.btn');
    const select = document.getElementById(`setting-${type}Version`);
    const version = select.value;
    if (!version) return showToast(t('select_version_first', 'Please select a version first.'), 'error');

    setLoadingBtn(btn, true);

    const data = await apiCall(`/api/logs/${type}/${version}`);

    setLoadingBtn(btn, false);

    if (data && data.success) {
        document.getElementById('log-modal-title').innerText = t('log_title', '{x} - Log Records').replace('{x}', `${type.toUpperCase()} ${version}`);
        const viewer = document.getElementById('log-viewer-content');

        if (data.logs.includes('\n') && !data.logs.startsWith('--- ')) {
            const lines = data.logs.split('\n');
            const maxDigits = String(lines.length).length > 2 ? String(lines.length).length : 3;
            viewer.value = lines.map((line, idx) => {
                if (line.trim() === '') return line; // Skip empty lines or keep empty
                const num = String(idx + 1).padStart(maxDigits, '0');
                return `${num} | ${line}`;
            }).join('\n');
        } else {
            viewer.value = data.logs;
        }

        document.getElementById('modal-log').classList.add('active');
        // Scroll to bottom
        setTimeout(() => { viewer.scrollTop = viewer.scrollHeight; }, 100);
    } else {
        showToast(data?.message || t('log_fetch_err', 'Unable to fetch logs.'), 'error');
    }
}

async function clearLogs(type) {
    const btn = event.target.closest('.btn');
    const select = document.getElementById(`setting-${type}Version`);
    const version = select.value;
    if (!version) return showToast(t('plz_select_version', 'Please select a version first.'), 'error');

    const confirmBtn = document.getElementById('confirm-action-btn');
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

    const msg = t('confirm_log_clear', 'Are you sure you want to permanently delete all error logs for the {x} service?').replace('{x}', type.toUpperCase());
    openConfirmModal(msg, async () => {
        setLoadingBtn(btn, true);
        const data = await apiCall(`/api/logs/${type}/${version}/clear`, { method: 'POST' });
        setLoadingBtn(btn, false);

        if (data && data.success) {
            showToast(data.message, 'success');
            const viewer = document.getElementById('log-viewer-content');
            if (viewer && document.getElementById('modal-log').classList.contains('active')) {
                viewer.value = `--- ${t('log_empty', 'Log file is completely empty (Clean)')} ---`;
            }
        } else {
            showToast(data?.message || t('log_del_err', 'Unable to delete logs.'), 'error');
        }
    }, t('btn_yes_clear', 'Yes, Clear'));
}

function closeConfirmModal() {
    document.getElementById('modal-confirm').classList.remove('active');
}

function closeLogModal() {
    document.getElementById('modal-log').classList.remove('active');
}

// ─── TOAST NOTIFICATIONS ───

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');

    const icons = {
        success: 'check-circle',
        error: 'x-circle',
        info: 'info'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i data-lucide="${icons[type] || icons.info}" class="toast-lucide-icon"></i>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);
    if (window.lucide) lucide.createIcons();

    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ─── CONFIRMATION MODAL ───
let confirmCallback = null;

function openConfirmModal(message, callback, buttonText = t('btn_yes', 'Yes'), isDanger = true) {
    document.getElementById('confirm-message').innerText = message;
    confirmCallback = callback;

    const btn = document.getElementById('confirm-action-btn');
    btn.innerText = buttonText;

    // Style adjustment
    if (isDanger) {
        btn.style.background = 'rgba(244, 63, 94, 0.1)';
        btn.style.borderColor = 'var(--accent-rose)';
        btn.style.color = 'var(--accent-rose)';
    } else {
        btn.style.background = 'rgba(99, 102, 241, 0.1)';
        btn.style.borderColor = 'var(--accent-blue-light)';
        btn.style.color = 'var(--accent-blue-light)';
    }

    document.getElementById('modal-confirm').classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('modal-confirm').classList.remove('active');
    confirmCallback = null;
}

function executeConfirmAction() {
    if (confirmCallback) confirmCallback();
    closeConfirmModal();
}

// ─── BACKUP MANAGEMENT (LIST & ACTIONS) ───

async function loadBackups() {
    const data = await apiCall('/api/backups');
    const grid = document.getElementById('backups-grid');
    if (!data || !data.success || data.backups.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="package-search" style="width: 48px; height: 48px;"></i></div>
                <div class="empty-state-title" data-i18n="no_backup_title">No backups found</div>
                <div class="empty-state-text" data-i18n="no_backup_desc">You haven't taken any project backups yet.</div>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        applyTranslations();
        return;
    }

    grid.innerHTML = data.backups.map(b => `
        <div class="vhost-item">
            <div class="vhost-info">
                <div class="vhost-icon"><i data-lucide="package" style="width: 20px; height: 20px;"></i></div>
                <div>
                    <div class="vhost-name">${b.filename}</div>
                    <div class="vhost-path" style="opacity: 0.6;">${b.size} — ${b.date}</div>
                </div>
            </div>
            <div class="vhost-actions">
                <button class="btn btn-primary btn-sm" onclick="openRestoreModal('${b.filename}')">
                    <i data-lucide="archive-restore" style="width: 14px; height: 14px; margin-right: 4px;"></i> <span data-i18n='restore'>Restore</span>
                </button>
                <button class="btn btn-danger-outline btn-sm" onclick="deleteBackup('${b.filename}')">
                    <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                </button>
            </div>
        </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
    applyTranslations();
}

function deleteBackup(filename) {
    const msg = t('confirm_delete_backup', 'Are you sure you want to permanently delete backup {x}?').replace('{x}', filename);
    openConfirmModal(msg, async () => {
        const data = await apiCall(`/api/backups/${filename}`, { method: 'DELETE' });
        if (data && data.success) {
            showToast(data.message, 'success');
            loadBackups();
        }
    }, t('btn_yes_delete', 'Yes, Delete'), true);
}

// ─── RESTORE PROCESS ───
let projectList = [];
let currentRestoreFilename = '';

async function openRestoreModal(filename) {
    currentRestoreFilename = filename;
    document.getElementById('restore-filename-display').innerText = filename;

    // Load projects into dropdown
    const pData = await apiCall('/api/projects');
    projectList = pData ? pData.projects : [];

    const select = document.getElementById('restore-target-select');

    // Suggest name based on original (Stripping timestamp like _15-09-2026_13-44)
    let suggestedName = filename.split('_')[0];

    select.innerHTML = `<option value="NEW|${suggestedName}">${t('new_proj_as', '-- Open as New Project')} (${suggestedName}) --</option>`;
    if (projectList.length > 0) {
        projectList.forEach(p => {
            select.innerHTML += `<option value="EXISTING|${p.path}">${p.name} ${t('overwrite_folder', 'Overwrite Folder')}</option>`;
        });
    }

    document.getElementById('modal-restore').classList.add('active');
    initCustomSelect('restore-target-select');
}

function closeRestoreModal() {
    document.getElementById('modal-restore').classList.remove('active');
}

function confirmExecuteRestore() {
    const val = document.getElementById('restore-target-select').value;
    const restoreDb = document.getElementById('restore-db-checkbox').checked;
    const [type, pathOrName] = val.split('|');

    let msg = '';
    let isErase = (type === 'EXISTING');

    if (type === 'EXISTING') {
        msg = t('confirm_restore_existing_msg', 'ALL files in {x} will be deleted and backup content will be loaded. This cannot be undone. Confirm?').replace('{x}', pathOrName);
        openConfirmModal(msg, () => {
            executeRestore(type, pathOrName, isErase, restoreDb);
        }, t('btn_yes_erase_restore', 'Yes, Erase and Restore'), true);
    } else {
        // Even if NEW is selected, check if a folder with that name exists
        const existing = projectList.find(p => p.name.toLowerCase() === pathOrName.toLowerCase());
        if (existing) {
            msg = t('confirm_restore_new_exists_msg', "A folder named '{x}' already exists! Its contents will be DELETED and the backup will be extracted there. Do you confirm?").replace('{x}', pathOrName);
            openConfirmModal(msg, () => {
                executeRestore(type, pathOrName, isErase, restoreDb);
            }, t('btn_yes_erase_restore', 'Yes, Delete and Load'), true);
        } else {
            msg = t('confirm_restore_new_msg', "The backup will be extracted to a new folder named '{x}'. Continue?").replace('{x}', pathOrName);
            openConfirmModal(msg, () => {
                executeRestore(type, pathOrName, isErase, restoreDb);
            }, t('btn_yes_extract', 'Yes, Extract'), false);
        }
    }
}

async function executeRestore(type, target, eraseTarget, restoreDb) {
    const btn = document.getElementById('btn-do-restore');
    setLoadingBtn(btn, true);

    const payload = {
        filename: currentRestoreFilename,
        targetPath: target,
        eraseTarget: eraseTarget,
        restoreDb: restoreDb
    };

    const data = await apiCall('/api/backups/restore', {
        method: 'POST',
        body: JSON.stringify(payload)
    }, false, 600000); // 10 minutes for restore

    setLoadingBtn(btn, false);
    if (data && data.success) {
        showToast(data.message, 'success');
        closeRestoreModal();
        if (type === 'NEW') switchSection('projects');
    } else if (data) {
        showToast(data.message, 'error');
    }
}

// ─── BACKUP MODAL (CREATE) ───
let currentBackupProjectName = '';
let currentBackupProjectPath = '';
let backupPollInterval = null;

async function openBackupModal(name, pathStr) {
    currentBackupProjectName = name;
    currentBackupProjectPath = pathStr;

    document.getElementById('backup-project-name').innerText = name;
    document.getElementById('backup-project-path').value = pathStr;

    const pSelect = document.getElementById('backup-db-select');
    pSelect.innerHTML = `<option value="">${t('folder_only', 'Folder Only')}</option>`;

    // fetch databases
    const data = await apiCall('/api/mysql/db-list');
    if (data && data.success && data.databases) {
        data.databases.forEach(dbName => {
            pSelect.innerHTML += `<option value="${dbName}">${t('folder_and', 'Folder &')} ${dbName}</option>`;
        });
    }

    document.getElementById('modal-backup').classList.add('active');

    // Update Custom Select if available (delayed)
    setTimeout(() => {
        initCustomSelect('backup-db-select');
    }, 50);
}

function closeBackupModal() {
    document.getElementById('modal-backup').classList.remove('active');
    if (backupPollInterval) {
        clearInterval(backupPollInterval);
        backupPollInterval = null;
    }
    const pc = document.getElementById('backup-progress-container');
    if (pc) pc.style.display = 'none';
    const btn = document.getElementById('btn-do-backup');
    if (btn && btn.getAttribute('data-loading') === 'true') setLoadingBtn(btn, false);
}

async function executeBackup() {
    const btn = document.getElementById('btn-do-backup');
    const val = document.getElementById('backup-db-select').value;
    let dbName = '';
    let tableName = '';

    if (val) {
        const parts = val.split('|');
        dbName = parts[0];
        tableName = parts[1] || '';
    }

    setLoadingBtn(btn, true);

    // Create or show progress container
    let pc = document.getElementById('backup-progress-container');
    if (!pc) {
        pc = document.createElement('div');
        pc.id = 'backup-progress-container';
        pc.style.cssText = 'margin-top: 16px; display: none;';
        pc.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                <div class="spinner" style="width: 16px; height: 16px; border-width: 2px;"></div>
                <span id="backup-progress-text" style="color: var(--text-secondary); font-size: 13px;"></span>
            </div>
            <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">
                <div id="backup-progress-bar" style="height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent-blue), var(--accent-blue-light)); border-radius: 3px; transition: width 0.5s ease;"></div>
            </div>
        `;
        // Append to modal body (grandparent) so it appears BELOW the button row
        const modalBody = btn.closest('.modal');
        if (modalBody) {
            modalBody.appendChild(pc);
        } else {
            btn.parentNode.parentNode.appendChild(pc);
        }
    }
    pc.style.display = 'block';
    document.getElementById('backup-progress-bar').style.width = '0%';
    document.getElementById('backup-progress-text').textContent = t('backup_starting', 'Starting backup...');

    // Start backup (returns immediately with taskId)
    const startData = await apiCall('/api/backup', {
        method: 'POST',
        body: JSON.stringify({
            projectName: currentBackupProjectName,
            projectPath: currentBackupProjectPath,
            dbName,
            tableName
        })
    });

    if (!startData || !startData.success || !startData.taskId) {
        setLoadingBtn(btn, false);
        pc.style.display = 'none';
        if (startData) showToast(startData.message, 'error');
        return;
    }

    const taskId = startData.taskId;

    // Poll for progress every 1.5s
    if (backupPollInterval) clearInterval(backupPollInterval);
    backupPollInterval = setInterval(async () => {
        try {
            const resp = await fetch(`/api/backup/status/${taskId}`);
            const status = await resp.json();
            if (!status) return;

            const bar = document.getElementById('backup-progress-bar');
            const txt = document.getElementById('backup-progress-text');
            if (bar) bar.style.width = status.progress + '%';
            if (txt) txt.textContent = status.message || '';

            if (status.status === 'done') {
                clearInterval(backupPollInterval);
                backupPollInterval = null;
                setLoadingBtn(btn, false);
                pc.style.display = 'none';
                showToast(status.message, 'success');
                closeBackupModal();
            } else if (status.status === 'error' || status.status === 'not_found') {
                clearInterval(backupPollInterval);
                backupPollInterval = null;
                setLoadingBtn(btn, false);
                pc.style.display = 'none';
                showToast(status.message || t('backup_failed', 'Backup failed.'), 'error');
            }
        } catch(e) { /* network glitch — keep polling */ }
    }, 1500);

    // Safety timeout (10 minutes)
    setTimeout(() => {
        if (backupPollInterval) {
            clearInterval(backupPollInterval);
            backupPollInterval = null;
            setLoadingBtn(btn, false);
            if (pc) pc.style.display = 'none';
            showToast(t('backup_timeout', 'Backup timed out.'), 'error');
        }
    }, 600000);
}

// ─── HELPERS ───

function setLoadingBtn(btn, loading) {
    if (!btn) return;
    if (loading) {
        btn.setAttribute('data-loading', 'true');
        // Fix button size (prevents height/width jump)
        const w = btn.offsetWidth;
        const h = btn.offsetHeight;
        btn.style.width = w + 'px';
        btn.style.height = h + 'px';
        btn.disabled = true;

        // Lucide icon starts as <i> but becomes <svg>
        const icon = btn.querySelector('i, svg');
        if (icon) {
            icon._originalDisplay = icon.style.display;
            icon.style.display = 'none';
            // Insert spinner
            const spinner = document.createElement('div');
            spinner.className = 'spinner';
            spinner.id = 'temp-btn-spinner';
            icon.parentNode.insertBefore(spinner, icon);
        } else {
            btn._originalHtml = btn.innerHTML;
            btn.innerHTML = `<div class="spinner"></div>`;
        }
    } else {
        btn.removeAttribute('data-loading');
        btn.disabled = false;
        btn.style.width = '';
        btn.style.height = '';
        
        const tempSpinner = btn.querySelector('#temp-btn-spinner');
        if (tempSpinner) {
            tempSpinner.remove();
            const icon = btn.querySelector('i, svg');
            if (icon) icon.style.display = icon._originalDisplay || '';
        } else if (btn._originalHtml) {
            btn.innerHTML = btn._originalHtml;
            delete btn._originalHtml;
        }
    }
}

// ─── CUSTOM SELECT (PREMIUM UI) ───

function initCustomSelect(selectId) {
    const originalSelect = document.getElementById(selectId);
    if (!originalSelect) return;

    // If a custom wrapper already exists, remove it for update
    if (originalSelect.nextElementSibling && originalSelect.nextElementSibling.classList.contains('custom-select-wrapper')) {
        originalSelect.nextElementSibling.remove();
    }

    originalSelect.classList.add('customized'); // Hide original
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';

    const customSelect = document.createElement('div');
    customSelect.className = 'custom-select';

    const selectedText = document.createElement('span');
    selectedText.className = 'custom-select-value';
    const activeOption = originalSelect.options[originalSelect.selectedIndex];
    selectedText.innerHTML = activeOption ? activeOption.text : t('please_select', 'Please Select');

    const arrow = document.createElement('span');
    arrow.className = 'custom-select-arrow';
    arrow.innerHTML = '▼';

    customSelect.appendChild(selectedText);
    customSelect.appendChild(arrow);

    const dropdown = document.createElement('div');
    dropdown.className = 'custom-select-dropdown';

    // Get original options and convert to rich UI list
    Array.from(originalSelect.options).forEach((opt, idx) => {
        const optionDiv = document.createElement('div');
        optionDiv.className = `custom-option ${opt.selected ? 'selected' : ''}`;
        optionDiv.innerHTML = opt.text;

        optionDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            originalSelect.selectedIndex = idx;
            selectedText.innerHTML = opt.text;

            // Remove other selected classes and add to new one
            dropdown.querySelectorAll('.custom-option').forEach(el => el.classList.remove('selected'));
            optionDiv.classList.add('selected');

            // Close menu
            dropdown.classList.remove('show');
            customSelect.classList.remove('active');

            // Manually trigger original change event for system awareness
            // Note: dispatchEvent does NOT trigger inline handlers like onchange="..."
            // So we call the handler directly for the db-ops-select
            originalSelect.dispatchEvent(new Event('change', { bubbles: true }));
            
            // For db-ops-select, directly call loadDatabaseTables since inline onchange won't fire with dispatchEvent
            if (selectId === 'db-ops-select' && typeof loadDatabaseTables === 'function') {
                loadDatabaseTables();
            }
        });

        dropdown.appendChild(optionDiv);
    });

    customSelect.addEventListener('click', (e) => {
        e.stopPropagation();

        // Close other open menus
        document.querySelectorAll('.custom-select-dropdown').forEach(el => {
            if (el !== dropdown) el.classList.remove('show');
        });
        document.querySelectorAll('.custom-select').forEach(el => {
            if (el !== customSelect) el.classList.remove('active');
        });

        // Toggle our menu
        dropdown.classList.toggle('show');
        customSelect.classList.toggle('active');
    });

    wrapper.appendChild(customSelect);
    wrapper.appendChild(dropdown);

    // Insert new UI after original select
    originalSelect.parentNode.insertBefore(wrapper, originalSelect.nextSibling);

    // Transfer flex styles if present
    if (originalSelect.style.flex) {
        wrapper.style.flex = originalSelect.style.flex;
    }
}

// Auto-close menus on outside click
document.addEventListener('click', () => {
    document.querySelectorAll('.custom-select-dropdown').forEach(el => el.classList.remove('show'));
    document.querySelectorAll('.custom-select').forEach(el => el.classList.remove('active'));
});

// ─── PHP CONFIGURATION MANAGEMENT ───

let phpExtensionsData = [];
let phpSettingsData = [];
let currentPhpConfigVersion = '';

function getSelectedPhpVersion() {
    const sel = document.getElementById('setting-phpVersion');
    return sel ? sel.value : '';
}

// Panel Toggle
function togglePhpPanel(type) {
    const body = document.getElementById(type === 'extensions' ? 'php-extensions-body' : 'php-settings-body');
    const arrow = document.getElementById(type === 'extensions' ? 'php-ext-arrow' : 'php-settings-arrow');

    const isOpen = body.classList.contains('open');

    if (isOpen) {
        body.classList.remove('open');
        arrow.classList.remove('open');
    } else {
        body.classList.add('open');
        arrow.classList.add('open');
        // Load data on first open
        const version = getSelectedPhpVersion();
        if (version) {
            if (type === 'extensions') loadPhpExtensions();
            else loadPhpSettings();
        }
    }
}

// Load PHP Extensions
async function loadPhpExtensions() {
    const version = getSelectedPhpVersion();
    if (!version) return showToast(t('plz_select_php', 'Please select PHP version first.'), 'error');

    currentPhpConfigVersion = version;
    const grid = document.getElementById('php-ext-grid');
    grid.innerHTML = '<div style="color: var(--text-muted); padding: 20px; text-align: center;"><div class="spinner" style="margin: 0 auto;"></div></div>';

    const data = await apiCall(`/api/php/extensions/${version}`);
    if (!data || !data.success) {
        grid.innerHTML = '<div style="color: var(--text-muted); padding: 20px; text-align: center;">' + t('ext_fetch_err', 'Unable to fetch extensions.') + '</div>';
        return;
    }

    phpExtensionsData = data.extensions;
    renderExtensions(phpExtensionsData);
    updateExtCount();
}

function renderExtensions(extensions) {
    const grid = document.getElementById('php-ext-grid');

    grid.innerHTML = extensions.map((ext, idx) => `
        <div class="php-ext-item ${ext.enabled ? 'active' : ''}" data-ext-name="${ext.name}" onclick="toggleExtItem(this, ${idx})">
            <label class="toggle-switch" onclick="event.stopPropagation()">
                <input type="checkbox" ${ext.enabled ? 'checked' : ''} data-ext-index="${idx}" onchange="toggleExtCheckbox(this, ${idx})">
                <span class="toggle-slider"></span>
            </label>
            <div class="php-ext-info">
                <div class="php-ext-name">${ext.name}</div>
                ${ext.description ? `<div class="php-ext-desc">${ext.description}</div>` : ''}
            </div>
        </div>
    `).join('');
}

function toggleExtItem(el, idx) {
    const checkbox = el.querySelector('input[type="checkbox"]');
    checkbox.checked = !checkbox.checked;
    toggleExtCheckbox(checkbox, idx);
}

function toggleExtCheckbox(checkbox, idx) {
    phpExtensionsData[idx].enabled = checkbox.checked;
    const item = checkbox.closest('.php-ext-item');
    item.classList.toggle('active', checkbox.checked);
    updateExtCount();
}

function updateExtCount() {
    const enabled = phpExtensionsData.filter(e => e.enabled).length;
    const total = phpExtensionsData.length;
    const countEl = document.getElementById('php-ext-count');
    if (countEl) countEl.textContent = `${enabled} / ${total}`;
}

// Save Extensions
async function savePhpExtensions() {
    const version = currentPhpConfigVersion || getSelectedPhpVersion();
    if (!version) return;

    const btn = document.getElementById('btn-save-extensions');
    setLoadingBtn(btn, true);

    const data = await apiCall(`/api/php/extensions/${version}`, {
        method: 'POST',
        body: JSON.stringify({ extensions: phpExtensionsData })
    });

    setLoadingBtn(btn, false);

    if (data && data.success) {
        showToast(data.message, 'success');
    } else if (data) {
        showToast(data.message, 'error');
    }
}

// Search filter
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('php-ext-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            document.querySelectorAll('.php-ext-item').forEach(item => {
                const name = item.dataset.extName || '';
                const desc = item.querySelector('.php-ext-desc')?.textContent || '';
                const matches = name.toLowerCase().includes(query) || desc.toLowerCase().includes(query);
                item.classList.toggle('hidden', !matches);
            });
        });
    }
});

// Load PHP Settings
async function loadPhpSettings() {
    const version = getSelectedPhpVersion();
    if (!version) return showToast(t('plz_select_php', 'Please select PHP version first.'), 'error');

    currentPhpConfigVersion = version;
    const grid = document.getElementById('php-settings-grid');
    grid.innerHTML = '<div style="color: var(--text-muted); padding: 20px; text-align: center;"><div class="spinner" style="margin: 0 auto;"></div></div>';

    const data = await apiCall(`/api/php/settings/${version}`);
    if (!data || !data.success) {
        grid.innerHTML = `<div style="color: var(--text-muted); padding: 20px; text-align: center;">${t('settings_fetch_err', 'Unable to fetch settings.')}</div>`;
        return;
    }

    phpSettingsData = data.settings;
    renderPhpSettings(phpSettingsData);
}

function renderPhpSettings(settings) {
    const grid = document.getElementById('php-settings-grid');

    grid.innerHTML = settings.map((s, idx) => {
        let inputHtml = '';

        if (s.type === 'toggle') {
            const isOn = s.value.toLowerCase() === 'on' || s.value === '1';
            inputHtml = `
                <div class="php-setting-toggle">
                    <span class="php-setting-toggle-label ${isOn ? '' : 'off'}" id="toggle-label-${idx}">${isOn ? 'On' : 'Off'}</span>
                    <label class="toggle-switch">
                        <input type="checkbox" ${isOn ? 'checked' : ''} data-setting-index="${idx}" onchange="togglePhpSetting(this, ${idx})">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            `;
        } else {
            const isWide = s.key === 'error_reporting' || s.key === 'date.timezone';
            inputHtml = `<input type="text" class="php-setting-input ${isWide ? 'wide' : ''}" value="${escapeHtml(s.value)}" data-setting-index="${idx}" data-setting-key="${s.key}">`;
        }

        return `
            <div class="php-setting-item">
                <div class="php-setting-label">
                    <div class="php-setting-name">${s.label}</div>
                    <div class="php-setting-key">${s.key}</div>
                    ${s.unit ? `<div class="php-setting-unit">${s.unit}</div>` : ''}
                </div>
                ${inputHtml}
            </div>
        `;
    }).join('');
}

function togglePhpSetting(checkbox, idx) {
    const isOn = checkbox.checked;
    phpSettingsData[idx].value = isOn ? 'On' : 'Off';
    const label = document.getElementById(`toggle-label-${idx}`);
    if (label) {
        label.textContent = isOn ? 'On' : 'Off';
        label.className = `php-setting-toggle-label ${isOn ? 'on' : 'off'}`;
    }
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// Save PHP Settings
async function savePhpSettings() {
    const version = currentPhpConfigVersion || getSelectedPhpVersion();
    if (!version) return;

    // Collect input values
    const inputs = document.querySelectorAll('.php-setting-input');
    inputs.forEach(input => {
        const idx = parseInt(input.dataset.settingIndex);
        if (!isNaN(idx) && phpSettingsData[idx]) {
            phpSettingsData[idx].value = input.value;
        }
    });

    const settingsToSave = phpSettingsData.map(s => ({
        key: s.key,
        value: s.value
    }));

    const btn = document.getElementById('btn-save-php-settings');
    setLoadingBtn(btn, true);

    const data = await apiCall(`/api/php/settings/${version}`, {
        method: 'POST',
        body: JSON.stringify({ settings: settingsToSave })
    });

    setLoadingBtn(btn, false);

    if (data && data.success) {
        showToast(data.message, 'success');
    } else if (data) {
        showToast(data.message, 'error');
    }
}

// Update panels on PHP version change
document.addEventListener('DOMContentLoaded', () => {
    // When PHP version changes, update any open panels
    const phpSelect = document.getElementById('setting-phpVersion');
    if (phpSelect) {
        phpSelect.addEventListener('change', () => {
            // New logic: hide/show panels
            togglePhpPanels();

            // Existing logic: refresh open panels
            const extBody = document.getElementById('php-extensions-body');
            const settBody = document.getElementById('php-settings-body');
            if (extBody && extBody.classList.contains('open')) loadPhpExtensions();
            if (settBody && settBody.classList.contains('open')) loadPhpSettings();
        });
    }
});

// ─── GIT CLONE MODAL ───

function openCloneModal() {
    document.getElementById('modal-clone').classList.add('active');
    const input = document.getElementById('clone-url-input');
    input.value = '';
    updateCloneButton();
    // Hide progress
    document.getElementById('clone-progress').style.display = 'none';
    // Focus
    setTimeout(() => input.focus(), 200);
}

function closeCloneModal() {
    document.getElementById('modal-clone').classList.remove('active');
}

function updateCloneButton() {
    const input = document.getElementById('clone-url-input');
    const btn = document.getElementById('btn-clone-action');
    const val = input.value.trim();

    if (val.length > 0) {
        btn.innerHTML = t('btn_download', 'Download');
    } else {
        btn.innerHTML = t('btn_paste_download', 'Paste and Download');
    }
}

async function executeClone() {
    const input = document.getElementById('clone-url-input');
    const btn = document.getElementById('btn-clone-action');
    let url = input.value.trim();

    // Paste from clipboard if empty
    if (!url) {
        try {
            url = await navigator.clipboard.readText();
            url = url.trim();
            input.value = url;
            updateCloneButton();
        } catch (e) {
            showToast(t('clipboard_access_err', 'Unable to access clipboard. Please paste the address manually.'), 'error');
            return;
        }
    }

    if (!url) {
        showToast(t('empty_clone_url', 'Clone URL is empty. Please enter a Git repo address.'), 'error');
        return;
    }

    // Simple URL validation
    if (!url.includes('github.com') && !url.includes('gitlab.com') && !url.includes('bitbucket.org') && !url.startsWith('git@') && !url.startsWith('https://') && !url.startsWith('http://')) {
        showToast(t('invalid_clone_url', 'Invalid clone URL. Must be in HTTPS or SSH format.'), 'error');
        return;
    }

    // Show progress
    const progress = document.getElementById('clone-progress');
    const progressFill = document.getElementById('clone-progress-fill');
    const statusEl = document.getElementById('clone-status');
    progress.style.display = 'block';
    progressFill.className = 'clone-progress-fill indeterminate';
    statusEl.className = 'clone-status';
    statusEl.textContent = t('cloning_wait', 'Cloning... This may take a while.');

    setLoadingBtn(btn, true);
    input.disabled = true;

    const data = await apiCall('/api/clone', {
        method: 'POST',
        body: JSON.stringify({ url })
    }, false, 600000); // 10 minutes for clone

    setLoadingBtn(btn, false);
    input.disabled = false;
    progressFill.className = 'clone-progress-fill';

    // Get the progress bar element to hide it later
    const progressBar = progress.querySelector('.clone-progress-bar');

    if (data && data.success) {
        // Hide progress bar, show success status
        if (progressBar) progressBar.style.display = 'none';
        progressFill.style.width = '100%';
        statusEl.className = 'clone-status success';
        statusEl.innerHTML = `<i data-lucide="check-circle" style="width: 16px; height: 16px; margin-right: 6px;"></i> ${data.message}`;
        if (window.lucide) lucide.createIcons();
        showToast(data.message, 'success');

        // Update projects list
        loadProjects();

        // Close modal after 2 seconds
        setTimeout(() => {
            closeCloneModal();
            switchSection('projects');
        }, 2000);
    } else if (data) {
        // Hide progress bar, show error status
        if (progressBar) progressBar.style.display = 'none';
        progressFill.style.width = '100%';
        progressFill.style.background = 'var(--gradient-danger)';
        statusEl.className = 'clone-status error';
        statusEl.innerHTML = `<i data-lucide="x-circle" style="width: 16px; height: 16px; margin-right: 6px;"></i> ${data.message}`;
        if (window.lucide) lucide.createIcons();
        showToast(data.message, 'error');
    }
}

function confirmDeleteProject(name, btnElement) {
    const msgTemplate = t('confirm_delete_project_msg', 'Project "{x}", its files, subdirectories and associated virtual server (vhost), SSL certificate will be permanently DELETED. This CANNOT be undone! Do you want to continue?');
    const message = `${t('attention', 'ATTENTION!')}\n\n${msgTemplate.replace('{x}', name)}`;

    openConfirmModal(message, async () => {
        setLoadingBtn(btnElement, true);
        showToast(t('deleting_wait', '"{x}" is being deleted, please wait...').replace('{x}', name), 'info');

        const data = await apiCall('/api/projects/delete', {
            method: 'POST',
            body: JSON.stringify({ name })
        });

        setLoadingBtn(btnElement, false);

        if (data && data.success) {
            showToast(data.message, 'success');
            loadProjects(); // refresh list immediately
        } else if (data) {
            showToast(data.message || t('project_delete_err', 'Error deleting project'), 'error');
        }
    }, ' ' + t('btn_yes_delete_permanently', 'Yes, Delete Permanently'), true);
}

async function openProjectFolder(name) {
    const data = await apiCall('/api/projects/open-folder', {
        method: 'POST',
        body: JSON.stringify({ name })
    });

    if (data && !data.success) {
        showToast(data.message || t('folder_open_err', 'Unable to open folder'), 'error');
    }
}

function openRenameModal(name) {
    document.getElementById('modal-rename').classList.add('active');
    document.getElementById('rename-old-name').value = name;
    document.getElementById('rename-new-name').value = name;
    document.getElementById('rename-new-name').select();
    
    if (window.lucide) lucide.createIcons();
}

function closeRenameModal() {
    document.getElementById('modal-rename').classList.remove('active');
}

async function executeRename() {
    const oldName = document.getElementById('rename-old-name').value;
    const newName = document.getElementById('rename-new-name').value.trim();
    
    if (!newName) {
        showToast(t('enter_project_name', 'Please enter a project name'), 'error');
        return;
    }
    
    if (newName === oldName) {
        closeRenameModal();
        return;
    }
    
    const btn = document.getElementById('btn-do-rename');
    setLoadingBtn(btn, true);
    
    const data = await apiCall('/api/projects/rename', {
        method: 'POST',
        body: JSON.stringify({ oldName, newName })
    });
    
    setLoadingBtn(btn, false);
    
    if (data && data.success) {
        showToast(data.message || t('project_renamed', 'Project renamed successfully'), 'success');
        closeRenameModal();
        loadProjects();
    } else if (data) {
        showToast(data.message, 'error');
    }
}

// ─── DATABASE OPERATIONS ───

let lastDbListStr = "";
let lastDbStatus = true;

async function loadDatabaseList(preferredDb = null) {
    const data = await apiCall('/api/mysql/db-list');
    const select = document.getElementById('db-ops-select');
    if (!select) return;

    const isOpen = data && data.success;
    const currentDbs = isOpen ? data.databases.join(',') : "";
    
    // Dirty check: if not a manual action and nothing changed, skip re-render to avoid closing dropdowns
    if (!preferredDb && currentDbs === lastDbListStr && isOpen === lastDbStatus) {
        return;
    }
    
    lastDbListStr = currentDbs;
    lastDbStatus = isOpen;

    const tablesGrid = document.getElementById('db-tables-grid');
    const bulkActions = document.getElementById('bulk-table-actions');

    // Get button elements
    const btnCreateDb = document.getElementById('btn-create-db');
    const btnExportDb = document.getElementById('btn-export-db');
    const btnImportDb = document.getElementById('btn-import-db');
    const btnImportTable = document.getElementById('btn-import-table');
    const btnDeleteDb = document.getElementById('btn-delete-db');

    if (!data || !data.success) {
        select.innerHTML = `<option value="">${t('mysql_closed_err', 'MySQL is closed or an error occurred')}</option>`;
        if (tablesGrid) tablesGrid.innerHTML = `<div class="empty-state">${t('conn_failed_err', 'Connection failed. (System detected that MySQL service is closed)')}</div>`;
        if (bulkActions) bulkActions.style.display = 'none';
        
        // Hide all database operation buttons when MySQL is closed
        if (btnCreateDb) btnCreateDb.style.display = 'none';
        if (btnExportDb) btnExportDb.style.display = 'none';
        if (btnImportDb) btnImportDb.style.display = 'none';
        if (btnDeleteDb) btnDeleteDb.style.display = 'none';
        
        initCustomSelect('db-ops-select');
        return;
    }

    // MySQL is open - show Create Database and Import Database buttons
    if (btnCreateDb) btnCreateDb.style.display = '';
    if (btnImportDb) btnImportDb.style.display = '';
    // Keep current selection or use preferred one
    const val = preferredDb || select.value;
    select.innerHTML = `<option value="">${t('select_db', 'Select a database...')}</option>` +
        data.databases.map(d => `<option value="${d}">${d}</option>`).join('');

    if (val && data.databases.includes(val)) {
        select.value = val;
        // Trigger generic change event to sync any custom UI elements
        select.dispatchEvent(new Event('change'));
    } else {
        document.getElementById('db-tables-grid').innerHTML = `<div class="empty-state">${t('plz_select_db', 'Please select a database to perform operations.')}</div>`;
    }

    // Update custom select
    initCustomSelect('db-ops-select');
    
    applyTranslations();

    if (select.value) {
        // During auto polling, avoid refreshing table list if any tab is selected (to keep selection)
        const selected = document.querySelectorAll('.table-cb:checked');
        if (selected.length === 0) {
            loadDatabaseTables();
        }
        // Show Export, Table Import and Delete buttons when database is selected
        if (btnExportDb) btnExportDb.style.display = '';
        if (btnDeleteDb) btnDeleteDb.style.display = '';
        if (btnImportTable) btnImportTable.style.display = '';
    } else {
        if (btnExportDb) btnExportDb.style.display = 'none';
        if (btnDeleteDb) btnDeleteDb.style.display = 'none';
        if (btnImportTable) btnImportTable.style.display = 'none';
    }
}

async function loadDatabaseTables() {
    const db = document.getElementById('db-ops-select').value;
    const bulkActions = document.getElementById('bulk-table-actions');
    const btnExportDb = document.getElementById('btn-export-db');
    const btnDeleteDb = document.getElementById('btn-delete-db');
    const btnImportTable = document.getElementById('btn-import-table');

    if (!db) {
        document.getElementById('db-tables-grid').innerHTML = `<div class="empty-state">${t('plz_select_db_first', 'Please select a database to perform operations.')}</div>`;
        if (bulkActions) bulkActions.style.display = 'none';
        // Hide Export, Delete, and Table Import buttons when no database is selected
        if (btnExportDb) btnExportDb.style.display = 'none';
        if (btnDeleteDb) btnDeleteDb.style.display = 'none';
        if (btnImportTable) btnImportTable.style.display = 'none';
        return;
    }

    // Show Export, Table Import and Delete buttons when database is selected
    if (btnExportDb) btnExportDb.style.display = '';
    if (btnDeleteDb) btnDeleteDb.style.display = '';
    if (btnImportTable) btnImportTable.style.display = '';

    const data = await apiCall('/api/mysql/db-tables', {
        method: 'POST',
        body: JSON.stringify({ db })
    });

    const grid = document.getElementById('db-tables-grid');

    // Remember current selections
    const checkedTables = Array.from(grid.querySelectorAll('.table-cb:checked')).map(cb => cb.value);

    if (!data || !data.success || data.tables.length === 0) {
        grid.innerHTML = `<div class="empty-state">${t('no_tables_err', 'No tables found in this database.')}</div>`;
        if (bulkActions) bulkActions.style.display = 'none';
        return;
    }

    if (bulkActions) bulkActions.style.display = 'flex';

    grid.innerHTML = data.tables.map(tbl => `
        <div class="vhost-item">
            <div style="display: flex; align-items: center; justify-content: center; width: 40px;">
                <input type="checkbox" class="table-cb" value="${tbl}" ${checkedTables.includes(tbl) ? 'checked' : ''} style="transform: scale(1.2); cursor: pointer; accent-color: var(--accent-blue-light);">
            </div>
            <div class="vhost-info" style="flex: 1;">
                <div class="vhost-icon" style="background: rgba(16, 185, 129, 0.1); color: var(--accent-emerald);">
                    <i data-lucide="table" style="width: 18px; height: 18px;"></i>
                </div>
                <div>
                    <div class="vhost-name">${tbl}</div>
                    <div class="vhost-path" style="opacity: 0.6;">${t('table_text', 'Table')}</div>
                </div>
            </div>
            <div class="vhost-actions">
                <button type="button" class="btn btn-secondary btn-sm" title="${t('truncate_table_title', 'Clear Table (TRUNCATE)')}" style="border-color: rgba(245, 158, 11, 0.3); color: var(--accent-amber); padding: 6px 10px;" onclick="truncateTable('${db}', '${tbl}')"><i data-lucide="brush" style="width: 14px; height: 14px;"></i></button>
                <button type="button" class="btn btn-secondary btn-sm" title="${t('export_table_title', 'Export Table')}" style="padding: 6px 10px;" onclick="exportTable('${db}', '${tbl}')"><i data-lucide="download" style="width: 14px; height: 14px;"></i></button>
                <button type="button" class="btn btn-secondary btn-sm" title="${t('delete_table_title', 'Delete Table (DROP)')}" style="border-color: rgba(239, 68, 68, 0.3); color: var(--accent-rose); padding: 6px 10px;" onclick="deleteTable('${db}', '${tbl}')"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button>
            </div>
        </div>
    `).join('');

    // Update select all status
    if (document.getElementById('selectAllTables')) {
        const allChecked = data.tables.length > 0 && data.tables.every(t => checkedTables.includes(t));
        // if (document.getElementById('selectAllTables')) document.getElementById('selectAllTables').checked = allChecked; // Don't break if already selected
    }

    if (window.lucide) lucide.createIcons();
}

// ─── TOOLTIP SYSTEM ───

let tooltipEl = null;

function initGlobalTooltips() {
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'tooltip-content';
        document.body.appendChild(tooltipEl);
    }

    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[title], [data-tooltip]');
        if (target) {
            let text = target.getAttribute('data-tooltip') || target.getAttribute('title');
            if (text) {
                // Store original title to prevent native tooltips
                if (target.hasAttribute('title')) {
                    target.setAttribute('data-tooltip', text);
                    target.removeAttribute('title');
                }

                tooltipEl.textContent = text;
                tooltipEl.classList.add('visible');
                updateTooltipPosition(e.clientX, e.clientY);
            }
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (tooltipEl && tooltipEl.classList.contains('visible')) {
            updateTooltipPosition(e.clientX, e.clientY);
        }
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (target) {
            tooltipEl.classList.remove('visible');
        }
    });
}

function updateTooltipPosition(x, y) {
    if (!tooltipEl) return;

    const rect = tooltipEl.getBoundingClientRect();
    const w = rect.width || 120;
    const h = rect.height || 32;
    const gap = 12;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const midX = viewportWidth / 2;
    const midY = viewportHeight / 2;

    let offsetX = 0;
    let offsetY = 0;

    if (x < midX && y < midY) {
        // Quadrant 1: Top-Left -> Show Bottom-Right
        offsetX = gap;
        offsetY = gap;
    } else if (x >= midX && y < midY) {
        // Quadrant 2: Top-Right -> Show Bottom-Left
        offsetX = -w - gap;
        offsetY = gap;
    } else if (x < midX && y >= midY) {
        // Quadrant 3: Bottom-Left -> Show Top-Right
        offsetX = gap;
        offsetY = -h - gap;
    } else {
        // Quadrant 4: Bottom-Right -> Show Top-Left
        offsetX = -w - gap;
        offsetY = -h - gap;
    }

    tooltipEl.style.left = (x + offsetX) + 'px';
    tooltipEl.style.top = (y + offsetY) + 'px';
}

// Initialize on load
initGlobalTooltips();

// ─── DATABASE ACTIONS ───

function openCreateDbModal() {
    document.getElementById('modal-create-db').classList.add('active');
    document.getElementById('new-db-name').value = '';
    initCustomSelect('new-db-col');
    setTimeout(() => document.getElementById('new-db-name').focus(), 100);
}

function closeCreateDbModal() {
    document.getElementById('modal-create-db').classList.remove('active');
}

async function executeCreateDb() {
    const name = document.getElementById('new-db-name').value.trim();
    const collation = document.getElementById('new-db-col').value;
    if (!name) return showToast(t('db_name_empty_err', 'Database name cannot be empty.'), 'error');

    const data = await apiCall('/api/mysql/create-db', {
        method: 'POST',
        body: JSON.stringify({ name, collation })
    }, true);

    if (data && data.success) {
        showToast(data.message, 'success');
        closeCreateDbModal();
        loadDatabaseList(name); // Select the new DB!
    } else if (data) {
        showToast(data.message, 'error');
    }
}

function deleteDatabase() {
    const db = document.getElementById('db-ops-select').value;
    if (!db) return showToast(t('plz_select_db_first', 'Please select a database first.'), 'error');

    openConfirmModal(t('confirm_delete_db_msg', 'Database "{x}" will be permanently deleted with all its tables and data.\nAre you sure?').replace('{x}', db), async () => {
        const data = await apiCall('/api/mysql/delete-db', {
            method: 'POST',
            body: JSON.stringify({ db })
        }, true);
        if (data && data.success) {
            showToast(data.message, 'success');
            document.getElementById('db-ops-select').value = '';
            loadDatabaseList(); // refresh
        } else if (data) {
            showToast(data.message, 'error');
        }
    }, 'Delete', true);
}

function exportDatabase() {
    const db = document.getElementById('db-ops-select').value;
    if (!db) return showToast(t('plz_select_db_export', 'Select a database to export.'), 'error');
    window.location.href = '/api/mysql/export?db=' + encodeURIComponent(db);
}

function openImportSqlModal() {
    const db = document.getElementById('db-ops-select').value;
    const targetSelect = document.getElementById('import-target-db');
    
    // Clear and populate select
    targetSelect.innerHTML = `<option value="__NEW__" data-i18n="create_new_db">${t('create_new_db', 'Create New Database')}</option>`;
    
    const dbOpsSelect = document.getElementById('db-ops-select');
    // Copy options from main db selector, skipping the empty one
    Array.from(dbOpsSelect.options).forEach(opt => {
        if (opt.value) {
            const newOpt = document.createElement('option');
            newOpt.value = opt.value;
            newOpt.innerText = opt.innerText;
            targetSelect.appendChild(newOpt);
        }
    });

    // Pre-select if db exists on dashboard, otherwise New Database
    if (db) {
        targetSelect.value = db;
    } else {
        targetSelect.value = '__NEW__';
    }

    toggleImportNewDbInput();

    document.getElementById('import-sql-file').value = '';
    document.getElementById('import-new-db-name').value = '';
    document.getElementById('import-sql-progress-wrap').style.display = 'none';
    document.getElementById('btn-import-sql').disabled = false;
    document.getElementById('modal-import-sql').classList.add('active');
    
    // If we have custom select initialization, use it
    if (window.initCustomSelect) initCustomSelect('import-target-db');
}

function toggleImportNewDbInput() {
    const val = document.getElementById('import-target-db').value;
    const group = document.getElementById('import-new-db-group');
    if (val === '__NEW__') {
        group.style.display = 'block';
    } else {
        group.style.display = 'none';
    }
}

function closeImportSqlModal() {
    document.getElementById('modal-import-sql').classList.remove('active');
    
    // Cleanup process
    const fileInput = document.getElementById('import-sql-file');
    const fileName = document.getElementById('import-file-name');
    const wrap = document.getElementById('import-sql-progress-wrap');
    const btnImport = document.getElementById('btn-import-sql');
    const targetInput = document.getElementById('import-target-db');

    if (fileInput) fileInput.value = '';
    if (targetInput) {
        targetInput.innerHTML = '';
    }
    document.getElementById('import-new-db-name').value = '';
    
    if (fileName) {
        fileName.setAttribute('data-i18n', 'select_file');
        fileName.innerText = window.t ? window.t('select_file', 'Select File') : 'Select File';
    }
    
    if (wrap) wrap.style.display = 'none';
    if (btnImport) btnImport.disabled = false;
    
    // Cleanup tooltips from the file select button
    const selectBtn = document.getElementById('import-sql-btn');
    if (selectBtn) {
        selectBtn.removeAttribute('title');
        selectBtn.removeAttribute('data-tooltip');
    }
}

function executeImportSql() {
    const targetSelect = document.getElementById('import-target-db');
    let db = targetSelect.value;
    
    if (db === '__NEW__') {
        db = document.getElementById('import-new-db-name').value.trim();
        if (!db) return showToast(t('db_name_empty_err', 'Database name cannot be empty.'), 'error');
    }

    const fileInput = document.getElementById('import-sql-file');
    const file = fileInput.files[0];

    if (!file) return showToast(t('plz_select_sql', 'Please select a .sql file.'), 'error');

    doActualSqlImport(db, file);
}

function doActualSqlImport(db, file) {
    const progressWrap = document.getElementById('import-sql-progress-wrap');
    const btn = document.getElementById('btn-import-sql');

    progressWrap.style.display = 'block';
    const statusText = progressWrap.querySelector('.clone-status');
    if (statusText) statusText.textContent = t('sql_import_wait', 'This might take a few minutes depending on file size...');
    btn.disabled = true;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const sqlContent = e.target.result;
        const data = await apiCall('/api/mysql/import', {
            method: 'POST',
            body: JSON.stringify({ db, sqlContent })
        }, true, 600000); // 10 minutes for SQL import

        btn.disabled = false;
        progressWrap.style.display = 'none';

        if (data && data.success) {
            showToast(data.message, 'success');
            closeImportSqlModal();
            await loadDatabaseList(db); // Pass the db we just imported to select it!
        } else if (data) {
            showToast(data.message, 'error');
        }
    };
    reader.onerror = () => {
        btn.disabled = false;
        progressWrap.style.display = 'none';
        showToast(t('file_read_err', 'File could not be read.'), 'error');
    };
    reader.readAsText(file);
}


// ─── TABLE ACTIONS ───

function truncateTable(db, table) {
    const msg = t('confirm_truncate_table_msg', 'All data in table "{x}" will be cleared (TRUNCATE). This cannot be undone. Are you sure?').replace('{x}', table);
    openConfirmModal(msg, async () => {
        const data = await apiCall('/api/mysql/truncate-table', {
            method: 'POST',
            body: JSON.stringify({ db, table })
        }, true);
        if (data && data.success) {
            showToast(data.message, 'success');
        } else if (data) {
            showToast(data.message, 'error');
        }
    }, t('btn_yes_truncate', '🧹 Clear'), true);
}

function deleteTable(db, table) {
    const msg = t('confirm_delete_table_msg', 'Table "{x}" will be completely deleted (DROP). Do you want to continue?').replace('{x}', table);
    openConfirmModal(msg, async () => {
        const data = await apiCall('/api/mysql/delete-table', {
            method: 'POST',
            body: JSON.stringify({ db, table })
        }, true);
        if (data && data.success) {
            showToast(data.message, 'success');
            loadDatabaseTables();
        } else if (data) {
            showToast(data.message, 'error');
        }
    }, t('btn_yes_drop', 'Delete'), true);
}

function exportTable(db, table) {
    window.location.href = `/api/mysql/export?db=${encodeURIComponent(db)}&table=${encodeURIComponent(table)}`;
}

// ─── BULK TABLE ACTIONS ───

function toggleAllTables(checkbox) {
    const cbs = document.querySelectorAll('.table-cb');
    cbs.forEach(cb => cb.checked = checkbox.checked);
}

function getSelectedTables() {
    return Array.from(document.querySelectorAll('.table-cb:checked')).map(cb => cb.value);
}

function bulkTruncateTables() {
    const db = document.getElementById('db-ops-select').value;
    const selected = getSelectedTables();
    if (selected.length === 0) return showToast(t('plz_select_table', 'Please select at least one table.'), 'error');

    const msg = t('confirm_truncate_tables', 'Data of the selected {x} tables will be completely cleared (TRUNCATE). Are you sure?').replace('{x}', selected.length);
    openConfirmModal(msg, async () => {
        showLoader();
        let successCount = 0;
        for (const table of selected) {
            const data = await apiCall('/api/mysql/truncate-table', {
                method: 'POST',
                body: JSON.stringify({ db, table })
            });
            if (data && data.success) successCount++;
        }
        hideLoader();
        if (document.getElementById('selectAllTables')) document.getElementById('selectAllTables').checked = false;
        loadDatabaseTables();
    }, t('btn_bulk_truncate', 'Clear Selected'), true);
}

function bulkDeleteTables() {
    const db = document.getElementById('db-ops-select').value;
    const selected = getSelectedTables();
    if (selected.length === 0) return showToast(t('plz_select_table', 'Please select at least one table.'), 'error');

    const msg = t('confirm_delete_tables', 'Selected {x} tables will be completely deleted (DROP). Are you sure?').replace('{x}', selected.length);
    openConfirmModal(msg, async () => {
        showLoader();
        let successCount = 0;
        for (const table of selected) {
            const data = await apiCall('/api/mysql/delete-table', {
                method: 'POST',
                body: JSON.stringify({ db, table })
            });
            if (data && data.success) successCount++;
        }
        hideLoader();
        if (document.getElementById('selectAllTables')) document.getElementById('selectAllTables').checked = false;
        loadDatabaseTables();
    }, t('btn_bulk_delete', 'Delete Selected'), true);
}

// ─── CRON SCHEDULED TASKS ───

async function loadCronJobs() {
    const data = await apiCall('/api/cron');
    const grid = document.getElementById('cron-jobs-grid');
    if (!data || !data.success || !data.jobs || data.jobs.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="calendar-clock" style="width: 48px; height: 48px;"></i></div>
                <div class="empty-state-title" data-i18n="no_cron_title">No scheduled tasks</div>
                <div class="empty-state-text" data-i18n="no_cron_desc">Add a new task using the form above.</div>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        applyTranslations();
        return;
    }

    grid.innerHTML = data.jobs.map(job => {
        const statusClass = job.enabled ? 'running' : 'stopped';
        const statusText = job.enabled ? t('active', 'Active') : t('passive', 'Passive');
        return `
            <div class="vhost-item">
                <div class="vhost-info" style="flex: 1;">
                    <div class="vhost-icon" style="${job.enabled ? 'color: var(--accent-emerald);' : 'color: var(--text-muted);'}">
                        <i data-lucide="${job.enabled ? 'timer' : 'timer-off'}" style="width: 20px; height: 20px;"></i>
                    </div>
                    <div>
                        <div class="vhost-name">${job.name}</div>
                        <div class="vhost-path" style="opacity: 0.6; font-family: 'JetBrains Mono', monospace; font-size: 12px;">
                            <span style="color: var(--accent-blue-light);">${job.schedule}</span>
                            <span style="margin: 0 6px; opacity: 0.4;">→</span>
                            ${job.command}
                        </div>
                    </div>
                </div>

                <div class="vhost-actions">
                    <div class="status-badge ${statusClass}" style="cursor: pointer; font-size: 12px; padding: 4px 10px;" onclick="toggleCronJob('${job.id}', ${!job.enabled})">
                        <span class="status-dot"></span>
                        ${statusText}
                    </div>
                    <button type="button" class="btn btn-secondary btn-sm" title="${t('del_job', 'Delete Task')}" data-i18n-attr="title|del_job" style="border-color: rgba(239, 68, 68, 0.3); color: var(--accent-rose); padding: 6px 10px;" onclick="deleteCronJob('${job.id}', '${job.name.replace(/'/g, "\\'")}')"> 
                        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
    applyTranslations();
}

async function addCronJob() {
    const name = document.getElementById('cron-new-name').value.trim();
    const schedule = document.getElementById('cron-new-schedule').value.trim();
    const command = document.getElementById('cron-new-command').value.trim();

    if (!name || !schedule || !command) {
        return showToast(t('plz_fill_all', 'Please fill all fields.'), 'error');
    }

    // Simple format check
    if (schedule.split(/\s+/).length < 5) {
        return showToast(t('invalid_schedule_err', 'Invalid schedule format. 5 fields required: minute hour day month dayOfWeek'), 'error');
    }

    const data = await apiCall('/api/cron', {
        method: 'POST',
        body: JSON.stringify({ name, schedule, command, enabled: true })
    });

    if (data && data.success) {
        showToast(data.message, 'success');
        document.getElementById('cron-new-name').value = '';
        document.getElementById('cron-new-schedule').value = '';
        document.getElementById('cron-new-command').value = '';
        loadCronJobs();
    } else if (data) {
        showToast(data.message, 'error');
    }
}

async function toggleCronJob(id, enabled) {
    const data = await apiCall(`/api/cron/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled })
    });

    if (data && data.success) {
        showToast(enabled ? t('job_active_msg', 'Task activated.') : t('job_passive_msg', 'Task deactivated.'), 'success');
        loadCronJobs();
    }
}

function deleteCronJob(id, name) {
    const msg = t('confirm_delete_cron', 'Are you sure you want to delete task "{x}"?').replace('{x}', name);
    openConfirmModal(msg, async () => {
        const data = await apiCall(`/api/cron/${id}`, { method: 'DELETE' });
        if (data && data.success) {
            showToast(data.message, 'success');
            loadCronJobs();
        }
    }, t('btn_yes_delete', 'Yes, Delete'), true);
}

function openCronSamplesModal() {
    document.getElementById('modal-cron-samples').classList.add('active');
}

function closeCronSamplesModal() {
    document.getElementById('modal-cron-samples').classList.remove('active');
}

function copyToCron(schedule, command) {
    document.getElementById('cron-new-schedule').value = schedule;
    document.getElementById('cron-new-command').value = command;
    closeCronSamplesModal();
    showToast(t('sample_copied', 'Sample copied to form.'), 'success');
}

function toggleBrowserPath() {
    const modeEl = document.getElementById('setting-browserMode');
    if (!modeEl) return;
    const mode = modeEl.value;
    const group = document.getElementById('browser-path-group');
    if (group) group.style.display = (mode === 'path') ? 'block' : 'none';
}

async function openProjectUrl(url) {
    await openUrlInBrowser(url);
}

// ─── QUICK ACCESS MANAGEMENT ───

async function loadQuickAccess() {
    const data = await apiCall('/api/quick-access');
    if (!data || !data.success) return;

    // 1. Render in Sidebar
    const sidebarContainer = document.getElementById('quick-access-custom-items');
    if (sidebarContainer) {
        sidebarContainer.innerHTML = data.items.map(item => `
            <div class="nav-item" onclick="openUrlInBrowser('${item.url.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}', '${item.browserMode}', '${item.browserPath.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}')">
                <i data-lucide="${item.icon || 'external-link'}" class="nav-item-icon"></i>
                <span style="font-size: 13px;">${item.title}</span>
            </div>
        `).join('');
        if (window.lucide) lucide.createIcons();
    }

    // After loading custom items, trigger a visibility check for the section
    const qaSection = document.getElementById('quick-access-section');
    if (qaSection) {
        if (data.items.length > 0 || isApacheRunning) {
            qaSection.style.display = 'block';
        }
    }

    // 2. Render in Settings Tab
    const tbody = document.getElementById('quick-access-list-tbody');
    if (tbody) {
        if (data.items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px; color: var(--text-muted);" data-i18n="no_qa_items">No items found.</td></tr>`;
            applyTranslations();
            return;
        }

        tbody.innerHTML = data.items.map((item, index) => `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.01)'" onmouseout="this.style.background='transparent'">
                <td style="padding: 16px 20px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i data-lucide="${item.icon || 'external-link'}" style="width: 14px; height: 14px; opacity: 0.7;"></i>
                        <span style="font-weight: 500;">${item.title}</span>
                    </div>
                </td>
                <td style="padding: 16px 20px; font-size: 13px; opacity: 0.7; font-family: 'JetBrains Mono', monospace;">${item.url}</td>
                <td style="padding: 16px 20px; font-size: 12px; color: var(--accent-blue-light);">${item.browserMode === 'system' ? t('default', 'Default') : (item.browserMode === 'electron' ? 'Electron' : 'Custom')}</td>
                <td style="padding: 16px 20px; text-align: right;">
                    <div style="display: flex; gap: 4px; justify-content: flex-end;">
                        <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 6px; height: 28px; width: 28px; display: flex; align-items: center; justify-content: center;" onclick="moveQuickAccess('${item.id}', 'up')" ${index === 0 ? 'disabled style="opacity:0.2; cursor: default;"' : ''}>
                            <i data-lucide="chevron-up" style="width: 14px; height: 14px;"></i>
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 6px; height: 28px; width: 28px; display: flex; align-items: center; justify-content: center;" onclick="moveQuickAccess('${item.id}', 'down')" ${index === data.items.length - 1 ? 'disabled style="opacity:0.2; cursor: default;"' : ''}>
                            <i data-lucide="chevron-down" style="width: 14px; height: 14px;"></i>
                        </button>
                        <div style="width: 1px; height: 18px; background: rgba(255,255,255,0.1); margin: 0 4px; align-self: center;"></div>
                        <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 6px; height: 28px; width: 28px; display: flex; align-items: center; justify-content: center;" onclick="editQuickAccess('${item.id}')">
                            <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 6px; height: 28px; width: 28px; display: flex; align-items: center; justify-content: center; color: var(--accent-rose);" onclick="deleteQuickAccess('${item.id}')">
                            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
        if (window.lucide) lucide.createIcons();
    }
}

function openQuickAccessModal() {
    document.getElementById('qa-modal-title').querySelector('span').setAttribute('data-i18n', 'add_quick_access');
    document.getElementById('qa-item-id').value = '';
    document.getElementById('qa-input-title').value = '';
    document.getElementById('qa-input-url').value = '';
    document.getElementById('qa-input-icon').value = 'external-link';
    document.getElementById('qa-input-browser-mode').value = 'system';
    document.getElementById('qa-input-browser-path').value = '';
    
    toggleQaBrowserPath();
    applyTranslations();
    document.getElementById('modal-quick-access').classList.add('active');
}

function closeQuickAccessModal() {
    document.getElementById('modal-quick-access').classList.remove('active');
}

function toggleQaBrowserPath() {
    const mode = document.getElementById('qa-input-browser-mode').value;
    document.getElementById('qa-browser-path-wrap').style.display = (mode === 'path' ? 'block' : 'none');
}

async function executeSaveQuickAccess() {
    const id = document.getElementById('qa-item-id').value;
    const title = document.getElementById('qa-input-title').value.trim();
    const url = document.getElementById('qa-input-url').value.trim();
    const icon = document.getElementById('qa-input-icon').value.trim();
    const browserMode = document.getElementById('qa-input-browser-mode').value;
    const browserPath = document.getElementById('qa-input-browser-path').value.trim();

    if (!title || !url) {
        return showToast(t('plz_fill_all', 'Please fill all fields.'), 'error');
    }

    const btn = document.getElementById('btn-save-qa');
    setLoadingBtn(btn, true);

    const data = await apiCall(id ? `/api/quick-access/${id}` : '/api/quick-access', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({ title, url, icon, browserMode, browserPath })
    });

    setLoadingBtn(btn, false);

    if (data && data.success) {
        showToast(data.message, 'success');
        closeQuickAccessModal();
        loadQuickAccess();
    }
}

async function editQuickAccess(id) {
    const data = await apiCall('/api/quick-access');
    if (!data || !data.success) return;
    
    const item = data.items.find(i => i.id === id);
    if (!item) return;

    document.getElementById('qa-modal-title').querySelector('span').setAttribute('data-i18n', 'edit_quick_access');
    document.getElementById('qa-item-id').value = item.id;
    document.getElementById('qa-input-title').value = item.title;
    document.getElementById('qa-input-url').value = item.url;
    document.getElementById('qa-input-icon').value = item.icon;
    document.getElementById('qa-input-browser-mode').value = item.browserMode;
    document.getElementById('qa-input-browser-path').value = item.browserPath;
    
    toggleQaBrowserPath();
    applyTranslations();
    document.getElementById('modal-quick-access').classList.add('active');
}

function deleteQuickAccess(id) {
    const msg = t('confirm_delete_qa', 'Are you sure you want to delete this link?');
    openConfirmModal(msg, async () => {
        const data = await apiCall(`/api/quick-access/${id}`, { method: 'DELETE' });
        if (data && data.success) {
            showToast(data.message, 'success');
            loadQuickAccess();
        }
    }, t('btn_yes_delete', 'Yes, Delete'), true);
}

async function moveQuickAccess(id, direction) {
    const data = await apiCall('/api/quick-access/move', {
        method: 'POST',
        body: JSON.stringify({ id, direction })
    });
    if (data && data.success) {
        loadQuickAccess();
    }
}

async function openUrlInBrowser(url, browserMode = '', browserPath = '') {
    await apiCall('/api/open-url', {
        method: 'POST',
        body: JSON.stringify({ url, browserMode, browserPath })
    });
}

function openApacheGuideModal() {
    document.getElementById('modal-apache-guide').classList.add('active');
    if (window.lucide) lucide.createIcons();
}

function closeApacheGuideModal() {
    document.getElementById('modal-apache-guide').classList.remove('active');
}

function openPhpGuideModal() {
    document.getElementById('modal-php-guide').classList.add('active');
    if (window.lucide) lucide.createIcons();
}

function closePhpGuideModal() {
    document.getElementById('modal-php-guide').classList.remove('active');
}

function openMysqlGuideModal() {
    document.getElementById('modal-mysql-guide').classList.add('active');
    if (window.lucide) lucide.createIcons();
}

function closeMysqlGuideModal() {
    document.getElementById('modal-mysql-guide').classList.remove('active');
}
