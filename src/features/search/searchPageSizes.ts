import {
    STORAGE_KEYS,
    readStoredJson,
    writeStoredText
} from '@/lib/browserStorage';
import { isRecord } from '@/shared/utils/record';

import type { SearchActiveTab } from './searchTypes';

export const SEARCH_PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];
export const DEFAULT_SEARCH_PAGE_SIZE = 10;

export type SearchPageSizes = Record<SearchActiveTab, number>;

const STORAGE_KEY = STORAGE_KEYS.searchPageSizes;
const SEARCH_TABS: SearchActiveTab[] = ['user', 'world', 'avatar', 'group'];

function sanitizePageSize(value: unknown) {
    return typeof value === 'number' && SEARCH_PAGE_SIZE_OPTIONS.includes(value)
        ? value
        : DEFAULT_SEARCH_PAGE_SIZE;
}

export function readSearchPageSizes(): SearchPageSizes {
    const stored = readStoredJson(STORAGE_KEY);
    const source = isRecord(stored) ? stored : {};
    return Object.fromEntries(
        SEARCH_TABS.map((tab) => [tab, sanitizePageSize(source[tab])])
    ) as SearchPageSizes;
}

export function writeSearchPageSizes(sizes: SearchPageSizes) {
    writeStoredText(STORAGE_KEY, JSON.stringify(sizes));
}
