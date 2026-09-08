import { EXT, VERSION, ROOT_ID } from '../constants.js';
import { state, saveSettingsLocal } from '../state.js';
import { escapeHtml, computeReadableInk } from '../util.js';
import {
    getPersonaData, deletePersonaById, confirmDeletePersona, invalidatePersonaCache, syncPersonasFromAvatarFiles
} from '../persona-data.js';
import {
    getSameNameGroups, getExactDuplicateGroups, getSimilarPairs
} from '../similarity.js';
import { checkForUpdates, showUpdateModal, scheduleAutoUpdateCheck } from '../update.js';
import {
    renderAllView, renderSameNameView, renderDuplicateView, renderSimilarView, renderCard
} from './components.js';
import { renderCompareWorkspace } from './compare.js';
import { openFullEditor } from './editor.js';

export function tabButton(key, label, icon, count) {
    const extra = key === 'settings' && state.updateInfo?.available
        ? '<em class="pmp18-new">NEW</em>'
        : (typeof count === 'number' ? `<em>${count}</em>` : '');
    return `<button class="pmp18-tab ${state.tab === key ? 'is-active' : ''}" type="button" data-action="tab" data-tab="${key}"><i class="fa-solid ${icon}"></i><span>${label}</span>${extra}</button>`;
}

export function renderSettingsPanel() {
    const t = Math.round(state.settings.similarityThreshold * 100);
    const soft = Math.round((state.settings.softMatchThreshold ?? 0.35) * 100);
    const upd = state.updateInfo;
    let tip = '';
    if (upd?.available) {
        tip = `<div class="pmp18-muted" style="margin-bottom:10px">发现新版本 v${escapeHtml(String(upd.remoteVersion))} — 点击左上角版本号查看并更新</div>`;
    } else if (upd?.error) {
        tip = `<div class="pmp18-muted" style="margin-bottom:10px">无法检查更新（不影响使用）。可点左上角版本号重试。</div>`;
    }

    return `
        <div class="pmp18-settings">
            ${tip}
            <div class="pmp18-settings-row">
                <label>相似检测阈值 <b id="pmp18-th-val">${t}%</b></label>
                <input type="range" id="pmp18-threshold" min="30" max="90" step="5" value="${t}">
            </div>
            <div class="pmp18-settings-row">
                <label>段落匹配敏感度 <b id="pmp18-soft-val">${soft}%</b></label>
                <input type="range" id="pmp18-soft" min="20" max="70" step="5" value="${soft}">
            </div>
            <div class="pmp18-settings-row">
                <label class="pmp18-check-label">
                    <input type="checkbox" id="pmp18-same-name" ${state.settings.includeSameNameInSimilar ? 'checked' : ''}>
                    同名也参与「高度相似」检测
                </label>
            </div>
        </div>`;
}

export function renderManagerContent(personas) {
    if (state.tab === 'settings') return renderSettingsPanel();
    if (state.tab === 'all') return renderAllView(personas);
    if (state.tab === 'same-name') return renderSameNameView(personas);
    if (state.tab === 'duplicates') return renderDuplicateView(personas);
    return renderSimilarView(personas);
}

/** In-place update of the bottom selection hint. No full re-render, so the
 *  page never scrolls. Insert the bar if missing, remove it if no longer needed. */
export function updateSelectionHint(root) {
    if (!root) return;
    const windowEl = root.querySelector('.pmp18-window');
    if (!windowEl) return;
    let bar = windowEl.querySelector('.pmp18-selection-bar');
    const n = state.selected.size;
    const html = n >= 2
        ? `<div class="pmp18-selection-bar">
            <div><strong>已选 ${n} 个</strong><span>对比时一次细比一个对方，可切换</span></div>
            <button class="pmp18-primary-btn" data-action="compare-selected">开始对比</button>
            <button class="pmp18-small-btn pmp18-danger-btn" data-action="delete-selected">删除所选</button>
            <button class="pmp18-small-btn" data-action="clear-selection">清除</button>
           </div>`
        : n === 1
            ? `<div class="pmp18-selection-bar"><div><strong>已选 1 个</strong><span>可再选以对比，或直接删除</span></div>
            <button class="pmp18-small-btn pmp18-danger-btn" data-action="delete-selected">删除所选</button>
            <button class="pmp18-small-btn" data-action="clear-selection">清除</button></div>`
            : '';
    if (!html) {
        if (bar) bar.remove();
        return;
    }
    if (!bar) {
        bar = document.createElement('div');
        windowEl.appendChild(bar);
    }
    bar.outerHTML = html;
}

// rAF-coalesced render: many events in the same frame collapse to one render.
// Critical for native persona dropdown opening (PERSONA_UPDATED may fire a
// burst of events when ST refreshes its UI).
let _renderScheduled = false;
export function scheduleRender() {
    if (_renderScheduled) return;
    _renderScheduled = true;
    requestAnimationFrame(() => {
        _renderScheduled = false;
        renderManager();
    });
}

export function renderManager() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    try {
        renderManagerInner();
    } catch (e) {
        // Render errors must NEVER leave the manager in a half-rendered state
        // (frozen page, no UI, body scroll locked). Fall back to a minimal
        // error screen so the user can close it.
        console.error(`[${EXT}] render failed`, e);
        try {
            root.innerHTML = `
                <div class="pmp18-backdrop" data-action="close"></div>
                <section class="pmp18-window" role="dialog" aria-modal="true">
                    <header class="pmp18-header">
                        <div class="pmp18-brand">
                            <div class="pmp18-brand-icon"><i class="fa-solid fa-users-viewfinder"></i></div>
                            <div>
                                <h1>Persona Manager</h1>
                                <button type="button" class="pmp18-version-btn" data-action="open-update-modal" title="更新日志 / 检查更新">v${VERSION}</button>
                            </div>
                        </div>
                        <div class="pmp18-header-actions">
                            <button class="pmp18-icon-btn pmp18-close" type="button" data-action="close" aria-label="关闭"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    </header>
                    <main class="pmp18-content" style="padding:24px">
                        <div class="pmp18-empty" style="min-height:200px;text-align:left;align-items:flex-start">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                            <strong>渲染失败</strong>
                            <span style="font-size:12px;opacity:.6;white-space:pre-wrap">${escapeHtml((e && e.stack) || String(e))}</span>
                            <button class="pmp18-primary-btn" data-action="close" style="margin-top:8px">关闭</button>
                        </div>
                    </main>
                </section>`;
        } catch (_) {
            // Last resort: blank the root and restore body scroll
            root.innerHTML = '';
            document.body.classList.remove('pmp18-open');
        }
    }
}

export function renderManagerInner() {
    const root = document.getElementById(ROOT_ID);
    const personas = getPersonaData();
    const sameNameGroups = getSameNameGroups(personas);
    const duplicateGroups = getExactDuplicateGroups(personas);
    const similarCount = state.tab === 'similar' ? getSimilarPairs(personas).length : 0;
    const inCompare = state.compareIds.length >= 2;

    // Preserve scroll position across re-renders. innerHTML replacement resets
    // scrollTop to 0 on every click (tab switch, baseline/other change, search
    // typing, checkbox toggle, etc.). On mobile compare page this is especially
    // painful because the workspace scrolls as a whole.
    const prevContent = root.querySelector('.pmp18-content');
    const prevCompare = root.querySelector('.pmp18-compare-workspace');
    const savedScroll = {
        content: prevContent ? prevContent.scrollTop : 0,
        compare: prevCompare ? prevCompare.scrollTop : 0,
    };
    const savedTabBar = root.querySelector('.pmp18-tabs');
    const savedTabScroll = savedTabBar ? savedTabBar.scrollLeft : 0;
    const focusKey = document.activeElement?.dataset?.pmp18KeepFocus;
    const focusSel = focusKey ? document.activeElement?.selectionStart : null;
    const focusEnd = focusKey ? document.activeElement?.selectionEnd : null;

    const selectionHint = state.selected.size >= 2
        ? `<div class="pmp18-selection-bar">
            <div><strong>已选 ${state.selected.size} 个</strong><span>对比时一次细比一个对方，可切换</span></div>
            <button class="pmp18-primary-btn" data-action="compare-selected">开始对比</button>
            <button class="pmp18-small-btn pmp18-danger-btn" data-action="delete-selected">删除所选</button>
            <button class="pmp18-small-btn" data-action="clear-selection">清除</button>
           </div>`
        : state.selected.size === 1
            ? `<div class="pmp18-selection-bar"><div><strong>已选 1 个</strong><span>可再选以对比，或直接删除</span></div>
            <button class="pmp18-small-btn pmp18-danger-btn" data-action="delete-selected">删除所选</button>
            <button class="pmp18-small-btn" data-action="clear-selection">清除</button></div>`
            : '';

    root.innerHTML = `
        <div class="pmp18-backdrop" data-action="close"></div>
        <section class="pmp18-window" role="dialog" aria-modal="true">
            <header class="pmp18-header">
                <div class="pmp18-brand">
                    <div class="pmp18-brand-icon"><i class="fa-solid fa-users-viewfinder"></i></div>
                    <div>
                        <h1>Persona Manager</h1>
                        <button type="button" class="pmp18-version-btn" data-action="open-update-modal" title="更新日志 / 检查更新">v${VERSION}${state.updateInfo?.available ? '<em class="pmp18-new">NEW</em>' : ''}</button>
                    </div>
                </div>
                <div class="pmp18-header-actions">
                    <button class="pmp18-icon-btn" type="button" data-action="refresh-list" title="刷新人设列表" aria-label="刷新"><i class="fa-solid fa-rotate"></i></button>
                    <button class="pmp18-icon-btn pmp18-close" type="button" data-action="close" title="关闭" aria-label="关闭"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </header>
            ${inCompare ? `<main class="pmp18-content pmp18-content--compare">${renderCompareWorkspace(personas)}</main>` : `
            <div class="pmp18-toolbar">
                <div class="pmp18-search">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input id="pmp18-search" data-pmp18-keep-focus="search" type="search" value="${escapeHtml(state.query)}" placeholder="搜索…" autocomplete="off">
                    ${state.query ? '<button data-action="clear-search"><i class="fa-solid fa-xmark"></i></button>' : ''}
                </div>
                <div class="pmp18-stats">
                    <span><b>${personas.length}</b> 全部</span>
                    <span><b>${sameNameGroups.length}</b> 同名</span>
                    <span><b>${duplicateGroups.length}</b> 重复</span>
                    ${state.tab === 'similar' ? `<span><b>${similarCount}</b> 相似</span>` : ''}
                    <button type="button" class="pmp18-density-btn" data-action="toggle-density" title="列表疏密">${state.listDensity === 'compact' ? '紧凑' : '舒适'}</button>
                </div>
            </div>
            <nav class="pmp18-tabs">
                ${tabButton('all', '全部', 'fa-layer-group')}
                ${tabButton('same-name', '同名', 'fa-people-group', sameNameGroups.length)}
                ${tabButton('duplicates', '完全重复', 'fa-copy', duplicateGroups.length)}
                ${tabButton('similar', '高度相似', 'fa-clone')}
                ${tabButton('settings', '设置', 'fa-sliders')}
            </nav>
            <main class="pmp18-content">${renderManagerContent(personas)}</main>
            ${selectionHint}`}
        </section>`;

    // Restore scroll positions. Use rAF so the browser has finished layout.
    requestAnimationFrame(() => {
        const newContent = root.querySelector('.pmp18-content');
        if (newContent) newContent.scrollTop = savedScroll.content;
        const newCompare = root.querySelector('.pmp18-compare-workspace');
        if (newCompare) newCompare.scrollTop = savedScroll.compare;
        const newTabBar = root.querySelector('.pmp18-tabs');
        if (newTabBar) newTabBar.scrollLeft = savedTabScroll;
        // v1.9.15: fold long same blocks for mobile reading
        applyFoldDefaults(root);
        bindGlobalKeys(root);
        applyAdaptiveInk(root);
        if (focusKey) {
            const el = root.querySelector(`[data-pmp18-keep-focus="${CSS.escape(focusKey)}"]`);
            if (el) {
                el.focus();
                if (focusSel != null && typeof el.setSelectionRange === 'function') {
                    try { el.setSelectionRange(focusSel, focusEnd); } catch { /* ignore */ }
                }
            }
        }
    });
}

/**
 * Guarantee readable text on surfaces whose background comes from ST theme
 * variables. ST pairs --SmartThemeBodyColor with --SmartThemeBlurTintColor
 * only for well-formed themes; when the blur tint is missing (falls back to
 * white) while BodyColor is white (dark theme), text vanishes. Compute the
 * actual rendered background luminance and pin the ink color (dark on light,
 * light on dark), mirroring ST's own --SmartThemeCheckboxTickColor approach.
 */
function applyAdaptiveInk(root) {
    const windowEl = root.querySelector('.pmp18-window');
    const windowBg = windowEl ? getComputedStyle(windowEl).backgroundColor : null;
    const fallbackBg = windowBg || '#ffffff';
    const ink = computeReadableInk(windowBg, fallbackBg);
    root.style.setProperty('--pmp18-ink', ink);
    if (windowEl) windowEl.style.color = ink;
    root.querySelectorAll('.pmp18-card, .pmp18-editor').forEach(el => {
        const bg = getComputedStyle(el).backgroundColor;
        // 卡片在 CSS 里默认偏浅底；半透明时按白底算对比，避免白底浅字
        const cardInk = computeReadableInk(bg, '#ffffff');
        el.style.setProperty('--pmp18-card-ink', cardInk);
        el.style.color = cardInk;
    });
}

// v1.9.15: fold long same blocks for mobile reading. Walk each hcol-body,
// find runs of 3+ same-class blocks, mark all but the first as folded.
// Idempotent: marks are reset on each render.

function bindGlobalKeys(root) {
    if (root.dataset.pmp18Keys) return;
    root.dataset.pmp18Keys = '1';
    document.addEventListener('keydown', (e) => {
        if (!state.active) return;
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
        if (e.key === 'Escape') {
            if (state.compareIds.length >= 2) {
                state.compareIds = [];
                state.baselineId = null;
                state.focusOtherId = null;
                renderManager();
            } else {
                closeManager();
            }
            e.preventDefault();
            return;
        }
        if (state.compareIds.length >= 2 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            const ids = state.compareIds.filter(id => id !== state.baselineId);
            if (!ids.length) return;
            let idx = ids.indexOf(state.focusOtherId);
            if (idx < 0) idx = 0;
            else idx = e.key === 'ArrowRight' ? (idx + 1) % ids.length : (idx - 1 + ids.length) % ids.length;
            state.focusOtherId = ids[idx];
            renderManager();
            e.preventDefault();
            return;
        }
        if (e.key === 'Enter' && state.selected.size >= 2 && state.compareIds.length < 2) {
            state.compareIds = [...state.selected];
            state.baselineId = state.compareIds[0];
            state.focusOtherId = null;
            state.compareChromeOpen = false;
            renderManager();
            e.preventDefault();
        }
    });
}

function applyFoldDefaults(root) {
    const FOLD_MIN = 3;
    const bodies = root.querySelectorAll('.pmp18-hcol-body');
    bodies.forEach(body => {
        const blocks = body.querySelectorAll('.pmp18-col-block.same');
        blocks.forEach(b => b.classList.remove('is-folded'));
        let run = [];
        for (const b of blocks) {
            if (run.length === 0) { run.push(b); continue; }
            const prev = run[run.length - 1];
            if (prev.nextElementSibling === b) { run.push(b); continue; }
            // Run ended — apply fold if length >= FOLD_MIN
            if (run.length >= FOLD_MIN) {
                for (let i = 1; i < run.length; i++) run[i].classList.add('is-folded');
            }
            run = [b];
        }
        // tail
        if (run.length >= FOLD_MIN) {
            for (let i = 1; i < run.length; i++) run[i].classList.add('is-folded');
        }
    });
    // One-time global click handler for fold toggle
    if (!root.dataset.boundFold) {
        root.dataset.boundFold = '1';
        root.addEventListener('click', (e) => {
            const block = e.target.closest('.pmp18-col-block.same');
            if (!block) return;
            if (window.getSelection && String(window.getSelection()) !== '') return;
            block.classList.toggle('is-folded');
        });
    }
}


/* ---------- 根节点事件委托 ---------- */

export function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
        root = document.createElement('div');
        root.id = ROOT_ID;
        root.hidden = true;
        document.body.appendChild(root);
    }
    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    // dblclick on compare cards: open editor for the card's persona
    root.addEventListener('dblclick', event => {
        const target = event.target.closest('[data-dblaction]');
        if (!target) return;
        const action = target.dataset.dblaction;
        const id = String(target.dataset.id2 || target.dataset.id || '');
        if (!id) return;
        if (action === 'edit-full') {
            // Cancel any pending deferred focus-reorder so it never fires after the editor opens
            clearTimeout(root._pmp18FocusTimer);
            clearTimeout(root._pmp18BaselineTimer);
            // Don't bubble to click handler (which would set baseline / focus other)
            event.preventDefault();
            event.stopPropagation();
            openFullEditor(id);
        }
    });

    root.addEventListener('pointerup', event => {
        const vbtn = event.target.closest('[data-action="open-update-modal"]');
        if (!vbtn || !root.contains(vbtn)) return;
        if (event.pointerType === 'touch' || event.pointerType === 'pen') {
            event.preventDefault();
            event.stopPropagation();
            root.dataset.pmp18SkipVersionClick = '1';
            try { showUpdateModal(); } catch (err) { console.error(err); }
            setTimeout(() => { delete root.dataset.pmp18SkipVersionClick; }, 400);
        }
    }, { passive: false });

    root.addEventListener('click', event => {
        const target = event.target.closest('[data-action]');
        if (!target) return;
        const action = target.dataset.action;

        if (action === 'close') {
            if (target.classList.contains('pmp18-backdrop') || target.closest('[data-action="close"]')) closeManager();
            return;
        }
        if (action === 'tab') {
            state.tab = target.dataset.tab || 'all';
            state.selected.clear();
            state.compareIds = [];
            state.baselineId = null;
            state.focusOtherId = null;
            if (state.tab === 'settings' && !state.updateInfo?.checked) checkForUpdates();
            renderManager();
            return;
        }
        if (action === 'refresh-list') {
            invalidatePersonaCache('manual-refresh');
            if (typeof toastr !== 'undefined') toastr.info('已刷新人设列表');
            renderManager();
            return;
        }
        if (action === 'clear-search') { state.query = ''; renderManager(); return; }
        if (action === 'clear-selection') {
            state.selected.clear();
            // In-place: uncheck all cards, remove selection hint, do not re-render
            const root = document.getElementById(ROOT_ID);
            if (root) {
                root.querySelectorAll('.pmp18-card.is-selected').forEach(c => c.classList.remove('is-selected'));
                root.querySelectorAll('input[data-action="select"]').forEach(i => { i.checked = false; });
                updateSelectionHint(root);
            }
            return;
        }
        if (action === 'select-group') {
            const ids = (target.dataset.ids || '').split('|').filter(Boolean);
            let allSelected = ids.length > 0 && ids.every(id => state.selected.has(String(id)));
            for (const id of ids) {
                const sid = String(id);
                if (allSelected) state.selected.delete(sid);
                else state.selected.add(sid);
            }
            // In-place update for current visible cards; if filter changes anything,
            // a re-render is required (cards outside the filter are not in the DOM).
            const root = document.getElementById(ROOT_ID);
            if (root) {
                for (const id of ids) {
                    const sid = String(id);
                    const card = root.querySelector(`.pmp18-card[data-persona-id="${CSS.escape(sid)}"]`);
                    if (card) {
                        card.classList.toggle('is-selected', state.selected.has(sid));
                        const cb = card.querySelector('input[data-action="select"]');
                        if (cb) cb.checked = state.selected.has(sid);
                    }
                }
                updateSelectionHint(root);
            }
            return;
        }
        if (action === 'compare-pair') {
            state.compareIds = [String(target.dataset.a), String(target.dataset.b)];
            state.baselineId = String(target.dataset.a);
            state.focusOtherId = String(target.dataset.b);
            state.selected.clear();
            state.showToc = false;
            state.compareChromeOpen = false;
            renderManager();
            return;
        }
        if (action === 'compare-selected') {
            const ids = [...state.selected].map(String);
            if (ids.length < 2) return;
            state.compareIds = ids;
            state.baselineId = ids[0];
            state.focusOtherId = null;
            state.selected.clear();
            state.showToc = false;
            state.compareChromeOpen = false;
            renderManager();
            return;
        }
        if (action === 'exit-compare') {
            state.compareIds = [];
            state.baselineId = null;
            state.focusOtherId = null;
            renderManager();
            return;
        }
        if (action === 'set-baseline') {
            const id = String(target.dataset.id);
            // A real double-click reorders the DOM on the first click, which would
            // make the second click land on a different element and suppress the
            // browser's dblclick. Defer the re-render so a fast second click can
            // still be recognized as a double-click (handled by the dblclick path).
            if (event.detail >= 2) {
                clearTimeout(root._pmp18BaselineTimer);
                return;
            }
            clearTimeout(root._pmp18BaselineTimer);
            root._pmp18BaselineTimer = setTimeout(() => {
                delete root._pmp18BaselineTimer;
                if (!state.active || root.hidden) return;
                state.baselineId = id;
                if (state.focusOtherId === id) state.focusOtherId = null;
                // focus may still be valid if it remains in others
                if (state.focusOtherId && state.focusOtherId === id) state.focusOtherId = null;
                renderManager();
            }, 280);
            return;
        }
        if (action === 'set-focus-other') {
            const id = String(target.dataset.id);
            // Cards that also carry data-dblaction must defer the focus-toggle +
            // re-render, otherwise the first click reorders the DOM under the
            // cursor and the browser's native dblclick never fires on the second
            // click (it lands on a different element). Mobile thumbs have no
            // dblaction, so keep their single-click focus immediate.
            if (target.closest('[data-dblaction]')) {
                if (event.detail >= 2) {
                    clearTimeout(root._pmp18FocusTimer);
                    return;
                }
                clearTimeout(root._pmp18FocusTimer);
                root._pmp18FocusTimer = setTimeout(() => {
                    delete root._pmp18FocusTimer;
                    if (!state.active || root.hidden) return;
                    state.focusOtherId = (state.focusOtherId === id) ? null : id;
                    renderManager();
                }, 280);
            } else {
                state.focusOtherId = (state.focusOtherId === id) ? null : id;
                renderManager();
            }
            return;
        }
        if (action === 'set-view-mode') {
            state.viewMode = target.dataset.mode === 'stacked' ? 'stacked' : 'side';
            renderManager();
            return;
        }
        if (action === 'toggle-compare-chrome') {
            state.compareChromeOpen = !state.compareChromeOpen;
            renderManager();
            return;
        }
        if (action === 'toggle-toc') {
            state.showToc = !state.showToc;
            if (!state.showToc) state.tocQuery = '';
            renderManager();
            return;
        }
        if (action === 'close-toc') {
            state.showToc = false;
            state.tocQuery = '';
            renderManager();
            return;
        }
        if (action === 'toc-jump') {
            handleTocJump(target);
            return;
        }
        
        if (action === 'toggle-density') {
            state.listDensity = state.listDensity === 'compact' ? 'comfy' : 'compact';
            renderManager();
            return;
        }
        if (action === 'toggle-group-fold') {
            const key = String(target.dataset.key || '');
            state.groupFold[key] = !state.groupFold[key];
            renderManager();
            return;
        }
        if (action === 'jump-share') {
            const snip = String(target.dataset.snippet || '').trim();
            if (!snip) return;
            const rootEl = document.getElementById(ROOT_ID);
            if (!rootEl) return;
            const marks = Array.from(rootEl.querySelectorAll('mark.pmp18-share, mark'));
            const matched = marks.filter(m => {
                const t = (m.textContent || '').replace(/\s+/g, ' ').trim();
                return t === snip || t.includes(snip) || snip.includes(t);
            });
            if (!matched.length) return;
            matched.forEach(m => {
                m.classList.add('pmp18-toc-flash');
                m.classList.add('pmp18-flash');
                setTimeout(() => {
                    m.classList.remove('pmp18-toc-flash');
                    m.classList.remove('pmp18-flash');
                }, 1600);
            });
            const inOther = matched.find(m => m.closest('.pmp18-multi-other-card, .pmp18-other-col, .pmp18-obj-card'));
            const inBase = matched.find(m => m.closest('.pmp18-multi-base-fixed, .pmp18-base-col, .pmp18-base-card'));
            (inOther || matched[matched.length - 1]).scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            if (inBase && inBase !== inOther) {
                try { inBase.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch { /* ignore */ }
            }
            return;
        }

        if (action === 'toggle-diff-only') {
            state.settings.showDiffOnly = !state.settings.showDiffOnly;
            saveSettingsLocal();
            renderManager();
            return;
        }
        if (action === 'edit-full') {
            openFullEditor(String(target.dataset.id || ''));
            return;
        }
        if (action === 'delete-persona') {
            const id = String(target.dataset.id || '');
            const p = getPersonaData().find(x => x.id === id);
            const label = p ? `${p.name}${p.title ? `（${p.title}）` : ''}` : id;
            (async () => {
                const ok = await confirmDeletePersona(label, id);
                if (!ok) return;
                try {
                    const done = await deletePersonaById(id);
                    if (done) {
                        if (typeof toastr !== 'undefined') toastr.success(`已删除：${label}`);
                    } else if (typeof toastr !== 'undefined') {
                        toastr.error('删除失败');
                    }
                } catch (e) {
                    console.error(e);
                    if (typeof toastr !== 'undefined') toastr.error(`删除失败：${e?.message || e}`);
                } finally {
                    // Always keep manager open and refresh list
                    state.active = true;
                    ensureRoot();
                    const root = document.getElementById(ROOT_ID);
                    if (root) {
                        root.hidden = false;
                        document.body.classList.add('pmp18-open');
                    }
                    renderManager();
                }
            })();
            return;
        }
        if (action === 'delete-selected') {
            const ids = [...state.selected].map(String);
            if (!ids.length) return;
            (async () => {
                const label = `已选 ${ids.length} 个人设`;
                const ok = await confirmDeletePersona(label, ids.slice(0, 5).join(', ') + (ids.length > 5 ? '…' : ''));
                if (!ok) return;
                let okN = 0;
                let failN = 0;
                for (const id of ids) {
                    try {
                        const done = await deletePersonaById(id);
                        if (done) okN += 1;
                        else failN += 1;
                    } catch (e) {
                        console.error(e);
                        failN += 1;
                    }
                }
                state.selected.clear();
                if (typeof toastr !== 'undefined') {
                    if (okN) toastr.success(`已删除 ${okN} 个` + (failN ? `，失败 ${failN} 个` : ''));
                    else toastr.error(`删除失败（${failN}）`);
                }
                state.active = true;
                ensureRoot();
                const root = document.getElementById(ROOT_ID);
                if (root) {
                    root.hidden = false;
                    document.body.classList.add('pmp18-open');
                }
                renderManager();
            })();
            return;
        }
        if (action === 'open-update-modal') {
            if (root.dataset.pmp18SkipVersionClick) return;
            event.preventDefault();
            event.stopPropagation();
            try {
                showUpdateModal();
            } catch (err) {
                console.error('[Persona Manager] open update modal failed', err);
                if (typeof toastr !== 'undefined') toastr.error('无法打开更新窗口');
            }
            return;
        }
        if (action === 'check-update') {
            checkForUpdates();
            return;
        }
        if (action === 'show-update-modal') {
            if (!state.updateInfo?.changelog && !state.updateInfo?.checking) {
                checkForUpdates().then(() => showUpdateModal());
            } else showUpdateModal();
            return;
        }
    });

    root.addEventListener('change', event => {
        const input = event.target.closest('input[data-action="select"]');
        if (input) {
            const id = String(input.dataset.id || input.closest('[data-persona-id]')?.dataset?.personaId || '');
            if (!id) return;
            if (input.checked) state.selected.add(id);
            else state.selected.delete(id);
            // In-place update: avoid full re-render so scroll position is not reset
            // on mobile, and the checkbox does not "jump" to the top of the list.
            const card = input.closest('.pmp18-card');
            if (card) card.classList.toggle('is-selected', input.checked);
            updateSelectionHint(root);
            return;
        }
        if (event.target.id === 'pmp18-same-name') {
            state.settings.includeSameNameInSimilar = event.target.checked;
            saveSettingsLocal();
            renderManager();
        }
    });

    root.addEventListener('input', event => {
        if (event.target.id === 'pmp18-search') {
            state.query = event.target.value;
            const caret = event.target.selectionStart;
            renderManager();
            const next = document.getElementById('pmp18-search');
            if (next) next.setSelectionRange(caret, caret);
            return;
        }
        if (event.target.id === 'pmp18-toc-search') {
            state.tocQuery = event.target.value;
            // In-place: just refresh the toc body, don't re-render the whole manager
            const root = document.getElementById(ROOT_ID);
            const panel = root?.querySelector('.pmp18-toc-panel .pmp18-toc-body');
            if (panel) {
                // Re-derive list using the same logic as renderTocPanel
                // but cheaper: just toggle visibility via a re-render of toc body.
                // Easiest: schedule a render and let the new HTML replace.
                scheduleRender();
            }
            return;
        }
        if (event.target.id === 'pmp18-threshold') {
            state.settings.similarityThreshold = Math.min(0.9, Math.max(0.3, Number(event.target.value) / 100));
            saveSettingsLocal();
            const label = document.getElementById('pmp18-th-val');
            if (label) label.textContent = `${Math.round(state.settings.similarityThreshold * 100)}%`;
            return;
        }
        if (event.target.id === 'pmp18-soft') {
            state.settings.softMatchThreshold = Math.min(0.7, Math.max(0.2, Number(event.target.value) / 100));
            saveSettingsLocal();
            const label = document.getElementById('pmp18-soft-val');
            if (label) label.textContent = `${Math.round(state.settings.softMatchThreshold * 100)}%`;
        }
    });
}

// TOC click handler — scroll the matching block into view and flash it.
function handleTocJump(target) {
    const jump = String(target.dataset.tocJump || '');
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    let sel = null;
    if (jump.startsWith('row-')) {
        // The TOC index and the rendered block index may not align because the
        // TOC was built from unorderedDiff rows but the rendered blocks are
        // post-processed (ghost + showDiffOnly filters). We do a best-effort
        // match by counting block tags that match the type from the dataset.
        const idx = parseInt(jump.slice(4), 10) || 0;
        const blocks = root.querySelectorAll('.pmp18-hcol-body .pmp18-col-block');
        // Use the visible blocks only (skip pmp18-ghost)
        const visible = Array.from(blocks).filter(b => !b.classList.contains('pmp18-ghost'));
        // The TOC was built from full rows; visible might differ — fall back
        // to a best-effort by walking all blocks.
        const candidates = Array.from(blocks);
        sel = candidates[idx] || null;
    } else if (jump.startsWith('share-')) {
        // 按芯片文案匹配两侧所有 mark（不能只用 document 序的第 idx 个——那往往只在基准里）
        const snippet = (target.textContent || '').replace(/\s+/g, ' ').trim();
        const allMarks = Array.from(root.querySelectorAll('mark.pmp18-share'));
        const matched = snippet
            ? allMarks.filter(m => (m.textContent || '').replace(/\s+/g, ' ').trim() === snippet)
            : [];
        const idx = parseInt(jump.slice(6), 10) || 0;
        if (matched.length) {
            matched.forEach(m => {
                m.classList.add('pmp18-toc-flash');
                setTimeout(() => m.classList.remove('pmp18-toc-flash'), 1600);
            });
            // 优先滚到对象侧，再保证基准侧也在视野内
            const inOther = matched.find(m => m.closest('.pmp18-multi-other-card, .pmp18-other-col, .pmp18-obj-card, [data-side="other"]'));
            const inBase = matched.find(m => m.closest('.pmp18-multi-base-fixed, .pmp18-base-col, .pmp18-base-card, [data-side="base"]'));
            (inOther || matched[matched.length - 1])?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            if (inBase && inBase !== inOther) {
                try { inBase.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); } catch { /* ignore */ }
            }
            return;
        }
        sel = allMarks[idx] || null;
    }
    if (!sel) return;
    sel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    sel.classList.add('pmp18-toc-flash');
    setTimeout(() => sel.classList.remove('pmp18-toc-flash'), 1500);
    // Also try to highlight search matches if any
    if (state.tocQuery) {
        const q = state.tocQuery.toLowerCase();
        root.querySelectorAll('.pmp18-hcol-body mark.pmp18-search-hit').forEach(m => {
            m.outerHTML = m.innerHTML;
        });
        const walker = document.createTreeWalker(root.querySelector('.pmp18-hcol-body') || root, NodeFilter.SHOW_TEXT, null);
        const nodes = [];
        let n;
        while ((n = walker.nextNode())) nodes.push(n);
        for (const node of nodes) {
            const lower = node.nodeValue.toLowerCase();
            const i = lower.indexOf(q);
            if (i < 0) continue;
            const before = node.nodeValue.slice(0, i);
            const hit = node.nodeValue.slice(i, i + q.length);
            const after = node.nodeValue.slice(i + q.length);
            const span = document.createElement('mark');
            span.className = 'pmp18-search-hit';
            span.textContent = hit;
            const parent = node.parentNode;
            parent.insertBefore(document.createTextNode(before), node);
            parent.insertBefore(span, node);
            parent.insertBefore(document.createTextNode(after), node);
            parent.removeChild(node);
        }
    }
}

export function openManager(tab = 'all') {
    ensureRoot();
    state.active = true;
    scheduleAutoUpdateCheck();
    if (state.viewMode !== 'stacked' && state.viewMode !== 'side') state.viewMode = 'side';
    state.tab = tab;
    state.selected.clear();
    state.compareIds = [];
    state.baselineId = null;
    state.focusOtherId = null;
    invalidatePersonaCache('openManager');
    const root = document.getElementById(ROOT_ID);
    root.hidden = false;
    document.body.classList.add('pmp18-open');
    renderManager();
    // Merge any new avatar files ST created while we were closed
    syncPersonasFromAvatarFiles().then(changed => {
        if (!state.active) return;
        invalidatePersonaCache('openManager-sync');
        renderManager();
    }).catch(() => {});
}

export function closeManager() {
    state.active = false;
    state.selected.clear();
    state.compareIds = [];
    state.baselineId = null;
    state.focusOtherId = null;
    const root = document.getElementById(ROOT_ID);
    if (root) {
        clearTimeout(root._pmp18FocusTimer);
        clearTimeout(root._pmp18BaselineTimer);
        root.hidden = true;
    }
    document.body.classList.remove('pmp18-open');
}

