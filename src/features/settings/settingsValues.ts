export {
    DEFAULT_HMD_NOTIFICATION_ACTIVITY_FILTERS,
    DEFAULT_OVERLAY_ACTIVITY_FILTERS,
    DEFAULT_TTS_NOTIFICATION_ACTIVITY_FILTERS,
    DEFAULT_VR_NOTIFICATION_ACTIVITY_FILTERS,
    DEFAULT_WEBHOOK_ACTIVITY_FILTERS,
    HMD_DEFAULT_SCOPES,
    OVERLAY_ACTIVITY_CATEGORIES,
    OVERLAY_ACTIVITY_RAW_TYPES,
    OVERLAY_ACTIVITY_SCOPES,
    OVERLAY_ACTIVITY_TYPE_DEFINITIONS,
    OVERLAY_ACTIVITY_TYPE_DEFINITION_BY_KEY,
    disabledOverlayActivityFilterProfileFromDefinitions,
    normalizeOverlayActivityFilters,
    overlayActivityTypeLabelKey,
    parseOverlayActivityFilters,
    type OverlayActivityCategory,
    type OverlayActivityFavoriteGroupKeys,
    type OverlayActivityFiltersPreference,
    type OverlayActivityRule,
    type OverlayActivityScope
} from '@/shared/constants/overlayActivityFilters';

export const TABLE_PAGE_SIZE_SUGGESTIONS = [
    5, 10, 15, 20, 25, 30, 50, 75, 100, 150, 200, 250, 500, 1000
];
export const TABLE_PAGE_SIZE_DEFAULTS = [10, 15, 20, 25, 50, 100];
export const DEFAULT_TRANSLATION_ENDPOINT =
    'https://api.openai.com/v1/chat/completions';
export const DEFAULT_TRANSLATION_MODEL = 'gpt-4o-mini';
export const MAX_CUSTOM_FONT_FAMILY_LENGTH = 200;

const FONT_FAMILY_TOKEN_PATTERN =
    /^([-_\p{L}][\p{L}\p{N}_\s-]*|'(?:\\.|[^'\\])+'|"(?:\\.|[^"\\])+")$/u;
const CSS_GENERIC_FONT_FAMILIES = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'ui-rounded',
    'emoji',
    'math',
    'fangsong'
]);

export type CustomFontDraft = {
    primary: string;
    secondary: string;
    override: string;
};

export type CustomFontMode = 'installed' | 'css';

export function parseWebJson(response: { data?: unknown } | null | undefined) {
    if (response?.data && typeof response.data === 'object') {
        return response.data;
    }
    if (typeof response?.data === 'string' && response.data.trim()) {
        return JSON.parse(response.data);
    }
    return {};
}

export function normalizeTablePageSizes(input: unknown): number[] {
    const source = Array.isArray(input) ? input : TABLE_PAGE_SIZE_DEFAULTS;
    const values = source
        .map((value) => Number.parseInt(String(value), 10))
        .filter(
            (value) => Number.isFinite(value) && value > 0 && value <= 1000
        );
    const uniqueSorted = Array.from(new Set(values)).sort(
        (left, right) => left - right
    );
    return uniqueSorted.length ? uniqueSorted : [...TABLE_PAGE_SIZE_DEFAULTS];
}

export function buildTablePageSizeOptions(draftSizes: unknown) {
    return normalizeTablePageSizes([
        ...TABLE_PAGE_SIZE_SUGGESTIONS,
        ...(Array.isArray(draftSizes) ? draftSizes : [])
    ]);
}

export function filterTablePageSizeOptions(
    options: readonly number[] | null | undefined,
    query: unknown
) {
    const searchTerm = String(query || '').trim();
    if (!searchTerm) {
        return Array.isArray(options) ? options : [];
    }
    return (Array.isArray(options) ? options : []).filter((size) =>
        String(size).includes(searchTerm)
    );
}

export function parseIntegerInput(value: unknown, fallback: number) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeCheckedState(value: unknown): boolean {
    return value === true;
}

export function isValidFontFamilyList(value: unknown): boolean {
    const normalized = String(value ?? '').trim();
    if (!normalized || normalized.length > MAX_CUSTOM_FONT_FAMILY_LENGTH) {
        return false;
    }

    return normalized
        .split(',')
        .every((entry) => FONT_FAMILY_TOKEN_PATTERN.test(entry.trim()));
}

export function quoteCssFontFamilyName(value: unknown): string {
    const name = String(value ?? '').trim();
    if (!name) {
        return '';
    }
    if (
        (name.startsWith("'") && name.endsWith("'")) ||
        (name.startsWith('"') && name.endsWith('"')) ||
        CSS_GENERIC_FONT_FAMILIES.has(name.toLowerCase())
    ) {
        return name;
    }
    return `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function composeCustomFontFamily(
    value: Partial<CustomFontDraft>
): string {
    const override = String(value?.override ?? '').trim();
    if (override) {
        return override;
    }

    const primary = String(value?.primary ?? '').trim();
    const secondary = String(value?.secondary ?? '').trim();
    const parts = [];
    if (primary) {
        parts.push(quoteCssFontFamilyName(primary));
    }
    if (secondary && secondary.toLowerCase() !== primary.toLowerCase()) {
        parts.push(quoteCssFontFamilyName(secondary));
    }
    if (!parts.length) {
        return '';
    }
    parts.push('system-ui');
    return parts.join(', ');
}

export function createEffectiveCustomFontDraft(
    value: Partial<CustomFontDraft>,
    mode: CustomFontMode
): CustomFontDraft {
    const draft = {
        primary: String(value.primary ?? '').trim(),
        secondary: String(value.secondary ?? '').trim(),
        override: String(value.override ?? '').trim()
    };

    if (mode === 'css') {
        return {
            primary: '',
            secondary: '',
            override: draft.override
        };
    }

    return {
        primary: draft.primary,
        secondary: draft.secondary,
        override: ''
    };
}

export function createCustomFontDraftFromPrefs(
    prefs: Record<string, unknown> | null | undefined
): CustomFontDraft {
    const primary = String(prefs?.customFontPrimary ?? '').trim();
    const secondary = String(prefs?.customFontSecondary ?? '').trim();
    const override = String(prefs?.customFontOverride ?? '').trim();
    const isCustomActive = String(prefs?.appFontFamily ?? '') === 'custom';
    const legacyEffective = String(prefs?.customFontFamily ?? '').trim();

    if (
        isCustomActive &&
        !primary &&
        !secondary &&
        !override &&
        legacyEffective
    ) {
        return {
            primary: '',
            secondary: '',
            override: legacyEffective
        };
    }

    return {
        primary,
        secondary,
        override
    };
}
