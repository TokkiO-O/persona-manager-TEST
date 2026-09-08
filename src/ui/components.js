import { state } from '../state.js';
import { escapeHtml, normalizeText } from '../util.js';
import {
    getSameNameGroups, getExactDuplicateGroups, getSimilarPairs, similarity
} from '../similarity.js';
import { formatPersonaSubline } from '../persona-data.js';

export function personaImageUrl(id) {
    if (!id) return '';
    return `/thumbnail?type=persona&file=${encodeURIComponent(id)}`;
}

export function renderAvatar(persona) {
    const src = persona.avatar || '';
    if (src) {
        return `<img class="pmp18-avatar" src="${escapeHtml(src)}" alt="" style="width:48px!important;height:48px!important;border-radius:50%!important;object-fit:cover!important;display:block!important;position:static!important;margin:0!important;border:2px solid rgba(255,183,178,.4)!important;background:#f0f0f2!important;">`;
    }
    return `<div class="pmp18-avatar pmp18-avatar-fallback" style="width:48px!important;height:48px!important;border-radius:50%!important;display:grid!important;place-items:center!important;position:static!important;margin:0!important;background:#eee!important;color:#1a1a1f!important;border:2px solid rgba(255,183,178,.4)!important;"><i class="fa-solid fa-user"></i></div>`;
}

function isInGroup(persona, groups) {
    return groups.some(g => g.some(item => item.id === persona.id));
}

export function statusBadge(persona, all) {
    if (isInGroup(persona, getExactDuplicateGroups(all))) return '<span class="pmp18-badge pmp18-badge-danger">完全重复</span>';
    if (isInGroup(persona, getSameNameGroups(all))) return '<span class="pmp18-badge">同名</span>';
    return '';
}

export function renderCard(persona, all) {
    const checked = state.selected.has(persona.id);
    const sub = formatPersonaSubline(persona);
    const dens = state.listDensity === 'compact';
    const maxLen = dens ? 90 : 160;
    const raw = String(persona.description || '').replace(/\s+/g, ' ').trim();
    const descText = raw
        ? escapeHtml(raw.slice(0, maxLen)) + (raw.length > maxLen ? '…' : '')
        : '<span style="opacity:.55">暂无描述</span>';
    const name = escapeHtml(persona.name || '未命名');
    const subEsc = escapeHtml(sub);
    const id = escapeHtml(persona.id);
    const badge = statusBadge(persona, all);
    // 全部关键样式写在标签上，避免被 style.css / 主题覆盖导致「空白卡片」
    return `
        <article class="pmp18-card ${checked ? 'is-selected' : ''}" data-persona-id="${id}"
            style="display:flex!important;flex-direction:row!important;align-items:flex-start!important;gap:12px!important;padding:12px!important;margin:0!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;background:#fff!important;color:#1a1a1f!important;-webkit-text-fill-color:#1a1a1f!important;border:1px solid rgba(0,0,0,.08)!important;border-radius:14px!important;overflow:hidden!important;position:relative!important;isolation:isolate!important;">
            <label class="pmp18-check" style="flex:0 0 auto!important;position:static!important;margin:4px 0 0!important;">
                <input type="checkbox" data-action="select" data-id="${id}" ${checked ? 'checked' : ''}>
            </label>
            <div style="flex:0 0 48px!important;width:48px!important;height:48px!important;position:static!important;">
                ${renderAvatar(persona)}
            </div>
            <div class="pmp18-card-main" style="flex:1 1 0!important;min-width:0!important;max-width:100%!important;padding:0!important;text-align:left!important;color:#1a1a1f!important;-webkit-text-fill-color:#1a1a1f!important;overflow:hidden!important;">
                <div style="display:flex!important;align-items:center!important;gap:6px!important;flex-wrap:wrap!important;">
                    <div class="pmp18-card-name" style="font-size:14px!important;font-weight:700!important;color:#1a1a1f!important;-webkit-text-fill-color:#1a1a1f!important;line-height:1.3!important;">${name}</div>
                    ${badge}
                </div>
                <div class="pmp18-card-sub" style="font-size:11px!important;color:#5a5a63!important;-webkit-text-fill-color:#5a5a63!important;margin-top:2px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;" title="${escapeHtml(persona.title ? `备注：${persona.title}` : `ID：${persona.id}`)}">${subEsc}</div>
                <div class="pmp18-card-description" style="font-size:12px!important;line-height:1.45!important;color:#2a2a32!important;-webkit-text-fill-color:#2a2a32!important;margin-top:6px!important;max-height:3.6em!important;overflow:hidden!important;display:block!important;">${descText}</div>
            </div>
            <div class="pmp18-card-actions" style="display:flex!important;flex-direction:column!important;gap:6px!important;flex:0 0 auto!important;position:static!important;">
                <button type="button" class="pmp18-icon-btn" data-action="edit-full" data-id="${id}" title="编辑" style="color:#1a1a1f!important;"><i class="fa-solid fa-pen"></i></button>
                <button type="button" class="pmp18-icon-btn pmp18-danger-icon" data-action="delete-persona" data-id="${id}" title="删除"><i class="fa-solid fa-trash"></i></button>
            </div>
        </article>`;
}

export function renderGroup(group, title, all) {
    const key = String(title || group[0]?.name || 'g');
    // 默认：超过 4 个收起；用户点过则以 groupFold 为准
    const folded = Object.prototype.hasOwnProperty.call(state.groupFold, key)
        ? !!state.groupFold[key]
        : group.length > 4;
    const previewN = 4;
    const shown = folded ? group.slice(0, previewN) : group;
    const rest = group.length - shown.length;
    return `
        <section class="pmp18-group ${folded ? 'is-folded' : ''}" data-group-key="${escapeHtml(key)}">
            <div class="pmp18-group-head">
                <div>
                    <div class="pmp18-group-title">${escapeHtml(title)}</div>
                    <div class="pmp18-group-count">${group.length} 个${folded && rest > 0 ? ` · 已收起 ${rest}` : ''}</div>
                </div>
                <div class="pmp18-group-actions">
                    ${group.length > previewN ? `<button class="pmp18-small-btn" type="button" data-action="toggle-group-fold" data-key="${escapeHtml(key)}">${folded ? '展开全部' : '收起'}</button>` : ''}
                    <button class="pmp18-small-btn" type="button" data-action="select-group" data-ids="${escapeHtml(group.map(x => x.id).join('|'))}">全选</button>
                </div>
            </div>
            <div class="pmp18-group-grid">${shown.map(p => renderCard(p, all)).join('')}</div>
        </section>`;
}

export function emptyState(title, text) {
    return `<div class="pmp18-empty"><div class="pmp18-empty-orb"><i class="fa-solid fa-users-viewfinder"></i></div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text || '换个关键词，或去「全部」看看')}</span></div>`;
}

export function searchMatch(persona, query) {
    const q = normalizeText(query);
    return !q || persona.nameKey.includes(q) || persona.descriptionKey.includes(q);
}

export function renderAllView(personas) {
    const filtered = personas.filter(p => searchMatch(p, state.query));
    return filtered.length
        ? `<div class="pmp18-card-grid">${filtered.map(p => renderCard(p, personas)).join('')}</div>`
        : emptyState(state.query ? '没有匹配的人设' : '还没有 Persona', state.query ? '换个关键词试试' : '在酒馆用户设定里创建后人设会出现在这里');
}

export function renderSameNameView(personas) {
    const groups = getSameNameGroups(personas).map(g => g.filter(p => searchMatch(p, state.query))).filter(g => g.length > 1);
    return groups.length ? groups.map(g => renderGroup(g, g[0].name, personas)).join('') : emptyState('没有同名分组', '同名超过 1 个时会在这里聚合，方便去重');
}

export function renderDuplicateView(personas) {
    const groups = getExactDuplicateGroups(personas).map(g => g.filter(p => searchMatch(p, state.query))).filter(g => g.length > 1);
    return groups.length ? groups.map((g, i) => renderGroup(g, `重复组 ${i + 1}`, personas)).join('') : emptyState('没有完全重复', '描述文本完全一致的人设会显示在这里');
}

export function renderSimilarView(personas) {
    const q = normalizeText(state.query);
    const pairs = getSimilarPairs(personas).filter(({ a, b }) => !q || searchMatch(a, q) || searchMatch(b, q));
    if (!pairs.length) {
        return emptyState('没有高度相似', `当前阈值 ${Math.round(state.settings.similarityThreshold * 100)}% · 可在设置里调节`);
    }
    return `<div class="pmp18-similar-list">${pairs.map(({ a, b, score }) => `
        <section class="pmp18-similar-pair">
            <div class="pmp18-similar-head">
                <div><span class="pmp18-score">${Math.round(score * 100)}%</span>
                ${a.nameKey === b.nameKey ? '<span class="pmp18-badge">同名</span>' : ''}</div>
                <button class="pmp18-small-btn" data-action="compare-pair" data-a="${escapeHtml(a.id)}" data-b="${escapeHtml(b.id)}">对比</button>
            </div>
            <div class="pmp18-compare-mini">
                <div class="pmp18-mini">${renderAvatar(a)}<div><strong>${escapeHtml(a.name)}</strong></div></div>
                <div class="pmp18-mini">${renderAvatar(b)}<div><strong>${escapeHtml(b.name)}</strong></div></div>
            </div>
        </section>`).join('')}</div>`;
}
