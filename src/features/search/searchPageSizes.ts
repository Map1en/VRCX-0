import { isRecord } from '@/shared/utils/record';

import type { SearchActiveTab } from './searchTypes';

export const SEARCH_PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];
export const DEFAULT_SEARCH_PAGE_SIZE = 10;

export type SearchPageSizes = Record<SearchActiveTab, number>;

const STORAGE_KEY = 'VRCX_0_SearchPageSizes';
const SEARCH_TABS: SearchActiveTab[] = ['user', 'world', 'avatar', 'group'];

function sanitizePageSize(value: unknown) {
    return typeof value === 'number' && SEARCH_PAGE_SIZE_OPTIONS.includes(value)
        ? value
        : DEFAULT_SEARCH_PAGE_SIZE;
}

export function readSearchPageSizes(): SearchPageSizes {
    let stored: unknown = null;
    try {
        stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    } catch {
        stored = null;
    }
    const source = isRecord(stored) ? stored : {};
    return Object.fromEntries(
        SEARCH_TABS.map((tab) => [tab, sanitizePageSize(source[tab])])
    ) as SearchPageSizes;
}

export function writeSearchPageSizes(sizes: SearchPageSizes) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
    } catch {
        return;
    }
}
