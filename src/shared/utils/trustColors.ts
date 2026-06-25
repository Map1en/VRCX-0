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
        labelKey:
            'view.settings.appearance.user_colors.trust_levels.known_user',
        presets: Object.freeze(['#ff7b42'])
    },
    {
        key: 'veteran',
        className: 'x-tag-veteran',
        labelKey:
            'view.settings.appearance.user_colors.trust_levels.trusted_user',
        presets: Object.freeze([
            '#b18fff',
            '#8143e6',
            '#ff69b4',
            '#b52626',
            '#ffd000',
            '#abcdef'
        ])
    },
    {
        key: 'vip',
        className: 'x-tag-vip',
        labelKey:
            'view.settings.appearance.user_colors.trust_levels.vrchat_team',
        presets: Object.freeze(['#ff2626'])
    },
    {
        key: 'troll',
        className: 'x-tag-troll',
        labelKey: 'view.settings.appearance.user_colors.trust_levels.nuisance',
        presets: Object.freeze(['#782f2f'])
    }
]);

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

type TrustColorKey = keyof typeof TRUST_COLOR_DEFAULTS;
type TrustColorMap = Record<TrustColorKey, string>;
type TrustColorUser = Record<string, unknown>;

function parseTrustColorSource(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value));
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

function isTrustColorKey(value: string): value is TrustColorKey {
    return Object.prototype.hasOwnProperty.call(TRUST_COLOR_DEFAULTS, value);
}

export function normalizeTrustColors(value: unknown): TrustColorMap {
    const source = parseTrustColorSource(value);
    const normalized: TrustColorMap = { ...TRUST_COLOR_DEFAULTS };
    for (const key of Object.keys(TRUST_COLOR_DEFAULTS) as TrustColorKey[]) {
        const color = String(source[key] || '').trim();
        normalized[key] = HEX_COLOR_PATTERN.test(color)
            ? color.toUpperCase()
            : TRUST_COLOR_DEFAULTS[key];
    }
    return normalized;
}

export function isValidTrustColor(value: unknown) {
    return HEX_COLOR_PATTERN.test(String(value || '').trim());
}

export function resolveTrustColorKey(user: unknown): TrustColorKey {
    const source =
        user && (typeof user === 'object' || typeof user === 'function')
            ? (Object.fromEntries(
                  Object.entries(user)
              ) satisfies TrustColorUser)
            : {};
    if (source.$isModerator) {
        return 'vip';
    }
    if (source.$isTroll || source.$isProbableTroll) {
        return 'troll';
    }
    const classKey = String(
        source.$trustClass || source.trustClass || ''
    ).replace(/^x-tag-/, '');
    return isTrustColorKey(classKey) ? classKey : 'untrusted';
}

export function getTrustColor(
    user: unknown,
    trustColors: unknown = TRUST_COLOR_DEFAULTS
) {
    const normalized = normalizeTrustColors(trustColors);
    return normalized[resolveTrustColorKey(user)] || normalized.untrusted;
}

export type { TrustColorKey, TrustColorMap };
