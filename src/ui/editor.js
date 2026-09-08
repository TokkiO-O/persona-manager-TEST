import { getPersonaData, persistPersonaFull } from '../persona-data.js';
import { escapeHtml } from '../util.js';
import { EXT } from '../constants.js';

let _afterSave = () => {};
export function setEditorAfterSave(fn) { _afterSave = typeof fn === 'function' ? fn : () => {}; }

/* ---------- Editor (id locked at open) ---------- */

export function openFullEditor(rawId) {
    const id = String(rawId || '');
    const p = getPersonaData().find(x => x.id === id);
    if (!p) {
        console.error(`[${EXT}] editor: persona not found`, rawId);
        return;
    }
    // Freeze id for this editor session
    const lockedId = p.id;

    const overlay = document.createElement('div');
    overlay.className = 'pmp18-editor-overlay';
    overlay.dataset.editId = lockedId;
    overlay.innerHTML = `
        <div class="pmp18-editor">
            <div class="pmp18-editor-head">
                <strong>编辑 Persona</strong>
                <span class="pmp18-muted">${escapeHtml(lockedId)}</span>
                <button type="button" class="pmp18-close pmp18-editor-close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <label class="pmp18-editor-label">显示名称</label>
            <input type="text" class="pmp18-editor-name" value="${escapeHtml(p.name)}">
            <label class="pmp18-editor-label">描述</label>
            <textarea class="pmp18-editor-ta" rows="14" spellcheck="false">${escapeHtml(p.description)}</textarea>
            <div class="pmp18-editor-actions">
                <button type="button" class="pmp18-small-btn pmp18-editor-cancel">取消</button>
                <button type="button" class="pmp18-primary-btn pmp18-editor-save">保存</button>
            </div>
            <p class="pmp18-editor-note">仅写入 ID：${escapeHtml(lockedId)}，不会修改其他人设。</p>
        </div>`;

    const close = () => overlay.remove();
    overlay.querySelector('.pmp18-editor-close').onclick = close;
    overlay.querySelector('.pmp18-editor-cancel').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('.pmp18-editor-save').onclick = () => {
        const newName = overlay.querySelector('.pmp18-editor-name').value.trim() || p.name;
        const newDesc = overlay.querySelector('.pmp18-editor-ta').value;
        const stillId = overlay.dataset.editId;
        if (stillId !== lockedId) {
            console.error(`[${EXT}] editor id mismatch`, stillId, lockedId);
            if (typeof toastr !== 'undefined') toastr.error('保存中止：目标 ID 异常');
            return;
        }
        if (newName === p.name && newDesc === p.description) {
            close();
            return;
        }
        if (!window.confirm(`确认写回「${p.name}」？\nID: ${lockedId}`)) return;
        const ok = persistPersonaFull(lockedId, newName, newDesc);
        close();
        if (ok && typeof toastr !== 'undefined') toastr.success(`已保存：${newName}`);
        _afterSave();
    };
    document.body.appendChild(overlay);
}

