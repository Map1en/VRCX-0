import { sharedFeedFiltersDefaults } from '@/shared/constants/feedFilters';
export {
    DEFAULT_OVERLAY_ACTIVITY_FILTERS,
    DEFAULT_VR_NOTIFICATION_ACTIVITY_FILTERS,
    DEFAULT_WEBHOOK_ACTIVITY_FILTERS,
    OVERLAY_ACTIVITY_CATEGORIES,
    OVERLAY_ACTIVITY_RAW_TYPES,
    OVERLAY_ACTIVITY_SCOPES,
    OVERLAY_ACTIVITY_TYPE_DEFINITIONS,
    OVERLAY_ACTIVITY_TYPE_DEFINITION_BY_KEY,
    migrateLegacySharedFeedWristFilters,
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

export function parseWebJson(response: any) {
    if (response?.data && typeof response.data === 'object') {
        return response.data;
    }
    if (typeof response?.data === 'string' && response.data.trim()) {
        return JSON.parse(response.data);
    }
    return {};
}

export function buildOpenAiModelsEndpoint(endpoint: any) {
    const baseEndpoint = endpoint || DEFAULT_TRANSLATION_ENDPOINT;
    try {
        const url = new URL(baseEndpoint);
        const basePath = url.pathname.replace(/\/+$/, '');
        if (basePath.endsWith('/chat/completions')) {
            url.pathname = basePath.replace(/\/chat\/completions$/, '/models');
        } else if (!basePath.endsWith('/models')) {
            url.pathname = `${basePath}/models`;
        }
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        const normalized = baseEndpoint.endsWith('/')
            ? baseEndpoint.slice(0, -1)
            : baseEndpoint;
        if (normalized.endsWith('/models')) {
            return normalized;
        }
        if (normalized.includes('/chat/completions')) {
            return normalized.replace(/\/chat\/completions$/, '/models');
        }
        return `${normalized}/models`;
    }
}

export function normalizeSharedFeedFilters(value: any = {}) {
    return {
        noty: {
            ...sharedFeedFiltersDefaults.noty,
            ...(value?.noty && typeof value.noty === 'object' ? value.noty : {})
        }
    };
}

export function normalizeTablePageSizes(input: any) {
    const source = Array.isArray(input) ? input : TABLE_PAGE_SIZE_DEFAULTS;
    const values = source
        .map((value: any) => Number.parseInt(value, 10))
        .filter(
            (value: any) => Number.isFinite(value) && value > 0 && value <= 1000
        );
    const uniqueSorted = Array.from(new Set(values)).sort(
        (left: any, right: any) => left - right
    );
    return uniqueSorted.length ? uniqueSorted : [...TABLE_PAGE_SIZE_DEFAULTS];
}

export function buildTablePageSizeOptions(draftSizes: any) {
    return normalizeTablePageSizes([
        ...TABLE_PAGE_SIZE_SUGGESTIONS,
        ...(Array.isArray(draftSizes) ? draftSizes : [])
    ]);
}

export function filterTablePageSizeOptions(options: any, query: any) {
    const searchTerm = String(query || '').trim();
    if (!searchTerm) {
        return Array.isArray(options) ? options : [];
    }
    return (Array.isArray(options) ? options : []).filter((size: any) =>
        String(size).includes(searchTerm)
    );
}

export function parseIntegerInput(value: any, fallback: any) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeCheckedState(value: unknown): boolean {
    return value === true;
}

export function isValidFontFamilyList(value: any): boolean {
    const normalized = String(value ?? '').trim();
    if (!normalized || normalized.length > MAX_CUSTOM_FONT_FAMILY_LENGTH) {
        return false;
    }

    return normalized
        .split(',')
        .every((entry: any) => FONT_FAMILY_TOKEN_PATTERN.test(entry.trim()));
}

export function quoteCssFontFamilyName(value: any): string {
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

export function createCustomFontDraftFromPrefs(prefs: any): CustomFontDraft {
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

export function formatByteSize(value: any) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        units.length - 1
    );
    const amount = bytes / 1024 ** exponent;
    return `${amount.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}
