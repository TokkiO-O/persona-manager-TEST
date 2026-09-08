import { state } from './state.js';
import { groupBy, normalizeText } from './util.js';

function personaListSig(personas) {
    let s = `${personas.length}|`;
    for (const p of personas) {
        s += `${p.id}|${p.nameKey}|${(p.descriptionKey || '').length}|${(p.description || '').length};`;
    }
    return s;
}

let _sameNameMemo = null;
let _dupMemo = null;
let _similarMemo = null;

export function invalidateGroupMemo() {
    _sameNameMemo = null;
    _dupMemo = null;
    _similarMemo = null;
}

export function _personaSig(personas) {
    return personaListSig(personas);
}

export function getSameNameGroups(personas) {
    const sig = personaListSig(personas);
    if (_sameNameMemo?.sig === sig) return _sameNameMemo.groups;
    const groups = groupBy(personas, p => p.nameKey || `\0${p.id}`).filter(g => g.length > 1);
    _sameNameMemo = { sig, groups };
    return groups;
}

export function getExactDuplicateGroups(personas) {
    const sig = personaListSig(personas);
    if (_dupMemo?.sig === sig) return _dupMemo.groups;
    const groups = groupBy(
        personas,
        p => `${p.nameKey}\u0000${p.descriptionKey || ''}`,
    ).filter(g => g.length > 1);
    _dupMemo = { sig, groups };
    return groups;
}

export function getSimilarPairs(personas, threshold = state.settings.similarityThreshold) {
    const allowSameName = state.settings.includeSameNameInSimilar !== false;
    const t = Number(threshold) || 0.55;
    const sig = `${personaListSig(personas)}|t=${t}|a=${allowSameName ? 1 : 0}`;
    if (_similarMemo?.sig === sig) return _similarMemo.pairs;

    const pairs = [];
    for (let i = 0; i < personas.length; i++) {
        for (let j = i + 1; j < personas.length; j++) {
            const a = personas[i];
            const b = personas[j];
            if (!allowSameName && a.nameKey === b.nameKey) continue;

            let score = 0;
            if (a.descriptionKey && b.descriptionKey) {
                score = similarity(a.description, b.description);
            } else if (!a.descriptionKey && !b.descriptionKey) {
                score = a.nameKey && a.nameKey === b.nameKey ? 1 : 0;
            } else {
                score = a.nameKey && a.nameKey === b.nameKey ? 0.2 : 0;
            }

            if (score >= t) pairs.push({ a, b, score });
        }
    }
    pairs.sort((x, y) => y.score - x.score || String(x.a.name).localeCompare(String(y.a.name)));
    _similarMemo = { sig, pairs };
    return pairs;
}

export function bigrams(text) {
    const value = normalizeText(text);
    if (!value) return new Set();
    if (value.length === 1) return new Set([value]);
    const result = new Set();
    for (let i = 0; i < value.length - 1; i++) result.add(value.slice(i, i + 2));
    return result;
}

export function similarity(a, b) {
    const x = normalizeText(a);
    const y = normalizeText(b);
    if (!x && !y) return 1;
    if (!x || !y) return 0;
    if (x === y) return 1;
    const ax = bigrams(x);
    const by = bigrams(y);
    let intersection = 0;
    for (const gram of ax) if (by.has(gram)) intersection += 1;
    const union = ax.size + by.size - intersection;
    return union ? intersection / union : 0;
}
