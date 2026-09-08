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

/** Parse a CSS color (rgb()/rgba()/hex) into {r,g,b,a}. Null if unparsable. */
export function parseCssColor(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (m) {
        const p = m[1].split(',').map(x => parseFloat(x.trim()));
        return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0, a: p.length > 3 ? p[3] : 1 };
    }
    const h = str.match(/#([0-9a-f]{3,8})/i);
    if (h) {
        let hex = h[1];
        if (hex.length === 3 || hex.length === 4) hex = hex.split('').map(c => c + c).join('');
        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16),
            a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
        };
    }
    return null;
}

function lumFactor(v) {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(r, g, b) {
    return 0.2126 * lumFactor(r) + 0.7152 * lumFactor(g) + 0.0722 * lumFactor(b);
}

/**
 * Pick a readable ink color for text sitting on `bg` (a computed CSS color).
 * If bg is semi-transparent it is composited over `fallbackBg` (defaults to
 * white). Returns a dark ink on light surfaces and a light ink on dark ones,
 * guaranteeing contrast regardless of the ST theme variable pairing.
 */
export function computeReadableInk(bg, fallbackBg = null) {
    let color = parseCssColor(bg);
    if (!color) color = { r: 255, g: 255, b: 255, a: 1 };
    if (color.a < 1) {
        const under = parseCssColor(fallbackBg) || { r: 255, g: 255, b: 255, a: 1 };
        color = {
            r: color.r * color.a + under.r * (1 - color.a),
            g: color.g * color.a + under.g * (1 - color.a),
            b: color.b * color.a + under.b * (1 - color.a),
            a: 1,
        };
    }
    const L = relativeLuminance(color.r, color.g, color.b);
    return L > 0.5 ? '#1a1a1f' : '#f4f4f0';
}
