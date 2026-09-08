import { COMMON_STOPWORDS, SHORT_TEXT_THRESHOLD } from './constants.js';
import { state } from './state.js';
import { escapeHtml, normalizeText } from './util.js';
import { similarity } from './similarity.js';

/* ---------- 对比 / 差异引擎 ---------- */

/** Short heading line: section title, not a long prose sentence */
export function isSectionTitleLine(line) {
    const t = String(line || '').trim();
    if (!t || t.length > 36) return false;
    if (/^#{1,6}\s/.test(t)) return true;
    if (/[:：]\s*$/.test(t) && t.length <= 24) return true;
    if (/^\s*[\w\u4e00-\u9fff./_-]{1,20}\s*[:：]/.test(t) && t.length <= 28) return true;
    // Bare short labels without ending punctuation (e.g. 五官细节 / 女)
    if (t.length <= 16 && !/[。！？；;,.!?]$/.test(t) && !/\s{2,}/.test(t)) return true;
    return false;
}

/**
 * Split into sections: title line merges with following body until next title.
 * Avoids "仅基准: 发型与发色" while body text exists on both sides unmatched.
 */
export function splitUnits(text) {
    const raw = String(text || '').replace(/\r\n?/g, '\n');
    if (!raw.trim()) return [];
    const lines = raw.split('\n');

    const units = [];
    let buf = [];
    const flush = () => {
        const t = buf.join('\n').trim();
        if (t) units.push(t);
        buf = [];
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed) {
            // blank line: if buffer has content and next is a title, flush
            if (buf.length && i + 1 < lines.length && isSectionTitleLine(lines[i + 1])) {
                flush();
            } else if (buf.length) {
                buf.push(line);
            }
            continue;
        }
        if (isSectionTitleLine(line) && buf.length) {
            flush();
            buf.push(line);
            continue;
        }
        buf.push(line);
    }
    flush();

    if (units.length >= 2) return units;

    // Fallback: paragraphs then lines
    let parts = raw.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    if (parts.length <= 1) parts = lines.map(s => s.trim()).filter(Boolean);
    return parts.length ? parts : [raw.trim()];
}

/** Prefer matching units that share the same first-line title */
export function unitTitleKey(unit) {
    const first = String(unit || '').split('\n').map(s => s.trim()).find(Boolean) || '';
    return normalizeText(first.replace(/[:：]\s*$/, '')).slice(0, 24);
}

export function tokenize(text) {
    return String(text).match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) || [];
}

export function lcsDiff(aTokens, bTokens) {
    const n = aTokens.length;
    const m = bTokens.length;
    if (n * m > 12000) return [{ type: 'replace', a: aTokens, b: bTokens }];
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = aTokens[i] === bTokens[j]
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const out = [];
    let i = 0, j = 0;
    const push = (type, a, b) => {
        if (!a.length && !b.length) return;
        const last = out[out.length - 1];
        if (last && last.type === type) {
            last.a.push(...a);
            last.b.push(...b);
        } else out.push({ type, a: [...a], b: [...b] });
    };
    while (i < n && j < m) {
        if (aTokens[i] === bTokens[j]) {
            push('same', [aTokens[i]], [bTokens[j]]);
            i++; j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            push('remove', [aTokens[i]], []);
            i++;
        } else {
            push('add', [], [bTokens[j]]);
            j++;
        }
    }
    if (i < n) push('remove', aTokens.slice(i), []);
    if (j < m) push('add', [], bTokens.slice(j));
    return out;
}

export function inlineDiffHtml(a, b) {
    const parts = lcsDiff(tokenize(a), tokenize(b));
    let left = '';
    let right = '';
    for (const part of parts) {
        const L = escapeHtml(part.a.join(''));
        const R = escapeHtml(part.b.join(''));
        if (part.type === 'same') {
            left += L;
            right += R;
        } else if (part.type === 'remove') {
            left += L ? `<mark class="pmp18-del">${L}</mark>` : '';
        } else if (part.type === 'add') {
            right += R ? `<mark class="pmp18-add">${R}</mark>` : '';
        } else {
            left += L ? `<mark class="pmp18-del">${L}</mark>` : '';
            right += R ? `<mark class="pmp18-add">${R}</mark>` : '';
        }
    }
    return { left, right };
}

export function unorderedDiff(aText, bText) {
    const aUnits = splitUnits(aText);
    const bUnits = splitUnits(bText);
    const usedB = new Set();
    const pairs = [];
    const soft = state.settings.softMatchThreshold ?? 0.35;

    // Pass 0: same section title key (e.g. 发型与发色 / 五官细节)
    for (let i = 0; i < aUnits.length; i++) {
        const ta = unitTitleKey(aUnits[i]);
        if (!ta) continue;
        for (let j = 0; j < bUnits.length; j++) {
            if (usedB.has(j)) continue;
            if (unitTitleKey(bUnits[j]) === ta) {
                const s = similarity(aUnits[i], bUnits[j]);
                const type = s >= 0.92 || normalizeText(aUnits[i]) === normalizeText(bUnits[j]) ? 'same' : 'replace';
                pairs.push({ type, a: aUnits[i], b: bUnits[j], ai: i, bj: j, matched: true });
                usedB.add(j);
                break;
            }
        }
    }

    // Pass 1: exact full-unit match for remaining
    for (let i = 0; i < aUnits.length; i++) {
        if (pairs.some(p => p.ai === i)) continue;
        const na = normalizeText(aUnits[i]);
        let matched = false;
        for (let j = 0; j < bUnits.length; j++) {
            if (usedB.has(j)) continue;
            if (normalizeText(bUnits[j]) === na) {
                pairs.push({ type: 'same', a: aUnits[i], b: bUnits[j], ai: i, bj: j });
                usedB.add(j);
                matched = true;
                break;
            }
        }
        if (!matched) pairs.push({ type: 'pending', a: aUnits[i], b: null, ai: i, bj: -1 });
    }

    // Pass 2: best similarity for pending
    for (const p of pairs) {
        if (p.type !== 'pending') continue;
        let bestJ = -1;
        let bestScore = 0;
        for (let j = 0; j < bUnits.length; j++) {
            if (usedB.has(j)) continue;
            const s = similarity(p.a, bUnits[j]);
            if (s > bestScore) {
                bestScore = s;
                bestJ = j;
            }
        }
        if (bestJ >= 0 && bestScore >= soft) {
            p.type = bestScore >= 0.92 ? 'same' : 'replace';
            p.b = bUnits[bestJ];
            p.bj = bestJ;
            usedB.add(bestJ);
        } else {
            p.type = 'remove';
            p.b = '';
        }
    }

    for (let j = 0; j < bUnits.length; j++) {
        if (usedB.has(j)) continue;
        pairs.push({ type: 'add', a: '', b: bUnits[j], ai: -1, bj: j });
    }

    pairs.sort((x, y) => {
        if (x.ai >= 0 && y.ai >= 0) return x.ai - y.ai;
        if (x.ai >= 0) return -1;
        if (y.ai >= 0) return 1;
        return x.bj - y.bj;
    });
    return pairs;
}

export function countPairStats(rows) {
    return {
        same: rows.filter(r => r.type === 'same').length,
        replace: rows.filter(r => r.type === 'replace').length,
        remove: rows.filter(r => r.type === 'remove').length,
        add: rows.filter(r => r.type === 'add').length,
    };
}

export function diffModeClass(score) {
    if (score >= 0.85) return 'mode-high';
    if (score >= 0.5) return 'mode-mid';
    return 'mode-low';
}

export function looksStructured(text) {
    const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) return false;
    const field = lines.filter(l => /^[\w\u4e00-\u9fff./_-]+\s*[:：]/.test(l)).length;
    return field / lines.length >= 0.4;
}

/** Shared short facts (numbers, measures, short phrases) for cross-structure compare
 *  @param {string} aText
 *  @param {string} bText
 *  @param {object} [opts]
 *  @param {boolean} [opts.shortMode=false] relax length floor and skip a few stopwords
 */
/* ---------- 共同片段：按字段对齐（中英同义字段 / 同义属性值） ---------- */

/** 字段名 → 规范键（眼睛/eyes 同一键；头发/hair 另一键） */
const FIELD_CANON_MAP = [
    // 眼睛
    [['eyes', 'eye', 'eye color', 'eyecolor', 'eye_color', '瞳', '瞳色', '瞳孔', '眼睛', '眼珠', '虹膜'], 'eye'],
    // 头发 / 发色
    [['hair', 'hair color', 'haircolor', 'hair_colour', '发型', '发色', '头发', '髮型', '髮色', '头发颜色', '发型与发色'], 'hair'],
    // 肤色
    [['skin', 'skin color', 'skincolour', '肤色', '皮肤', '肤'], 'skin'],
    // 身高
    [['height', '身高', 'height_cm'], 'height'],
    // 体重
    [['weight', '体重', 'weight_kg'], 'weight'],
    // 性别
    [['gender', 'sex', '性别', 'gender_identity'], 'gender'],
    // 年龄
    [['age', '年龄', '年纪'], 'age'],
    // 姓名
    [['name', '姓名', '名字', '名称'], 'name'],
    // 性格
    [['personality', '性格', 'personality_traits'], 'personality'],
];

/** 常见颜色：中英互通 */
const VALUE_SYNONYMS = [
    [['棕色', '褐色', 'brown', 'Brunette'], 'brown'],
    [['黑色', '黑', 'black'], 'black'],
    [['白色', '白', 'white'], 'white'],
    [['红色', '红', 'red'], 'red'],
    [['蓝色', '蓝', 'blue'], 'blue'],
    [['绿色', '绿', 'green'], 'green'],
    [['黄色', '黄', '金', '金色', 'yellow', 'blonde', 'blond', 'gold', 'golden'], 'yellow'],
    [['粉色', '粉', 'pink'], 'pink'],
    [['紫色', '紫', 'purple', 'violet'], 'purple'],
    [['灰色', '灰', 'gray', 'grey'], 'gray'],
    [['银色', '银', 'silver'], 'silver'],
    [['橙色', '橙', '橘', '橙色', 'orange'], 'orange'],
    [['青色', '青', 'cyan', 'teal'], 'cyan'],
];

function canonFieldKey(raw) {
    const k = normalizeText(String(raw || '')).toLowerCase().replace(/[\s_\-./]/g, '');
    if (!k) return '';
    for (const [aliases, canon] of FIELD_CANON_MAP) {
        for (const a of aliases) {
            const na = normalizeText(a).toLowerCase().replace(/[\s_\-./]/g, '');
            if (k === na || k.includes(na) || na.includes(k)) return canon;
        }
    }
    return k.slice(0, 16);
}

function canonValue(raw) {
    const t = String(raw || '').trim();
    if (!t) return '';
    const low = t.toLowerCase();
    for (const [aliases, canon] of VALUE_SYNONYMS) {
        for (const a of aliases) {
            if (t === a || low === String(a).toLowerCase()) return canon;
        }
    }
    // 包含关系：发色棕色 → 仍单独处理；这里只规范化纯色词
    for (const [aliases, canon] of VALUE_SYNONYMS) {
        for (const a of aliases) {
            if (t.includes(a) && t.length <= String(a).length + 2) return canon;
        }
    }
    return normalizeText(t).toLowerCase();
}

/**
 * 从文本抽出 { fieldCanon, valueRaw, valueCanon, line } 列表
 * 支持 "eyes: brown" / "眼睛：棕色" / "发色棕色"（无冒号时用前缀归类）
 */
function extractFieldValues(text) {
    const out = [];
    const lines = String(text || '').split(/\n/);
    for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        const m = t.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
        if (m) {
            const field = canonFieldKey(m[1]);
            const valueRaw = m[2].trim();
            if (!field || !valueRaw) continue;
            out.push({ field, valueRaw, valueCanon: canonValue(valueRaw), line: t });
            continue;
        }
        // 无冒号：前缀+值（发色棕色、瞳色琥珀）
        const pref = t.match(/^([\u4e00-\u9fff]{1,6}|[A-Za-z_]{2,16})([\u4e00-\u9fffA-Za-z0-9]{1,12})$/);
        if (pref) {
            const field = canonFieldKey(pref[1]);
            const valueRaw = pref[2];
            // 仅当前缀能识别为已知字段时才采纳，避免误切普通词
            const known = FIELD_CANON_MAP.some(([, c]) => c === field);
            if (known && valueRaw) {
                out.push({ field, valueRaw, valueCanon: canonValue(valueRaw), line: t });
            }
        }
    }
    return out;
}

/**
 * 共同片段：
 * 1) 优先：同规范字段下的同规范值（eyes 棕色 ↔ 眼睛 brown；≠ hair 棕色）
 * 2) 其次：较长中文短语 / 带单位数字，且不与冲突字段绑定
 * 3) 丢弃短颜色词在不同字段上的命中
 */
export function extractSharedSnippets(aText, bText, opts = {}) {
    const shortMode = !!opts.shortMode;
    const a = String(aText || '');
    const b = String(bText || '');
    if (!a || !b) return [];

    const aFields = extractFieldValues(a);
    const bFields = extractFieldValues(b);
    const shared = [];
    const seen = new Set();

    const push = (label) => {
        const s = String(label || '').trim();
        if (!s || s.length < 2 || s.length > 24) return;
        const k = normalizeText(s);
        if (!k || seen.has(k)) return;
        // 被更长片段包含则跳过（稍后按长度排序再滤一次）
        seen.add(k);
        shared.push(s);
    };

    // --- 1) 字段对齐匹配 ---
    for (const fa of aFields) {
        for (const fb of bFields) {
            if (fa.field !== fb.field) continue;
            if (!fa.valueCanon || !fb.valueCanon) continue;
            if (fa.valueCanon !== fb.valueCanon) continue;
            // 展示用：优先较长的原文值；中英不同则拼成「棕/brown」感标签用较短中文或原文
            const label = fa.valueRaw.length >= fb.valueRaw.length ? fa.valueRaw : fb.valueRaw;
            // 避免把整个长句当片段
            if (label.length <= 20) push(label);
        }
    }

    // --- 2) 长中文短语 / 度量（不跨冲突字段）---
    const minLen = shortMode ? 2 : 3;
    const candidates = new Set();
    for (const x of a.match(/\d+(?:\.\d+)?\s*(?:cm|kg|mm|m|岁|%|斤)/gi) || []) {
        if (String(x).trim().length >= minLen) candidates.add(String(x).trim());
    }
    for (const x of a.match(/[\u4e00-\u9fff]{4,16}/g) || []) { // 提高到 4 字，减少「棕色」
        candidates.add(x);
    }

    const fieldOf = (text, snip) => {
        for (const fv of extractFieldValues(text)) {
            if (fv.valueRaw.includes(snip) || snip.includes(fv.valueRaw)) return fv.field;
        }
        // 行级：含 snip 的 key:value
        for (const line of String(text).split('\n')) {
            if (!line.includes(snip)) continue;
            const m = line.match(/^([^:：]{1,40})[:：]/);
            if (m) return canonFieldKey(m[1]);
        }
        return '';
    };

    const bLow = b.toLocaleLowerCase();
    for (const c of candidates) {
        if (!isMeaningfulSnippet(c, minLen)) continue;
        if (COMMON_STOPWORDS.has(c.toLocaleLowerCase()) || COMMON_STOPWORDS.has(c)) continue;
        if (!(b.includes(c) || bLow.includes(c.toLocaleLowerCase()))) continue;
        const fa = fieldOf(a, c);
        const fb = fieldOf(b, c);
        if (fa && fb && fa !== fb) continue; // 不同字段同词 → 丢弃
        push(c);
    }

    return shared
        .sort((x, y) => y.length - x.length)
        .filter((s, _, arr) => {
            const k = normalizeText(s);
            // 去掉被更长共同片段包含的短词
            for (const other of arr) {
                if (other !== s && normalizeText(other).includes(k) && other.length > s.length) return false;
            }
            return true;
        })
        .slice(0, 24);
}

/** 过滤字段名、纯英文填充、过短无意义 token */
function isMeaningfulSnippet(s, minLen) {
    const t = String(s || '').trim();
    if (t.length < minLen || t.length > 20) return false;
    // pure ASCII identifier / field name (Personality, Basic_Info, name, and…)
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(t)) return false;
    // mostly punctuation
    if (/^[\s\-_=:#.]+$/.test(t)) return false;
    // must contain Chinese or a digit (measurement / concrete token)
    if (!/[\u4e00-\u9fff0-9]/.test(t)) return false;
    // single digit alone
    if (/^\d$/.test(t)) return false;
    return true;
}

export function splitSentences(text) {
    const raw = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!raw) return [];
    // Split on sentence terminators but keep them attached to the preceding chunk
    const re = /[^。！？；…\.\!\?]+[。！？；…\.\!\?]+|[^。！？；…\.\!\?]+$/g;
    const out = [];
    let m;
    while ((m = re.exec(raw)) !== null) {
        const t = m[0].trim();
        if (t) out.push(t);
    }
    return out.length ? out : (raw.trim() ? [raw.trim()] : []);
}

export function isShortText(baseText, otherText) {
    const a = String(baseText || '').length;
    const b = String(otherText || '').length;
    return a < SHORT_TEXT_THRESHOLD && b < SHORT_TEXT_THRESHOLD;
}

export function shouldUseFragmentMode(baseText, otherText, score) {
    if (score < 0.15) return true;
    const aS = looksStructured(baseText);
    const bS = looksStructured(otherText);
    if (aS !== bS) return true;
    // v1.9.15: short personas (both sides under threshold) force fragment mode
    // because unit-level diff can't find any matches for terse descriptions.
    // Skip if BOTH are actually well-structured (e.g. two structured 200-char
    // short field lists — the existing unit diff handles them fine).
    if (isShortText(baseText, otherText) && !(aS && bS)) return true;
    return false;
}

export function highlightSnippets(text, snippets) {
    let html = escapeHtml(text);
    const sorted = [...snippets].sort((a, b) => b.length - a.length);
    for (const s of sorted) {
        const esc = escapeHtml(s);
        if (!esc) continue;
        html = html.split(esc).join(`<mark class="pmp18-share">${esc}</mark>`);
    }
    return html;
}

export function renderFragmentCompare(baseText, otherText, opts = {}) {
    const shortMode = !!opts.shortMode;
    const shared = extractSharedSnippets(baseText, otherText, { shortMode });
    const shareHtml = shared.length
        ? `<div class="pmp18-share-list">${shared.map(s => `<button type="button" class="pmp18-share-chip" data-action="jump-share" data-snippet="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>`
        : `<div class="pmp18-muted">未抽出可对齐的共同短句/数字（结构差异较大时属正常）</div>`;

    return {
        legendExtra: true,
        shortMode,
        sharedCount: shared.length,
        baseHtml: `<div class="pmp18-col-block frag">${highlightSnippets(baseText, shared)}</div>`,
        otherHtml: `<div class="pmp18-col-block frag">${highlightSnippets(otherText, shared)}</div>`,
        sharePanel: `<div class="pmp18-share-panel"><div class="pmp18-share-title">共同片段（${shared.length}）${shortMode ? ' · 短人设模式' : ''}</div>${shareHtml}</div>`,
    };
}

/** Symmetric blocks: side 'base' | 'other' */
export function renderFocusBlocks(baseText, otherText, side, showDiffOnly, opts = {}) {
    const { shortMode = false } = opts;
    const aText = shortMode ? splitSentences(baseText).join('\n') : baseText;
    const bText = shortMode ? splitSentences(otherText).join('\n') : otherText;
    const rows = unorderedDiff(aText, bText);
    const parts = [];
    let gapOnlyOther = 0; // 对方有、本侧无 → 累计，不逐行刷空壳
    let gapOnlyBase = 0;

    const flushGaps = () => {
        if (side === 'base' && gapOnlyOther > 0) {
            parts.push(`<div class="pmp18-gap-hint" title="这些内容在对方栏查看">… 对方另有 ${gapOnlyOther} 段独有内容</div>`);
            gapOnlyOther = 0;
        }
        if (side === 'other' && gapOnlyBase > 0) {
            parts.push(`<div class="pmp18-gap-hint" title="这些内容在基准栏查看">… 基准另有 ${gapOnlyBase} 段独有内容</div>`);
            gapOnlyBase = 0;
        }
    };

    for (const row of rows) {
        const textA = String(row.a || '').trim();
        const textB = String(row.b || '').trim();
        // 跳过空单元，避免「对方有 · 基准无」空壳
        if (row.type === 'remove' && !textA) continue;
        if (row.type === 'add' && !textB) continue;
        if (row.type === 'same' && !textA && !textB) continue;
        if (row.type === 'replace' && !textA && !textB) continue;

        const isPureSame = row.type === 'same' && (row.a === row.b || normalizeText(row.a) === normalizeText(row.b));
        if (showDiffOnly && isPureSame) continue;

        if (row.type === 'same') {
            flushGaps();
            if (isPureSame) {
                const lineCount = String(side === 'base' ? row.a : row.b).split('\n').length;
                parts.push(`<div class="pmp18-col-block same" data-pmp18-same-lines="${lineCount}">${escapeHtml(side === 'base' ? row.a : row.b)}</div>`);
            } else {
                const { left, right } = inlineDiffHtml(row.a, row.b);
                parts.push(`<div class="pmp18-col-block replace">${side === 'base' ? left : right}</div>`);
            }
            continue;
        }

        if (row.type === 'remove') {
            if (side === 'base') {
                flushGaps();
                parts.push(`<div class="pmp18-col-block remove"><span class="pmp18-tag">仅基准</span><mark class="pmp18-del">${escapeHtml(row.a)}</mark></div>`);
            } else {
                gapOnlyBase += 1; // 不画空壳
            }
            continue;
        }

        if (row.type === 'add') {
            if (side === 'other') {
                flushGaps();
                parts.push(`<div class="pmp18-col-block add"><span class="pmp18-tag">仅对方</span><mark class="pmp18-add">${escapeHtml(row.b)}</mark></div>`);
            } else {
                gapOnlyOther += 1;
            }
            continue;
        }

        flushGaps();
        const { left, right } = inlineDiffHtml(row.a || '', row.b || '');
        parts.push(`<div class="pmp18-col-block replace">${side === 'base' ? left : right}</div>`);
    }
    flushGaps();
    return parts.join('') || '<div class="pmp18-muted" style="padding:12px">无内容</div>';
}

export function renderCompareLegend(fragmentMode, shortMode = false) {
    const note = shortMode
        ? '短人设模式：按句匹配，共同词高亮；如有结构化字段请补全后对比。'
        : (fragmentMode
            ? '当前为跨结构/低相似模式：先标共同片段，再通读全文。'
            : '按章节对齐；粉=删、绿=增。连续相同段可折叠（>3 行）。');
    return `
        <div class="pmp18-legend">
            <span class="pmp18-legend-title">图例</span>
            <span class="pmp18-legend-item"><i class="pmp18-leg same"></i>相同/高度重合</span>
            <span class="pmp18-legend-item"><i class="pmp18-leg replace"></i>对应段有修改</span>
            <span class="pmp18-legend-item"><i class="pmp18-leg remove"></i>仅基准有</span>
            <span class="pmp18-legend-item"><i class="pmp18-leg add"></i>仅对方有</span>
            ${fragmentMode ? '<span class="pmp18-legend-item"><i class="pmp18-leg share"></i>共同片段（跨结构）</span>' : ''}
            <span class="pmp18-legend-note">${note}</span>
        </div>`;
}

