import { EXT } from './constants.js';
import { state } from './state.js';
import { invalidatePersonaCache } from './persona-data.js';

let _refresh = () => {};
export function setPersonaListenerRefresh(fn) {
    _refresh = typeof fn === 'function' ? fn : () => {};
}

let _personaListenerInstalled = false;

export function installPersonaListener() {
    if (_personaListenerInstalled) return;
    _personaListenerInstalled = true;
    try {
        const ctx = window.SillyTavern?.getContext?.();
        const es = ctx?.eventSource;
        if (!es?.on) return;
        const types = ctx?.eventTypes || ctx?.event_types || {};
        const names = [
            types.PERSONA_UPDATED || 'PERSONA_UPDATED',
            types.PERSONA_DELETED || 'PERSONA_DELETED',
            types.PERSONA_CREATED || 'PERSONA_CREATED',
            types.PERSONA_CHANGED || 'PERSONA_CHANGED',
            'PERSONA_UPDATED',
            'PERSONA_DELETED',
            'PERSONA_CREATED',
            'PERSONA_CHANGED',
        ];
        const seen = new Set();
        const onEvt = (tag) => () => {
            invalidatePersonaCache(`event:${tag}`);
            if (state.active) _refresh();
        };
        for (const n of names) {
            if (!n || seen.has(n)) continue;
            seen.add(n);
            es.on(n, onEvt(n));
        }
        console.log(`[${EXT}] persona event listener attached`, [...seen]);
    } catch (e) {
        console.warn(`[${EXT}] could not attach persona event listener`, e);
    }
}
