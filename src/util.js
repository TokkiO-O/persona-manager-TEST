/** Pure string / collection helpers */

export const escapeHtml = (v = '') => String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

export const normalizeText = (v = '') => String(v)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();

export function groupBy(items, keyFn) {
    const map = new Map();
    for (const item of items) {
        const key = keyFn(item);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
    }
    return [...map.values()];
}


/** Compare semver-ish strings: a>b → 1, a<b → -1, equal → 0 */
export function compareSemver(a, b) {
    const norm = (v) => String(v || '')
        .trim()
        .replace(/^[vV]/, '')
        .split(/[^0-9]+/)
        .filter(Boolean)
        .map(n => parseInt(n, 10) || 0);
    const pa = norm(a);
    const pb = norm(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x > y) return 1;
        if (x < y) return -1;
    }
    return 0;
}

export function isRemoteNewer(remote, local) {
    return compareSemver(remote, local) > 0;
}
