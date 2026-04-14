export const TRUST_COLOR_DEFAULTS = Object.freeze({
    untrusted: '#CCCCCC',
    basic: '#1778FF',
    known: '#2BCF5C',
    trusted: '#FF7B42',
    veteran: '#B18FFF',
    vip: '#FF2626',
    troll: '#782F2F'
});

export const TRUST_COLOR_ENTRIES = Object.freeze([
    {
        key: 'untrusted',
        className: 'x-tag-untrusted',
        labelKey: 'view.settings.appearance.user_colors.trust_levels.visitor',
        presets: Object.freeze(['#CCCCCC'])
    },
    {
        key: 'basic',
        className: 'x-tag-basic',
        labelKey: 'view.settings.appearance.user_colors.trust_levels.new_user',
        presets: Object.freeze(['#1778ff'])
    },
    {
        key: 'known',
        className: 'x-tag-known',
        labelKey: 'view.settings.appearance.user_colors.trust_levels.user',
        presets: Object.freeze(['#2bcf5c'])
    },
    {
        key: 'trusted',
        className: 'x-tag-trusted',
        labelKey: 'view.settings.appearance.user_colors.trust_levels.known_user',
        presets: Object.freeze(['#ff7b42'])
    },
    {
        key: 'veteran',
        className: 'x-tag-veteran',
        labelKey: 'view.settings.appearance.user_colors.trust_levels.trusted_user',
        presets: Object.freeze(['#b18fff', '#8143e6', '#ff69b4', '#b52626', '#ffd000', '#abcdef'])
    },
    {
        key: 'vip',
        className: 'x-tag-vip',
        labelKey: 'view.settings.appearance.user_colors.trust_levels.vrchat_team',
        presets: Object.freeze(['#ff2626'])
    },
    {
        key: 'troll',
        className: 'x-tag-troll',
        labelKey: 'view.settings.appearance.user_colors.trust_levels.nuisance',
        presets: Object.freeze(['#782f2f'])
    }
]);

const TRUST_COLOR_STYLE_ID = 'trustColor';
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function parseTrustColorSource(value) {
    if (value && typeof value === 'object') {
        return value;
    }
    if (typeof value !== 'string' || !value.trim()) {
        return {};
    }
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function normalizeTrustColors(value) {
    const source = parseTrustColorSource(value);
    const normalized = {};
    for (const key of Object.keys(TRUST_COLOR_DEFAULTS)) {
        const color = String(source[key] || '').trim();
        normalized[key] = HEX_COLOR_PATTERN.test(color)
            ? color.toUpperCase()
            : TRUST_COLOR_DEFAULTS[key];
    }
    return normalized;
}

export function isValidTrustColor(value) {
    return HEX_COLOR_PATTERN.test(String(value || '').trim());
}

export function applyTrustColorClasses(value) {
    if (typeof document === 'undefined') {
        return;
    }
    const trustColors = normalizeTrustColors(value);
    document.getElementById(TRUST_COLOR_STYLE_ID)?.remove();
    const style = document.createElement('style');
    style.id = TRUST_COLOR_STYLE_ID;
    style.textContent = Object.entries(trustColors)
        .map(([key, color]) => `.x-tag-${key} { color: ${color} !important; border-color: ${color} !important; }`)
        .join(' ');
    document.head.appendChild(style);
}

export function resolveTrustColorKey(user) {
    if (user?.$isModerator) {
        return 'vip';
    }
    if (user?.$isTroll || user?.$isProbableTroll) {
        return 'troll';
    }
    const classKey = String(user?.$trustClass || user?.trustClass || '').replace(/^x-tag-/, '');
    return Object.prototype.hasOwnProperty.call(TRUST_COLOR_DEFAULTS, classKey)
        ? classKey
        : 'untrusted';
}

export function getTrustColor(user, trustColors = TRUST_COLOR_DEFAULTS) {
    const normalized = normalizeTrustColors(trustColors);
    return normalized[resolveTrustColorKey(user)] || normalized.untrusted;
}
