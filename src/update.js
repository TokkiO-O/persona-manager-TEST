import { EXT, VERSION, ROOT_ID, REMOTE_MANIFEST_URLS, REMOTE_CHANGELOG_URLS } from './constants.js';
import { state } from './state.js';
import { escapeHtml, isRemoteNewer, compareSemver, computeReadableInk } from './util.js';


let _uiRefresh = () => {};
export function setUpdateUiRefresh(fn) {
    _uiRefresh = typeof fn === 'function' ? fn : () => {};
}
function refreshUi() {
    try { _uiRefresh(); } catch (e) { console.error(e); }
}


/* ---------- Updates (remote manifest + CHANGELOG.md) ---------- */

export async function fetchText(url) {
    const sep = url.includes('?') ? '&' : '?';
    // jsDelivr ignores random query on some paths; still helps GitHub raw CDN
    const u = `${url}${sep}t=${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
    try {
        const r = await fetch(u, {
            method: 'GET',
            mode: 'cors',
            cache: 'no-store',
            credentials: 'omit',
            signal: ctrl?.signal,
            headers: {
                'Accept': 'application/json,text/plain,*/*',
            },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Try multiple mirrors until one succeeds (GitHub raw often blocked). */
export async function fetchTextFromMirrors(urls) {
    const list = Array.isArray(urls) ? urls : [urls];
    const errors = [];
    for (const url of list) {
        try {
            let text = await fetchText(url);
            // GitHub Contents API returns JSON with base64 content
            if (url.includes('api.github.com') && url.includes('/contents/')) {
                const j = JSON.parse(text);
                if (j.content) {
                    text = atob(String(j.content).replace(/\s/g, ''));
                }
            }
            if (text != null && String(text).length) return { text: String(text), url };
        } catch (e) {
            errors.push(`${url} → ${e?.message || e}`);
            console.warn(`[${EXT}] mirror failed:`, url, e);
        }
    }
    throw new Error(errors.length ? errors.join(' | ') : 'no mirrors');
}

/** ST API calls need X-CSRF-Token or ForbiddenError: Invalid CSRF token */
export async function getStRequestHeaders() {
    try {
        if (typeof window.getRequestHeaders === 'function') {
            return window.getRequestHeaders();
        }
    } catch { /* ignore */ }
    try {
        const ctx = window.SillyTavern?.getContext?.();
        if (typeof ctx?.getRequestHeaders === 'function') {
            return ctx.getRequestHeaders();
        }
    } catch { /* ignore */ }
    let token = 'disabled';
    try {
        const r = await fetch('/csrf-token', { credentials: 'same-origin' });
        if (r.ok) {
            const data = await r.json();
            if (data?.token) token = data.token;
        }
    } catch { /* ignore */ }
    return {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
    };
}

export async function callExtensionUpdate() {
    const candidates = [];
    if (typeof window.updateExtension === 'function') {
        candidates.push(() => window.updateExtension('persona-manager'));
    }
    candidates.push(() => updateViaApi({ extensionName: 'persona-manager', global: false }));
    candidates.push(() => updateViaApi({ extensionName: 'persona-manager', global: true }));
    candidates.push(() => updateViaApi({ extensionName: 'third-party/Persona Manager', global: false }));
    candidates.push(() => updateViaApi({ extensionName: 'third-party/Persona-Manager', global: false }));
    candidates.push(() => updateViaApi({ extensionName: 'third-party/persona-manager', global: false }));

    let lastError = null;
    for (const run of candidates) {
        try {
            return await run();
        } catch (e) {
            lastError = e;
        }
    }
    throw new Error(
        `酒馆没找到本扩展目录，自动化更新失败。` +
        `\n请到 https://github.com/TokkiO-O/persona-manager 手动下载 zip，` +
        `解压覆盖到 data/default-user/extensions/ 下的人设管理文件夹。` +
        `\n（最近错误：${lastError?.message || lastError || '未知'}）`
    );
}

export async function updateViaApi(payload) {
    const headers = await getStRequestHeaders();
    const res = await fetch('/api/extensions/update', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    try {
        return text ? JSON.parse(text) : {};
    } catch {
        return { message: text };
    }
}

export async function checkForUpdates(options = {}) {
    const silent = Boolean(options?.silent);
    if (!silent) {
        state.updateInfo = { ...(state.updateInfo || {}), checking: true };
        if (state.tab === 'settings') refreshUi();
    }
    try {
        const manifestResults = [];
        for (const url of REMOTE_MANIFEST_URLS) {
            try {
                const text = await fetchText(url);
                const remote = JSON.parse(text);
                const rv = String(remote.version || '');
                if (rv) manifestResults.push({ remote, rv, url });
            } catch (e) {
                console.warn(`[${EXT}] manifest mirror fail`, url, e?.message || e);
            }
        }
        if (!manifestResults.length) throw new Error('全部更新源均失败');
        manifestResults.sort((a, b) => compareSemver(b.rv, a.rv));
        const best = manifestResults[0];
        const rv = best.rv;
        const remote = best.remote;
        const available = Boolean(rv && isRemoteNewer(rv, VERSION));

        // Changelog: try all mirrors, prefer text whose first/matching section contains best version
        let changelog = '';
        let changelogSource = '';
        const logCandidates = [];
        for (const url of REMOTE_CHANGELOG_URLS) {
            try {
                const text = await fetchText(url);
                if (text) logCandidates.push({ text, url });
            } catch (e) {
                console.warn(`[${EXT}] changelog mirror fail`, url, e?.message || e);
            }
        }
        if (logCandidates.length) {
            const scored = logCandidates.map(c => {
                const hasVer = c.text.includes(rv) || c.text.includes(`v${rv}`) || c.text.includes(`V${rv}`);
                return { ...c, hasVer };
            });
            scored.sort((a, b) => Number(b.hasVer) - Number(a.hasVer));
            changelog = scored[0].text;
            changelogSource = scored[0].url;
        } else {
            changelog = remote.description || '（无法获取 CHANGELOG.md）';
        }

        state.updateInfo = {
            checked: true,
            available,
            remoteVersion: rv,
            changelog,
            source: best.url,
            changelogSource,
            sourcesTried: manifestResults.map(r => r.rv),
            error: false,
            fetchedAt: Date.now(),
        };
        console.log(`[${EXT}] update check best=`, rv, 'manifest@', best.url, 'changelog@', changelogSource);
    } catch (e) {
        const msg = e?.message || String(e);
        state.updateInfo = {
            checked: true,
            available: false,
            error: true,
            message: msg,
            hint: '浏览器无法访问外网更新源。扩展可照常使用，请到 GitHub 手动下载覆盖安装。',
        };
        console.error(`[${EXT}] update check failed`, e);
    }
    if (state.active && !options?.skipRefresh) refreshUi();
    return state.updateInfo;
}

export function extractLatestChangelogSection(md) {
    return extractChangelogForVersion(md, null);
}

/**
 * Prefer the ## section that matches remoteVersion (e.g. 1.9.13 / v1.9.13).
 * Falls back to the first ## section.
 */
export function extractChangelogForVersion(md, version) {
    const text = String(md || '').replace(/^﻿/, '').trim();
    if (!text) return '（无日志）';
    const headingRe = /^##\s+.+$/gm;
    const matches = [...text.matchAll(headingRe)];
    if (!matches.length) {
        return text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text;
    }
    let idx = 0;
    if (version) {
        const ver = String(version).replace(/^[vV]/, '').trim();
        const found = matches.findIndex(m => m[0].includes(ver));
        if (found >= 0) idx = found;
    }
    const start = matches[idx].index;
    const end = matches[idx + 1] ? matches[idx + 1].index : text.length;
    return text.slice(start, end).trim();
}

export async function showUpdateModal() {
    document.querySelectorAll('.pmp18-update-overlay').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'pmp18-update-overlay';
    overlay.setAttribute('data-pmp18-update', '1');
    // 居中：不贴顶不贴底；padding 保证四周留白
    overlay.style.cssText = [
        'position:fixed',
        'top:0', 'left:0', 'right:0', 'bottom:0',
        'width:100%', 'height:100%',
        'z-index:2147483646',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'padding:max(16px, env(safe-area-inset-top, 0px)) 16px max(16px, env(safe-area-inset-bottom, 0px))',
        'box-sizing:border-box',
        'margin:0',
        'background:rgba(10,10,14,0.55)',
        'pointer-events:auto',
        '-webkit-tap-highlight-color:transparent',
    ].join(';');

    let allowBackdrop = false;
    const unlock = setTimeout(() => { allowBackdrop = true; }, 500);

    const paint = (info = {}) => {
        const log = extractChangelogForVersion(info.changelog || '', info.remoteVersion || VERSION);
        const available = Boolean(info.available);
        const checking = Boolean(info.checking);
        const err = info.error ? String(info.error) : '';
        // 中间卡片：宽度适中，不贴边
        const cardStyle = [
            'width:min(420px, calc(100vw - 48px))',
            'max-height:min(70vh, 70dvh)',
            'border-radius:16px',
            'overflow:hidden',
            'display:flex',
            'flex-direction:column',
            'background:var(--SmartThemeBlurTintColor, #1a1b22)',
            'color:var(--pmp18-ink, inherit)',
            'box-shadow:0 12px 40px rgba(0,0,0,0.4)',
            'margin:0',
        ].join(';');
        overlay.innerHTML = `
        <div class="pmp18-update-modal" role="dialog" aria-modal="true" style="${cardStyle}">
            <header class="pmp18-update-modal-header">
                <strong>${checking ? '正在检查更新…' : (available ? '发现新版本' : '更新日志')}</strong>
                <button type="button" class="pmp18-update-modal-x" data-close aria-label="关闭">×</button>
            </header>
            <div class="pmp18-update-modal-body">
                <p class="pmp18-update-modal-meta">当前 <b>v${VERSION}</b>${info.remoteVersion ? ` · 远程 <b>v${escapeHtml(String(info.remoteVersion))}</b>` : ''}</p>
                ${err ? `<p class="pmp18-update-err">${escapeHtml(err)}</p>` : ''}
                <pre class="pmp18-changelog">${escapeHtml(checking ? '正在拉取更新日志…' : (log || '（无日志）'))}</pre>
            </div>
            <footer class="pmp18-update-modal-footer">
                <button type="button" class="pmp18-small-btn" data-close>关闭</button>
                ${available && !checking ? '<button type="button" class="pmp18-primary-btn" data-do-update>更新</button>' : ''}
            </footer>
        </div>`;
        const close = (ev) => {
            if (ev) { ev.preventDefault(); ev.stopPropagation(); }
            clearTimeout(unlock);
            overlay.remove();
        };
        overlay.querySelectorAll('[data-close]').forEach(btn => { btn.onclick = close; });
        const modal = overlay.querySelector('.pmp18-update-modal');
        if (modal) {
            modal.addEventListener('click', e => e.stopPropagation());
            modal.addEventListener('touchend', e => e.stopPropagation());
            modal.style.setProperty('--pmp18-ink', computeReadableInk(getComputedStyle(modal).backgroundColor));
        }
        const doBtn = overlay.querySelector('[data-do-update]');
        if (doBtn) {
            doBtn.onclick = async (ev) => {
                ev.preventDefault();
                doBtn.disabled = true;
                doBtn.textContent = '更新中…';
                try {
                    await callExtensionUpdate();
                    doBtn.textContent = '完成，正在刷新…';
                    setTimeout(() => location.reload(), 500);
                } catch (e) {
                    doBtn.disabled = false;
                    doBtn.textContent = '更新';
                    if (typeof toastr !== 'undefined') toastr.error(`更新失败：${e?.message || e}`);
                }
            };
        }
    };

    paint({ ...(state.updateInfo || {}), checking: true });
    const onBackdrop = (e) => {
        if (e.target !== overlay) return;
        if (!allowBackdrop) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        clearTimeout(unlock);
        overlay.remove();
    };
    overlay.addEventListener('click', onBackdrop);
    overlay.addEventListener('touchend', onBackdrop, { passive: false });

    // 优先挂到扩展根节点（全屏 WebView 里比 body 更稳）；否则 body
    const root = document.getElementById(ROOT_ID);
    if (root && !root.hidden) {
        // 相对 root 铺满居中，避免被浏览器全屏层吃掉
        overlay.style.position = 'absolute';
        root.appendChild(overlay);
    } else {
        document.body.appendChild(overlay);
    }

    // 拉取时不要整页 refreshUi，否则会清掉挂在 root 里的弹层
    checkForUpdates({ silent: true, skipRefresh: true }).then(() => {
        if (!overlay.isConnected) return;
        paint({ ...(state.updateInfo || {}), checking: false });
    }).catch((e) => {
        if (!overlay.isConnected) return;
        paint({ ...(state.updateInfo || {}), checking: false, error: e?.message || String(e) });
    });
}

export function scheduleAutoUpdateCheck() {
    if (window.__pmp18UpdateChecked) return;
    window.__pmp18UpdateChecked = true;
    // Defer so first paint is not blocked
    setTimeout(() => {
        checkForUpdates({ silent: true }).catch(() => {});
    }, 800);
}
