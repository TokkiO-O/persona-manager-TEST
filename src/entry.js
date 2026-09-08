import { BUTTON_ID, ENTRY_MARK, EXT } from './constants.js';

/** Filled by index.js after modules load — avoids import cycle with ui/render */
let _openManager = () => {
    if (typeof window.openPersonaManager === 'function') {
        window.openPersonaManager();
        return;
    }
    console.warn(`[${EXT}] openManager not ready`);
};

export function setEntryOpenManager(fn) {
    if (typeof fn === 'function') _openManager = fn;
}

export function findEntryAnchor() {
    for (const id of ['persona-management-block', 'user-settings-block-content', 'user-settings-block']) {
        const node = document.getElementById(id);
        if (node) return { type: 'container', node, id };
    }
    const col = document.querySelector('.persona_management_left_column, .persona_management_global_settings');
    if (col) return { type: 'container', node: col };
    for (const el of document.querySelectorAll('h3,h2,h4,.inline-drawer-header')) {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text === '用户设置' || text === 'User Settings' || text === '全局设置' || text === 'Global Settings') {
            return { type: 'heading', node: el };
        }
    }
    return null;
}

export function makeEntry(floating = false) {
    const entry = document.createElement('button');
    entry.id = BUTTON_ID;
    entry.type = 'button';
    entry.className = floating ? 'menu_button pmp18-entry pmp18-entry-float' : 'menu_button pmp18-entry';
    entry.dataset.pmp18 = ENTRY_MARK;
    entry.innerHTML = floating
        ? '<i class="fa-solid fa-users-viewfinder"></i><span>Persona Manager</span>'
        : '<i class="fa-solid fa-users-viewfinder"></i><span>Persona Manager</span><small>管理 / 对比 / 重复检测</small>';
    entry.addEventListener('click', () => _openManager('all'));
    return entry;
}

export function injectEntry() {
    if (document.getElementById(BUTTON_ID)) return true;
    const anchor = findEntryAnchor();
    if (!anchor?.node) return false;
    const btn = makeEntry(false);
    if (anchor.type === 'heading' && anchor.node.parentNode) {
        anchor.node.parentNode.insertBefore(btn, anchor.node);
    } else {
        anchor.node.insertBefore(btn, anchor.node.firstChild);
    }
    console.log(`[${EXT}] 入口已挂载 (${anchor.type}${anchor.id ? ' #' + anchor.id : ''})`);
    return true;
}

export function injectFloatingEntry() {
    if (document.getElementById(BUTTON_ID)) return true;
    document.body.appendChild(makeEntry(true));
    console.warn(`[${EXT}] 浮动入口。也可 openPersonaManager()`);
    return true;
}

export function installEntryObserver() {
    // Allow re-run after hot reload; still avoid stacking timers
    if (window.__pmp18EntryTimer) {
        clearInterval(window.__pmp18EntryTimer);
        window.__pmp18EntryTimer = null;
    }

    if (injectEntry()) {
        // Still schedule a safety float if panel button disappears after navigation
        setTimeout(() => { if (!document.getElementById(BUTTON_ID)) injectFloatingEntry(); }, 3000);
        return;
    }

    let ticks = 0;
    const observer = new MutationObserver(() => {
        if (injectEntry()) {
            observer.disconnect();
            if (window.__pmp18EntryTimer) {
                clearInterval(window.__pmp18EntryTimer);
                window.__pmp18EntryTimer = null;
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    window.__pmp18EntryTimer = setInterval(() => {
        ticks += 1;
        if (injectEntry()) {
            observer.disconnect();
            clearInterval(window.__pmp18EntryTimer);
            window.__pmp18EntryTimer = null;
            return;
        }
        if (ticks >= 30) {
            clearInterval(window.__pmp18EntryTimer);
            window.__pmp18EntryTimer = null;
            observer.disconnect();
            injectFloatingEntry();
        }
    }, 400);

    document.getElementById('persona-management-button')?.addEventListener('click', () => setTimeout(injectEntry, 200));
    document.getElementById('user-settings-button')?.addEventListener('click', () => setTimeout(injectEntry, 200));
}
