import { sharedFeedFiltersDefaults } from '@/shared/constants/feedFilters.js';

export const TABLE_PAGE_SIZE_SUGGESTIONS = [5, 10, 15, 20, 25, 30, 50, 75, 100, 150, 200, 250, 500, 1000];
export const TABLE_PAGE_SIZE_DEFAULTS = [10, 15, 20, 25, 50, 100];
export const DEFAULT_TRANSLATION_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const DEFAULT_TRANSLATION_MODEL = 'gpt-4o-mini';
export const MAX_CUSTOM_FONT_FAMILY_LENGTH = 200;

const FONT_FAMILY_TOKEN_PATTERN = /^([-_\p{L}][\p{L}\p{N}_\s-]*|'[^']+'|"[^"]+")$/u;

export function parseWebJson(response) {
    if (response?.data && typeof response.data === 'object') {
        return response.data;
    }
    if (typeof response?.data === 'string' && response.data.trim()) {
        return JSON.parse(response.data);
    }
    return {};
}

export function buildOpenAiModelsEndpoint(endpoint) {
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
        const normalized = baseEndpoint.endsWith('/') ? baseEndpoint.slice(0, -1) : baseEndpoint;
        if (normalized.endsWith('/models')) {
            return normalized;
        }
        if (normalized.includes('/chat/completions')) {
            return normalized.replace(/\/chat\/completions$/, '/models');
        }
        return `${normalized}/models`;
    }
}

export function normalizeSharedFeedFilters(value) {
    return {
        noty: {
            ...sharedFeedFiltersDefaults.noty,
            ...(value?.noty && typeof value.noty === 'object' ? value.noty : {})
        },
        wrist: {
            ...sharedFeedFiltersDefaults.wrist,
            ...(value?.wrist && typeof value.wrist === 'object' ? value.wrist : {})
        }
    };
}

export function normalizeTablePageSizes(input) {
    const source = Array.isArray(input) ? input : TABLE_PAGE_SIZE_DEFAULTS;
    const values = source
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value) && value > 0 && value <= 1000);
    const uniqueSorted = Array.from(new Set(values)).sort((left, right) => left - right);
    return uniqueSorted.length ? uniqueSorted : [...TABLE_PAGE_SIZE_DEFAULTS];
}

export function buildTablePageSizeOptions(draftSizes) {
    return normalizeTablePageSizes([...TABLE_PAGE_SIZE_SUGGESTIONS, ...(Array.isArray(draftSizes) ? draftSizes : [])]);
}

export function filterTablePageSizeOptions(options, query) {
    const searchTerm = String(query || '').trim();
    if (!searchTerm) {
        return Array.isArray(options) ? options : [];
    }
    return (Array.isArray(options) ? options : []).filter((size) => String(size).includes(searchTerm));
}

export function parseIntegerInput(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function isValidFontFamilyList(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized || normalized.length > MAX_CUSTOM_FONT_FAMILY_LENGTH) {
        return false;
    }

    return normalized
        .split(',')
        .every((entry) => FONT_FAMILY_TOKEN_PATTERN.test(entry.trim()));
}

export function formatByteSize(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const amount = bytes / (1024 ** exponent);
    return `${amount.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}
