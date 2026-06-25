import { create } from 'zustand';

import { normalizeString } from '@/shared/utils/string';

interface FeedLiveEntry {
    sequence: number;
    ownerUserId: string;
    entry: Record<string, unknown>;
}

type FeedEntryPatch = Partial<{
    displayName: string;
    worldName: string;
    displayLocation: string;
}>;

interface FeedLiveStoreState {
    version: number;
    entries: FeedLiveEntry[];
    pushEntry: (
        entry: Record<string, unknown> | null | undefined,
        options?: { ownerUserId?: string }
    ) => void;
    patchEntry: (id: unknown, fields: FeedEntryPatch) => void;
    resetFeedLive: () => void;
}

const initialState: Pick<FeedLiveStoreState, 'version' | 'entries'> = {
    version: 0,
    entries: []
};

export function feedEntryCorrectionId(row: Record<string, unknown>): string {
    if (row?.id != null) {
        return `id:${row.id}`;
    }
    const rowId = row?.rowId ?? row?.row_id;
    if (rowId != null) {
        const sourceRank = row?.sourceRank ?? row?.source_rank;
        if (sourceRank != null) {
            return `row:${row?.type ?? ''}:${sourceRank}:${rowId}`;
        }
        return `row:${row?.type ?? ''}:${rowId}`;
    }
    const type = row?.type ?? '';
    const createdAt = row?.created_at ?? row?.createdAt ?? '';
    const userId = row?.userId ?? row?.senderUserId ?? '';
    const details =
        row?.details && typeof row.details === 'object'
            ? (row.details as Record<string, unknown>)
            : {};
    const location = row?.location ?? details.location ?? '';
    const message = row?.message ?? '';
    return `${type}:${createdAt}:${userId}:${location}:${message}`;
}

function nonEmptyFeedPatch(fields: FeedEntryPatch): FeedEntryPatch {
    return Object.fromEntries(
        Object.entries(fields).filter(
            ([, value]) => normalizeString(value) !== ''
        )
    ) as FeedEntryPatch;
}

export const useFeedLiveStore = create<FeedLiveStoreState>((set: any) => ({
    ...initialState,
    pushEntry(entry: any, { ownerUserId = '' }: any = {}) {
        if (!entry || typeof entry !== 'object') {
            return;
        }
        set((state: any) => ({
            version: state.version + 1,
            entries: [
                ...state.entries,
                {
                    sequence: state.version + 1,
                    ownerUserId,
                    entry: { ...entry, ownerUserId }
                }
            ].slice(-100)
        }));
    },
    patchEntry(id: any, fields: any) {
        const normalizedId = normalizeString(id);
        if (!normalizedId || !fields || typeof fields !== 'object') {
            return;
        }
        set((state: any) => {
            let changed = false;
            const entries = state.entries.map((entry: FeedLiveEntry) => {
                if (feedEntryCorrectionId(entry.entry) !== normalizedId) {
                    return entry;
                }
                const patch = nonEmptyFeedPatch(fields);
                const nextEntry = {
                    ...entry.entry,
                    ...patch
                };
                changed = true;
                return {
                    ...entry,
                    entry: nextEntry
                };
            });
            if (!changed) {
                return state;
            }
            return {
                version: state.version + 1,
                entries
            };
        });
    },
    resetFeedLive() {
        set(initialState);
    }
}));
export type { FeedLiveEntry, FeedLiveStoreState };
