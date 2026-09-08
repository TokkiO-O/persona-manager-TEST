import { power_user } from '../power-user-bridge.js';
import { EXT } from './constants.js';
import { state } from './state.js';
import { normalizeText } from './util.js';
import { invalidateGroupMemo } from './similarity.js';
import { getStRequestHeaders } from './update.js';

function hasPowerUser() {
    try {
        return !!(getLivePowerUser());
    } catch {
        return false;
    }
}

/** Prefer live module binding; fall back to getContext().powerUserSettings */
function getLivePowerUser() {
    try {
        if (power_user && typeof power_user === 'object' && power_user.personas) return power_user;
    } catch { /* ignore */ }
    try {
        const ctx = window.SillyTavern?.getContext?.();
        if (ctx?.powerUserSettings) return ctx.powerUserSettings;
        if (ctx?.powerUser) return ctx.powerUser;
    } catch { /* ignore */ }
    try {
        if (power_user && typeof power_user === 'object') return power_user;
    } catch { /* ignore */ }
    return null;
}

/* ---------- Persona read / write (id-safe) ---------- */

export function getPersonaDescription(raw) {
    if (raw == null) return '';
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
    if (Array.isArray(raw)) return raw.map(getPersonaDescription).filter(Boolean).join('\n');
    if (typeof raw === 'object') {
        for (const key of ['description', 'text', 'content', 'value', 'persona_description']) {
            if (raw[key] != null) {
                const t = getPersonaDescription(raw[key]);
                if (t) return t;
            }
        }
    }
    return '';
}

/** ST Persona Title / 备注 */
export function getPersonaTitle(raw) {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return '';
    for (const key of ['title', 'memo', 'note', '备注', 'persona_title']) {
        if (raw[key] != null && String(raw[key]).trim()) return String(raw[key]).trim();
    }
    return '';
}

export function getActiveAvatarId() {
    try {
        if (power_user?.user_avatar) return String(power_user.user_avatar);
    } catch { /* ignore */ }
    try {
        if (window.user_avatar) return String(window.user_avatar);
    } catch { /* ignore */ }
    return '';
}

/* ---------- §3 Persona data — read / write / delete (with memo cache) ---------- */

export let _personaCache = null;     // { version, items }
export let _personaVersion = 0;

// Bump whenever the underlying power_user data is mutated through this module,
// or any external write that we know about (PERSONA_UPDATED / PERSONA_DELETED
// event).
export function invalidatePersonaCache(reason) {
    _personaCache = null;
    try { invalidateGroupMemo(); } catch { /* ignore */ }
}

/**
 * ST keeps persona avatars on disk; power_user.personas can lag behind.
 * Pull /api/avatars/get and merge missing ids into the live store so the
 * manager sees newly created personas without a full page reload.
 */
/**
 * Refresh persona visibility from disk WITHOUT writing placeholder names
 * into power_user (writing "[未命名]" / letting ST call addMissingPersonas
 * produces leftover "[Unnamed Persona]" entries).
 *
 * ST already registers new personas in power_user when you create them in UI.
 * We only invalidate caches and optionally note disk file ids for debug.
 */
export async function syncPersonasFromAvatarFiles() {
    const pu = getLivePowerUser();
    if (!pu) return false;
    try {
        const headers = await getStRequestHeaders();
        const res = await fetch('/api/avatars/get', {
            method: 'POST',
            headers,
            credentials: 'same-origin',
            body: JSON.stringify({}),
        });
        if (!res.ok) {
            console.warn(`[${EXT}] /api/avatars/get HTTP`, res.status);
            invalidatePersonaCache('syncAvatars-fail');
            return false;
        }
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data?.images || data?.avatars || []);
        const diskIds = new Set();
        if (Array.isArray(list)) {
            for (const item of list) {
                const id = String(typeof item === 'string' ? item : (item?.filename || item?.name || item?.avatar || '')).trim();
                if (id) diskIds.add(id);
            }
        }
        // If power_user has entries whose avatar file is gone, drop them (stale)
        let removed = 0;
        if (pu.personas && diskIds.size) {
            for (const id of Object.keys(pu.personas)) {
                if (!diskIds.has(id)) {
                    // Only auto-remove obvious placeholders left by old sync / ST
                    const name = String(pu.personas[id] || '');
                    if (name === '[未命名]' || name === '[Unnamed Persona]' || name === 'Unnamed Persona') {
                        delete pu.personas[id];
                        if (pu.persona_descriptions) delete pu.persona_descriptions[id];
                        removed += 1;
                    }
                }
            }
            if (removed) {
                savePowerUserSettings();
                console.log(`[${EXT}] removed ${removed} stale Unnamed placeholder(s)`);
            }
        }
        invalidatePersonaCache(`syncAvatars:disk=${diskIds.size},removed=${removed}`);
        return removed > 0;
    } catch (e) {
        console.warn(`[${EXT}] syncPersonasFromAvatarFiles failed`, e);
        invalidatePersonaCache('syncAvatars-error');
        return false;
    }
}

/**
 * Returns parsed persona list, with shape:
 *   { id, name, title, description, nameKey, descriptionKey }.
 * Memoized: re-renders don't re-parse descriptions. Invalidated by
 * PERSONA_UPDATED / PERSONA_DELETED events and by our own writes.
 */
function personaStoreSig(pu) {
    if (!pu?.personas) return '';
    // ids + name lengths + description lengths — cheap change detector
    const ids = Object.keys(pu.personas).sort();
    let s = `${ids.length}|`;
    const descs = pu.persona_descriptions || {};
    for (const id of ids) {
        const name = pu.personas[id];
        const d = descs[id];
        const dlen = d == null ? 0 : (typeof d === 'string' ? d.length : (d.description || '').length);
        const tlen = d && typeof d === 'object' ? String(d.title || '').length : 0;
        s += `${id}:${String(name || '').length}:${dlen}:${tlen};`;
    }
    return s;
}

export function getPersonaData() {
    const pu = getLivePowerUser();
    if (!pu) {
        console.warn(`[${EXT}] power_user unavailable — persona list empty`);
        _personaCache = null;
        return [];
    }

    const sig = personaStoreSig(pu);
    if (_personaCache && _personaCache.sig === sig) {
        return _personaCache.items;
    }

    const personas = pu.personas || {};
    const descriptions = pu.persona_descriptions || {};
    const items = Object.entries(personas).map(([id, rawName]) => {
        const name = String(rawName ?? id);
        const rawDesc = descriptions?.[id];
        const description = getPersonaDescription(rawDesc);
        const title = getPersonaTitle(rawDesc);
        return {
            id: String(id),
            name,
            title,
            description,
            nameKey: normalizeText(name),
            descriptionKey: normalizeText(description),
        };
    });
    _personaCache = { items, sig, version: ++_personaVersion };
    return items;
}

export function formatPersonaSubline(persona) {
    // 备注优先，没有则退回短 ID，用于同名同头像区分
    if (persona.title) return persona.title;
    const id = String(persona.id || '');
    if (id.length <= 18) return id;
    return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

export function savePowerUserSettings() {
    try {
        if (typeof window.saveSettingsDebounced === 'function') {
            window.saveSettingsDebounced();
            return;
        }
    } catch { /* ignore */ }
    try {
        if (typeof window.saveSettings === 'function') window.saveSettings();
    } catch { /* ignore */ }
}

export function emitPersonaUpdated(id) {
    try {
        const ctx = window.SillyTavern?.getContext?.();
        const es = ctx?.eventSource;
        const types = ctx?.eventTypes || ctx?.event_types;
        if (es?.emit && types?.PERSONA_UPDATED) {
            es.emit(types.PERSONA_UPDATED, id);
            return;
        }
        if (es?.emit) es.emit('PERSONA_UPDATED', id);
    } catch { /* ignore */ }
}

/**
 * Write ONLY this avatar id.
 * Never copy edited text onto the currently selected persona unless ids match.
 */
export function persistPersonaDescription(targetId, description) {
    const id = String(targetId || '');
    if (!id || !hasPowerUser()) {
        console.error(`[${EXT}] persist blocked: invalid id`, targetId);
        return false;
    }
    if (!power_user.persona_descriptions) power_user.persona_descriptions = {};

    const prev = power_user.persona_descriptions[id];
    let base = {};
    if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
        base = { ...prev };
    } else if (typeof prev === 'string') {
        base = { description: prev };
    }

    const nextText = String(description ?? '');
    power_user.persona_descriptions[id] = {
        ...base,
        description: nextText,
    };

    // Only touch the native textarea when editing the ACTIVE persona
    const activeId = getActiveAvatarId();
    if (activeId && activeId === id) {
        try {
            const ta = document.querySelector('#persona_description, textarea[name="persona_description"], #persona-description-textarea');
            if (ta && typeof ta.value === 'string') {
                ta.value = nextText;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                ta.dispatchEvent(new Event('change', { bubbles: true }));
            }
            // Keep global "current description" field in sync only for active
            if (typeof power_user.persona_description === 'string') {
                power_user.persona_description = nextText;
            }
        } catch { /* ignore */ }
    }

    console.log(`[${EXT}] wrote description for id=${id} (active=${activeId || 'none'}) len=${nextText.length}`);
    savePowerUserSettings();
    invalidatePersonaCache('persistPersonaDescription');
    emitPersonaUpdated(id);
    return true;
}

export function persistPersonaFull(targetId, name, description) {
    const id = String(targetId || '');
    if (!id || !hasPowerUser()) {
        console.error(`[${EXT}] persistFull blocked: invalid id`, targetId);
        return false;
    }
    if (!power_user.personas) power_user.personas = {};
    power_user.personas[id] = String(name ?? id);
    console.log(`[${EXT}] wrote name for id=${id}`);
    return persistPersonaDescription(id, description);
}

export async function deletePersonaById(targetId) {
    const id = String(targetId || '').trim();
    if (!id) return false;

    const pu = getLivePowerUser();
    if (!pu) {
        console.error(`[${EXT}] delete: power_user unavailable`);
        throw new Error('无法访问 power_user，删除中止');
    }

    // Normalize id (sometimes UI stores encoded names)
    let avatarKey = id;
    try {
        const decoded = decodeURIComponent(id);
        if (pu.personas && (decoded in pu.personas) && !(id in pu.personas)) avatarKey = decoded;
    } catch { /* ignore */ }

    const name = (pu.personas && pu.personas[avatarKey]) || avatarKey;

    // 1) Server: delete avatar file (ST will re-create persona from file if this fails)
    const headers = await getStRequestHeaders();
    let apiOk = false;
    let apiStatus = 0;
    let apiText = '';
    try {
        const res = await fetch('/api/avatars/delete', {
            method: 'POST',
            headers,
            credentials: 'same-origin',
            body: JSON.stringify({ avatar: avatarKey }),
        });
        apiStatus = res.status;
        apiText = await res.text().catch(() => '');
        apiOk = res.ok;
        console.log(`[${EXT}] /api/avatars/delete`, apiStatus, apiText || '(empty)');
    } catch (e) {
        console.error(`[${EXT}] /api/avatars/delete network error`, e);
        throw new Error(`删除头像请求失败：${e?.message || e}`);
    }

    // 404 = file already gone — still clean settings
    if (!apiOk && apiStatus !== 404) {
        throw new Error(`删除头像失败 HTTP ${apiStatus} ${apiText}`.trim());
    }

    // 2) Settings cleanup (mirror ST deletePersona)
    if (pu.personas) delete pu.personas[avatarKey];
    if (pu.persona_descriptions) delete pu.persona_descriptions[avatarKey];
    try {
        if (pu.default_persona === avatarKey) pu.default_persona = null;
    } catch { /* ignore */ }

    // Also mutate module binding if different object
    try {
        if (power_user && power_user !== pu) {
            if (power_user.personas) delete power_user.personas[avatarKey];
            if (power_user.persona_descriptions) delete power_user.persona_descriptions[avatarKey];
            if (power_user.default_persona === avatarKey) power_user.default_persona = null;
        }
    } catch { /* ignore */ }

    state.selected.delete(id);
    state.selected.delete(avatarKey);
    state.compareIds = state.compareIds.filter(x => x !== id && x !== avatarKey);
    if (state.baselineId === id || state.baselineId === avatarKey) {
        state.baselineId = state.compareIds[0] || null;
    }
    if (state.focusOtherId === id || state.focusOtherId === avatarKey) {
        state.focusOtherId = state.compareIds.find(x => x !== state.baselineId) || null;
    }

    savePowerUserSettings();
    try {
        const ctx = window.SillyTavern?.getContext?.();
        if (typeof ctx?.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced();
    } catch { /* ignore */ }

    invalidatePersonaCache('deletePersonaById');

    // 3) Event
    try {
        const ctx = window.SillyTavern?.getContext?.();
        const es = ctx?.eventSource;
        const types = ctx?.eventTypes || ctx?.event_types;
        const payload = { avatarId: avatarKey, name };
        if (es?.emit && types?.PERSONA_DELETED) await es.emit(types.PERSONA_DELETED, payload);
        else if (es?.emit) await es.emit('PERSONA_DELETED', payload);
    } catch { /* ignore */ }

    // 4) Refresh native persona list / remove DOM leftovers
    // Do NOT call getUserAvatars() here: ST's addMissingPersonas will recreate
    // "[Unnamed Persona]" if the filesystem/API briefly still lists the file.
    // Native panel refreshes on next open; we already removed power_user entries.

    try {
        document.querySelectorAll(`[data-avatar-id="${CSS.escape(avatarKey)}"]`).forEach(el => {
            const card = el.closest('.avatar-container, .persona_block, [class*="persona"]');
            if (card) card.remove();
            else el.remove();
        });
    } catch { /* ignore */ }

    console.log(`[${EXT}] deleted persona id=${avatarKey} name=${name} api=${apiStatus}`);
    return true;
}

export async function confirmDeletePersona(label, id) {
    const title = `删除人设：${label}`;
    const bodyHtml = `确定删除「${escapeHtmlSafe(label)}」？<br/>ID: <code>${escapeHtmlSafe(id)}</code><br/><br/>将删除头像文件与关联设定，不可自动恢复。`;
    const bodyText = `确定删除「${label}」？\nID: ${id}\n\n将删除头像文件与关联设定，不可自动恢复。`;
    try {
        const Popup = window.Popup || window.SillyTavern?.getContext?.()?.Popup;
        if (Popup?.show?.confirm) {
            const ok = await Popup.show.confirm(title, bodyHtml);
            return !!ok;
        }
    } catch { /* ignore */ }
    try {
        const ctx = window.SillyTavern?.getContext?.();
        if (typeof ctx?.callGenericPopup === 'function') {
            const type = ctx.POPUP_TYPE?.CONFIRM ?? 1;
            const result = await ctx.callGenericPopup(bodyHtml, type, title);
            if (result === 1 || result === true || result === ctx.POPUP_RESULT?.AFFIRMATIVE) return true;
            if (result === 0 || result === false || result === ctx.POPUP_RESULT?.CANCELLED) return false;
            return !!result;
        }
    } catch { /* ignore */ }
    return window.confirm(`${title}\n\n${bodyText}`);
}

function escapeHtmlSafe(v) {
    return String(v ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

