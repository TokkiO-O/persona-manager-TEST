/** Shared constants for Persona Manager */

export const EXT = 'Persona Manager';
export const VERSION = '1.9.25';
export const ROOT_ID = 'pmp18-root';
export const BUTTON_ID = 'pmp18-entry';
export const ENTRY_MARK = 'pmp18-entry-installed';
export const STORAGE_KEY = 'pmp18_settings';
export const REMOTE_MANIFEST_URLS = [
    'https://raw.githubusercontent.com/TokkiO-O/persona-manager/main/manifest.json',
    'https://cdn.jsdelivr.net/gh/TokkiO-O/persona-manager@main/manifest.json',
    'https://fastly.jsdelivr.net/gh/TokkiO-O/persona-manager@main/manifest.json',
    'https://raw.gitmirror.com/TokkiO-O/persona-manager/main/manifest.json',
    'https://ghproxy.net/https://raw.githubusercontent.com/TokkiO-O/persona-manager/main/manifest.json',
    'https://mirror.ghproxy.com/https://raw.githubusercontent.com/TokkiO-O/persona-manager/main/manifest.json',
];
export const REMOTE_CHANGELOG_URLS = [
    'https://raw.githubusercontent.com/TokkiO-O/persona-manager/main/CHANGELOG.md',
    'https://cdn.jsdelivr.net/gh/TokkiO-O/persona-manager@main/CHANGELOG.md',
    'https://fastly.jsdelivr.net/gh/TokkiO-O/persona-manager@main/CHANGELOG.md',
    'https://raw.gitmirror.com/TokkiO-O/persona-manager/main/CHANGELOG.md',
    'https://ghproxy.net/https://raw.githubusercontent.com/TokkiO-O/persona-manager/main/CHANGELOG.md',
    'https://mirror.ghproxy.com/https://raw.githubusercontent.com/TokkiO-O/persona-manager/main/CHANGELOG.md',
];
// Back-compat single URL (first mirror)
export const REMOTE_MANIFEST = REMOTE_MANIFEST_URLS[0];
export const REMOTE_CHANGELOG = REMOTE_CHANGELOG_URLS[0];

/** Words that produce noisy "shared" matches across unrelated personas */
export const COMMON_STOPWORDS = new Set([
    // Chinese generic labels
    '身高', '体重', '三围', '年龄', '血型', '星座', '性别', '种族', '国籍',
    '发色', '发型', '发长', '瞳色', '眼睛', '肤色', '身材', '体型', '外貌',
    '性格', '特点', '特征', '属性', '设定', '背景', '简介', '描述',
    '身份', '职业', '能力', '技能', '爱好', '喜欢', '讨厌', '擅长',
    '温柔', '可爱', '美丽', '漂亮', '帅气', '冷酷', '高冷', '傲娇', '腹黑',
    '开朗', '内向', '外向', '活泼', '安静', '沉默', '冷漠', '热情',
    '名字', '备注', '标题', '版本', '作者', '用户', '人设',
    '故事', '世界', '时间', '地点', '场景', '姓名', '昵称',
    // English field / schema noise (YAML/JSON persona cards)
    'name', 'type', 'body', 'age', 'and', 'the', 'for', 'with', 'from',
    'gender', 'height', 'weight', 'birthday', 'birthplace', 'blood',
    'style', 'shape', 'skin', 'hair', 'eyes', 'face', 'family', 'traits',
    'personality', 'appearance', 'background', 'nationality', 'species',
    'nickname', 'nicknames', 'english', 'basic', 'info', 'section',
    'occupation', 'core', 'mbti', 'zodiac', 'residence',
    'kg', 'cm', 'mm', '岁', '年', '月', '日',
]);

export const defaultSettings = {
    similarityThreshold: 0.55,
    includeSameNameInSimilar: true,
    showDiffOnly: false,
    softMatchThreshold: 0.35,
};

/** Below this total char count for BOTH sides, treat as "short persona":
 *  - force fragment (snippet) mode even if similarity is moderate
 *  - use sentence-level diff instead of unit-level
 *  - relax snippet length floor (3 -> 2) and skip a few stopwords
 */
export const SHORT_TEXT_THRESHOLD = 300;

/** When folding identical chunks, fold when this many consecutive lines
 *  are marked 'same' (and content is purely identical, not inline-diff). */
export const FOLD_SAME_MIN_LINES = 3;
