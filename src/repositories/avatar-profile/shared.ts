import type {
    HttpApiExecuteResponse,
    VrchatAvatarIdInput as IpcVrchatAvatarIdInput
} from '@/platform/tauri/bindings';

import {
    VRCHAT_API_DEFAULT_PAGE_SIZE,
    VRCHAT_PROFILE_MAX_PAGES
} from '../paginationConstants';
import { unwrapVrchatResponse } from '../vrchatRequest';
import type { CollectPagesOptions } from './types';

export function normalizeEntityId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeTimestamp(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function normalizeMemoString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function normalizeArray(values: unknown): string[] {
    if (!Array.isArray(values)) {
        return [];
    }

    return values
        .map((value) =>
            typeof value === 'string'
                ? value.trim()
                : String(value ?? '').trim()
        )
        .filter(Boolean);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

export function parseInteger(value: unknown): number {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function avatarIdInput(avatarId: string): IpcVrchatAvatarIdInput {
    return { avatarId };
}

export function unwrapVrchatAvatarResponse<TJson = unknown>(
    response: HttpApiExecuteResponse,
    path: string
) {
    return unwrapVrchatResponse<TJson>(response, path, {
        fallbackMessage: 'VRChat avatar request failed'
    });
}

export async function collectPages<T>(
    fetchPage: (page: { n: number; offset: number }) => Promise<T[]>,
    {
        pageSize = VRCHAT_API_DEFAULT_PAGE_SIZE,
        maxPages = VRCHAT_PROFILE_MAX_PAGES
    }: CollectPagesOptions = {}
): Promise<T[]> {
    const rows: T[] = [];

    for (let page = 0; page < maxPages; page += 1) {
        const nextRows = await fetchPage({
            n: pageSize,
            offset: page * pageSize
        });
        rows.push(...nextRows);

        if (nextRows.length < pageSize) {
            break;
        }
    }

    return rows;
}
