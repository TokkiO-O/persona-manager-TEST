/**
 * Persona Manager v1.9.1 — ES module entry
 */

import { EXT, VERSION } from './src/constants.js';
import { ensureRoot, openManager, closeManager, renderManager, scheduleRender } from './src/ui/render.js';
import { scheduleAutoUpdateCheck } from './src/update.js';
import { setEditorAfterSave } from './src/ui/editor.js';
import { setUpdateUiRefresh } from './src/update.js';
import { installEntryObserver, setEntryOpenManager } from './src/entry.js';
import { installPersonaListener, setPersonaListenerRefresh } from './src/persona-listener.js';
import { state } from './src/state.js';

const refresh = () => {
    try {
        if (typeof scheduleRender === 'function') scheduleRender();
        else renderManager();
    } catch (e) {
        console.error(`[${EXT}] refresh failed`, e);
    }
};
setUpdateUiRefresh(refresh);
setPersonaListenerRefresh(refresh);
setEditorAfterSave(refresh);
setEntryOpenManager((tab) => openManager(tab || 'all'));
window.openPersonaManager = () => openManager('all');

function installKeyboardHandler() {
    if (window.__pmp18Keyboard) return;
    window.__pmp18Keyboard = true;
    document.addEventListener('keydown', event => {
        if (!state.active) return;
        if (event.key === 'Escape' && !document.querySelector('.pmp18-editor-overlay')) closeManager();
    });
}

async function init() {
    ensureRoot();
    installKeyboardHandler();
    installEntryObserver();
    installPersonaListener();
    scheduleAutoUpdateCheck();
    console.log(`[${EXT}] v${VERSION} loaded (modular)`);
}

(async () => {
    try {
        await init();
    } catch (error) {
        console.error(`[${EXT}] 初始化失败`, error);
        if (typeof toastr !== 'undefined') toastr.error(`${EXT} 初始化失败：${error?.message || error}`);
    }
})();

export function onUpdate() {
    location.reload();
}
