import { state } from '../state.js';
import { escapeHtml } from '../util.js';
import { similarity } from '../similarity.js';
import {
    unorderedDiff, countPairStats, diffModeClass, shouldUseFragmentMode,
    isShortText, extractSharedSnippets, renderFragmentCompare, renderFocusBlocks,
    renderCompareLegend, highlightSnippets,
} from '../diff.js';
import { formatPersonaSubline } from '../persona-data.js';
import { renderAvatar, emptyState } from './components.js';
import { renderManagerContent } from './render.js';

/**
 * Multi-compare body:
 * - Baseline column fixed on the left
 * - All other personas as full-text cards in a horizontal scroller
 * - Click a card to focus: full diff highlight on baseline + that card
 * - Unfocused cards still show soft similarity (shared snippets) vs baseline
 * - focusOtherId may be null until user picks an object
 */
export function renderCompareWorkspace(personas) {
    const ids = state.compareIds.filter(id => personas.some(p => p.id === id));
    if (ids.length < 2) {
        state.compareIds = [];
        state.baselineId = null;
        state.focusOtherId = null;
        return renderManagerContent(personas);
    }
    if (!state.baselineId || !ids.includes(state.baselineId)) state.baselineId = ids[0];
    const others = ids.filter(id => id !== state.baselineId);
    // 仅 1 个对象：自动进入对比高亮；≥2 个对象：不默认选中，由用户点选
    if (others.length === 1) {
        state.focusOtherId = others[0];
    } else if (state.focusOtherId && !others.includes(state.focusOtherId)) {
        state.focusOtherId = null;
    }

    const base = personas.find(p => p.id === state.baselineId);
    if (!base) return emptyState('对比数据无效', '');

    const focusId = state.focusOtherId && others.includes(state.focusOtherId)
        ? state.focusOtherId
        : null;
    const focusPersona = focusId ? personas.find(p => p.id === focusId) : null;

    // Pair stats / fragment mode relative to focused other when set, else first other
    const pairOther = focusPersona || personas.find(p => p.id === others[0]);
    const score = pairOther ? similarity(base.description, pairOther.description) : 0;
    const shortMode = pairOther
        ? isShortText(base.description, pairOther.description)
        : false;
    const fragmentMode = pairOther
        ? shouldUseFragmentMode(base.description, pairOther.description, score)
        : false;
    const stats = (pairOther && !fragmentMode)
        ? countPairStats(unorderedDiff(base.description, pairOther.description))
        : (pairOther && fragmentMode)
            ? { same: extractSharedSnippets(base.description, pairOther.description, { shortMode }).length, replace: 0, remove: 0, add: 0 }
            : { same: 0, replace: 0, remove: 0, add: 0 };
    const mode = diffModeClass(score);
    const showDiffOnly = state.settings.showDiffOnly;

    // Shared panel + baseline body
    let sharePanel = '';
    let baseBody = '';
    let fragForToc = null;
    if (focusPersona) {
        if (fragmentMode) {
            const frag = renderFragmentCompare(base.description, focusPersona.description, { shortMode });
            fragForToc = frag;
            baseBody = frag.baseHtml;
            sharePanel = frag.sharePanel;
        } else {
            baseBody = renderFocusBlocks(base.description, focusPersona.description, 'base', showDiffOnly, { shortMode });
            sharePanel = '';
        }
    } else {
        // 未选对象：纯文本，不高亮、不展示共同片段
        baseBody = `<div class="pmp18-col-block plain">${escapeHtml(base.description).replace(/\n/g, '<br>')}</div>`;
        sharePanel = '';
    }

    const metaLine = focusPersona
        ? (fragmentMode
            ? `共同片段 ${stats.same}${shortMode ? ' · 短人设' : ''}`
            : `${Math.round(score * 100)}% · 同 ${stats.same} · 改 ${stats.replace} · 仅基准 ${stats.remove} · 仅对方 ${stats.add}`)
        : (others.length === 1 ? '自动对比中' : `请点选一个对象 · 共 ${others.length} 个`);

    // Top chips
    const baselineCards = ids.map(id => {
        const p = personas.find(x => x.id === id);
        if (!p) return '';
        const sub = formatPersonaSubline(p);
        return `<button type="button" class="pmp18-base-card ${id === state.baselineId ? 'is-active' : ''}" data-action="set-baseline" data-id="${escapeHtml(id)}" data-dblaction="edit-full" data-id2="${escapeHtml(id)}" title="${escapeHtml(p.name)} · ${escapeHtml(sub)} · 双击编辑">
            ${renderAvatar(p)}
            <span class="pmp18-base-card-meta"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(sub)}</small></span>
        </button>`;
    }).join('');

    const objectCards = others.map(id => {
        const p = personas.find(x => x.id === id);
        if (!p) return '';
        const sc = Math.round(similarity(base.description, p.description) * 100);
        const on = id === focusId;
        const sub = formatPersonaSubline(p);
        return `<button type="button" class="pmp18-obj-card ${on ? 'is-active' : ''}" data-action="set-focus-other" data-id="${escapeHtml(id)}" data-dblaction="edit-full" data-id2="${escapeHtml(id)}" title="${escapeHtml(p.name)} · ${escapeHtml(sub)} · 双击编辑">
            ${renderAvatar(p)}
            <span class="pmp18-obj-card-meta"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(sub)} · ${sc}%</small></span>
        </button>`;
    }).join('');

    // Horizontal full-text cards for every other
    const othersOrdered = focusId
        ? [focusId, ...others.filter(id => id !== focusId)]
        : others.slice();
    const otherFullCards = othersOrdered.map(id => {
        const p = personas.find(x => x.id === id);
        if (!p) return '';
        const sc = similarity(base.description, p.description);
        const scPct = Math.round(sc * 100);
        const isFocus = id === focusId;
        const sm = isShortText(base.description, p.description);
        let bodyHtml;
        if (isFocus) {
            if (shouldUseFragmentMode(base.description, p.description, sc)) {
                bodyHtml = renderFragmentCompare(base.description, p.description, { shortMode: sm }).otherHtml;
            } else {
                bodyHtml = renderFocusBlocks(base.description, p.description, 'other', showDiffOnly, { shortMode: sm });
            }
        } else {
            // 未选中：只显示摘要，点选后再展开全文对比
            const raw = String(p.description || '').replace(/\s+/g, ' ').trim();
            const preview = raw.slice(0, 96);
            bodyHtml = `<div class="pmp18-card-summary">${escapeHtml(preview)}${raw.length > 96 ? '…' : ''}<div class="pmp18-card-summary-hint">点击展开与基准对比</div></div>`;
        }
        return `
            <article class="pmp18-multi-other-card ${isFocus ? 'is-focus' : ''}" data-action="set-focus-other" data-id="${escapeHtml(id)}" data-dblaction="edit-full" data-id2="${escapeHtml(id)}">
                <header class="pmp18-multi-other-head">
                    <div class="pmp18-pair-person">
                        ${renderAvatar(p)}
                        <div>
                            <strong>${escapeHtml(p.name)}</strong>
                            <span>${escapeHtml(formatPersonaSubline(p))} · 相似 ${scPct}%</span>
                        </div>
                    </div>
                    ${isFocus ? '<span class="pmp18-multi-focus-tag">对比中</span>' : '<span class="pmp18-muted" style="font-size:11px">点击对比</span>'}
                </header>
                <div class="pmp18-multi-other-body">${bodyHtml}</div>
            </article>`;
    }).join('');

    const isNarrow = typeof window !== 'undefined' && window.innerWidth <= 900;
    // 用户可选手动切换；默认 state.viewMode（桌面 side，可改）
    const viewMode = state.viewMode === 'side' ? 'side' : 'stacked';
    const viewModeClass = `is-${viewMode}`;
    const chromeOpen = !!state.compareChromeOpen; // 桌面/手机默认收起，点「详情」展开
    const pairLabel = focusPersona
        ? `${base.name} ↔ ${focusPersona.name}`
        : `${base.name} · 待选对象`;

    return `
        <div class="pmp18-compare-workspace ${viewModeClass} ${isNarrow ? 'is-narrow' : ''} ${chromeOpen ? 'is-chrome-open' : 'is-chrome-collapsed'}">
            <div class="pmp18-compare-compact">
                <button type="button" class="pmp18-back-btn" data-action="exit-compare"><i class="fa-solid fa-arrow-left"></i></button>
                <div class="pmp18-compact-pair" title="${escapeHtml(pairLabel)}">
                    <strong>${escapeHtml(base.name)}</strong>
                    <span class="pmp18-compact-sub">${escapeHtml(formatPersonaSubline(base))}</span>
                    ${focusPersona ? `<span class="pmp18-detail-vs">↔</span><strong>${escapeHtml(focusPersona.name)}</strong><span class="pmp18-compact-sub">${escapeHtml(formatPersonaSubline(focusPersona))}</span>` : `<span class="pmp18-muted">· 点选对象</span>`}
                </div>
                <button type="button" class="pmp18-small-btn" data-action="set-view-mode" data-mode="${viewMode === 'side' ? 'stacked' : 'side'}" title="切换上下/左右">${viewMode === 'side' ? '↕' : '↔'}</button>
                <button type="button" class="pmp18-small-btn ${chromeOpen ? 'is-on' : ''}" data-action="toggle-compare-chrome" title="展开/收起工具区">${chromeOpen ? '收起' : '详情'}</button>
            </div>

            <div class="pmp18-compare-chrome">
                <div class="pmp18-compare-topbar">
                    <div class="pmp18-compare-title">
                        <strong>对比</strong>
                        <span>${isNarrow ? '上下全文 · 点选对象高亮' : '基准固定 · 可切换左右/上下'}</span>
                    </div>
                    <div class="pmp18-compare-tools">
                        <button type="button" class="pmp18-small-btn ${state.showToc ? 'is-on' : ''}" data-action="toggle-toc" title="目录与搜索"><i class="fa-solid fa-list"></i></button>
                        ${fragmentMode && focusPersona ? '' : `<button type="button" class="pmp18-small-btn ${showDiffOnly ? 'is-on' : ''}" data-action="toggle-diff-only">只看差异</button>`}
                        <button type="button" class="pmp18-small-btn" data-action="set-view-mode" data-mode="${viewMode === 'side' ? 'stacked' : 'side'}" title="切换上下/左右">${viewMode === 'side' ? '↕ 上下' : '↔ 左右'}</button>
                        <button type="button" class="pmp18-small-btn" data-action="edit-full" data-id="${escapeHtml(base.id)}">编辑基准</button>
                        ${focusPersona ? `<button type="button" class="pmp18-small-btn" data-action="edit-full" data-id="${escapeHtml(focusPersona.id)}">编辑对方</button>` : ''}
                    </div>
                </div>

                <div class="pmp18-chrome-tools-hint">
                    <span class="pmp18-muted" style="font-size:11px">换基准 / 选对象：点下方卡片或此处芯片</span>
                </div>
                <div class="pmp18-chip-row">
                    <span class="pmp18-strip-label">基准</span>
                    <div class="pmp18-chip-scroll">${baselineCards}</div>
                </div>
                <div class="pmp18-chip-row">
                    <span class="pmp18-strip-label">对象</span>
                    <div class="pmp18-chip-scroll">${objectCards}</div>
                </div>
            </div>

            <div class="pmp18-compare-always">
                <div class="pmp18-detail-meta pmp18-progress-line">
                    <span class="pmp18-detail-score">${metaLine}</span>
                    <span class="pmp18-progress-dots">${others.length ? `对象 ${focusId ? (others.indexOf(focusId) + 1) : '—'} / ${others.length}` : ''}</span>
                </div>
                ${renderCompareLegend(fragmentMode && !!focusPersona, shortMode)}
                ${sharePanel}
            </div>

            <div class="pmp18-multi-body ${mode}">
                <section class="pmp18-multi-base-fixed" data-dblaction="edit-full" data-id2="${escapeHtml(base.id)}">
                    <header class="pmp18-multi-base-head">
                        <div class="pmp18-pair-person">
                            ${renderAvatar(base)}
                            <div>
                                <strong>${escapeHtml(base.name)}</strong>
                                <span>基准 · 固定 · ${escapeHtml(formatPersonaSubline(base))}</span>
                            </div>
                        </div>
                    </header>
                    <div class="pmp18-multi-base-body">${baseBody}</div>
                </section>
                <div class="pmp18-multi-others-scroll" data-pmp18-hscroll="1">
                    ${otherFullCards || '<div class="pmp18-muted" style="padding:16px">无对象</div>'}
                </div>
            </div>
            ${isNarrow && others.length ? `<div class="pmp18-mobile-thumbs" data-pmp18-hscroll="1">${othersOrdered.map(id => {
                const p = personas.find(x => x.id === id);
                if (!p) return '';
                const on = id === focusId;
                return `<button type="button" class="pmp18-thumb ${on ? 'is-on' : ''}" data-action="set-focus-other" data-id="${escapeHtml(id)}">${renderAvatar(p)}<span>${escapeHtml(p.name)}</span></button>`;
            }).join('')}</div>` : ''}

            ${focusPersona ? renderTocPanel(fragmentMode, shortMode, base.description, focusPersona.description) : ''}
        </div>`;
}

function renderTocPanel(fragmentMode, shortMode, baseText, otherText) {
    if (!state.showToc) return '';
    const query = String(state.tocQuery || '').trim().toLowerCase();

    let listHtml = '';
    if (fragmentMode) {
        const shared = extractSharedSnippets(baseText, otherText, { shortMode });
        const filtered = query
            ? shared.filter(s => s.toLowerCase().includes(query))
            : shared;
        listHtml = filtered.length
            ? `<div class="pmp18-toc-chips">${filtered.map((s, i) => `<span class="pmp18-toc-chip" data-toc-jump="share-${i}">${escapeHtml(s)}</span>`).join('')}</div>`
            : `<div class="pmp18-muted">${query ? '无匹配片段' : '无共同片段'}</div>`;
    } else {
        const rows = unorderedDiff(baseText, otherText);
        const filtered = query
            ? rows.filter(r => (String(r.a || '') + ' ' + String(r.b || '')).toLowerCase().includes(query))
            : rows;
        const items = filtered.slice(0, 60).map((r, i) => {
            const t = r.type;
            const label = t === 'same' ? '同' : t === 'replace' ? '改' : t === 'remove' ? '仅基准' : t === 'add' ? '仅对方' : t;
            const preview = String(r.a || r.b || '').replace(/\s+/g, ' ').slice(0, 28);
            return `<button type="button" class="pmp18-toc-item pmp18-toc-${t}" data-toc-jump="row-${i}"><span class="pmp18-toc-badge">${label}</span><span class="pmp18-toc-preview">${escapeHtml(preview)}</span></button>`;
        });
        listHtml = items.length
            ? items.join('')
            : `<div class="pmp18-muted">${query ? '无匹配段' : '无段落'}</div>`;
        if (filtered.length > 60) listHtml += `<div class="pmp18-muted" style="padding:6px">仅显示前 60 条（共 ${filtered.length} 条）</div>`;
    }
    return `
        <aside class="pmp18-toc-panel">
            <div class="pmp18-toc-head">
                <input type="search" id="pmp18-toc-search" class="pmp18-toc-search" placeholder="搜索段/片段…" value="${escapeHtml(state.tocQuery || '')}" data-pmp18-keep-focus="toc" autocomplete="off">
                <button type="button" class="pmp18-small-btn" data-action="close-toc"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="pmp18-toc-body">${listHtml}</div>
        </aside>`;
}
