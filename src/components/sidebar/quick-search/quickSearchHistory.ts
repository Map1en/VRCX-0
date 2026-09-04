import {
    BaseDirectory,
    mkdir,
    readTextFile,
    writeTextFile
} from '@tauri-apps/plugin-fs';

import { isRecord } from '@/shared/utils/record';

import type { QuickSearchEntityType, QuickSearchResult } from '../quickSearch';

const HISTORY_FILE_NAME = 'quick-search-history.json';
const HISTORY_LIMIT = 5;
const HISTORY_VERSION = 1;
let recordQueue = Promise.resolve();

export type QuickSearchHistoryScope = {
    endpoint: string;
    userId: string;
};

export type QuickSearchHistoryEntry = Pick<
    QuickSearchResult,
    'id' | 'type' | 'name' | 'imageUrl'
>;

type QuickSearchHistoryFile = {
    version: typeof HISTORY_VERSION;
    accounts: Record<string, QuickSearchHistoryEntry[]>;
};

function emptyHistoryFile(): QuickSearchHistoryFile {
    return {
        version: HISTORY_VERSION,
        accounts: {}
    };
}

function isEntityType(value: unknown): value is QuickSearchEntityType {
    return (
        value === 'friend' ||
        value === 'avatar' ||
        value === 'world' ||
        value === 'group'
    );
}

function parseEntry(value: unknown): QuickSearchHistoryEntry | null {
    if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        !value.id.trim() ||
        !isEntityType(value.type) ||
        value.id.trim().startsWith('fvrt_') ||
        typeof value.name !== 'string'
    ) {
        return null;
    }
    if (value.imageUrl !== undefined && typeof value.imageUrl !== 'string') {
        return null;
    }
    return {
        id: value.id,
        type: value.type,
        name: value.name,
        imageUrl: value.imageUrl
    };
}

function parseHistoryFile(value: unknown): QuickSearchHistoryFile {
    if (
        !isRecord(value) ||
        value.version !== HISTORY_VERSION ||
        !isRecord(value.accounts)
    ) {
        return emptyHistoryFile();
    }
    const accounts: Record<string, QuickSearchHistoryEntry[]> = {};
    for (const [account, entries] of Object.entries(value.accounts)) {
        if (!Array.isArray(entries)) {
            continue;
        }
        accounts[account] = entries
            .map(parseEntry)
            .filter((entry) => entry !== null)
            .slice(0, HISTORY_LIMIT);
    }
    return {
        version: HISTORY_VERSION,
        accounts
    };
}

function accountKey(scope: QuickSearchHistoryScope) {
    return JSON.stringify([scope.endpoint.trim(), scope.userId.trim()]);
}

async function readHistoryFile(): Promise<QuickSearchHistoryFile> {
    try {
        const contents = await readTextFile(HISTORY_FILE_NAME, {
            baseDir: BaseDirectory.AppCache
        });
        return parseHistoryFile(JSON.parse(contents));
    } catch {
        return emptyHistoryFile();
    }
}

export function promoteQuickSearchHistoryEntry(
    entries: readonly QuickSearchHistoryEntry[],
    entry: QuickSearchHistoryEntry
) {
    return [
        entry,
        ...entries.filter(
            (candidate) =>
                candidate.type !== entry.type || candidate.id !== entry.id
        )
    ].slice(0, HISTORY_LIMIT);
}

export async function loadQuickSearchHistory(
    scope: QuickSearchHistoryScope
): Promise<QuickSearchResult[]> {
    const file = await readHistoryFile();
    return (file.accounts[accountKey(scope)] ?? []).map((entry) => ({
        ...entry,
        source: 'history'
    }));
}

export function recordQuickSearchHistory(
    scope: QuickSearchHistoryScope,
    result: QuickSearchResult
): Promise<void> {
    recordQueue = recordQueue
        .catch(() => undefined)
        .then(async () => {
            const file = await readHistoryFile();
            const key = accountKey(scope);
            file.accounts[key] = promoteQuickSearchHistoryEntry(
                file.accounts[key] ?? [],
                {
                    id: result.id,
                    type: result.type,
                    name: result.name,
                    imageUrl: result.imageUrl
                }
            );
            await mkdir('', {
                baseDir: BaseDirectory.AppCache,
                recursive: true
            });
            await writeTextFile(HISTORY_FILE_NAME, JSON.stringify(file), {
                baseDir: BaseDirectory.AppCache
            });
        });
    return recordQueue;
}
