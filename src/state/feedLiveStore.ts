import { create } from 'zustand';

import type {
    FeedEntryPatch,
    FeedEntryPatchInput,
    FeedLiveEntry,
    FeedLiveEntryPayload
} from '@/domain/feed/feedLiveTypes';
import { normalizeString } from '@/shared/utils/string';

type FeedLivePushOptions = {
    ownerUserId?: string;
};

interface FeedLiveStoreState {
    version: number;
    entries: FeedLiveEntry[];
    pushEntry: (
        entry: FeedLiveEntryPayload | null | undefined,
        options?: FeedLivePushOptions
    ) => void;
    pushEntries: (
        entries:
            | readonly (FeedLiveEntryPayload | null | undefined)[]
            | null
            | undefined,
        options?: FeedLivePushOptions
    ) => void;
    patchEntry: (
        id: unknown,
        fields: FeedEntryPatchInput | null | undefined
    ) => void;
    resetFeedLive: () => void;
}

const initialState: Pick<FeedLiveStoreState, 'version' | 'entries'> = {
    version: 0,
    entries: []
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function feedEntryCorrectionId(row: FeedLiveEntryPayload): string {
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
    const details = isRecord(row?.details) ? row.details : {};
    const location = row?.location ?? details.location ?? '';
    const message = row?.message ?? '';
    return `${type}:${createdAt}:${userId}:${location}:${message}`;
}

function nonEmptyFeedPatch(fields: FeedEntryPatchInput): FeedEntryPatch {
    const patch: FeedEntryPatch = {};
    const displayName = normalizeString(fields.displayName);
    if (displayName) {
        patch.displayName = displayName;
    }
    const worldName = normalizeString(fields.worldName);
    if (worldName) {
        patch.worldName = worldName;
    }
    const displayLocation = normalizeString(fields.displayLocation);
    if (displayLocation) {
        patch.displayLocation = displayLocation;
    }
    return patch;
}

export const useFeedLiveStore = create<FeedLiveStoreState>((set, get) => ({
    ...initialState,
    pushEntry(entry, options) {
        get().pushEntries([entry], options);
    },
    pushEntries(entries, { ownerUserId = '' }: FeedLivePushOptions = {}) {
        const validEntries = (Array.isArray(entries) ? entries : []).filter(
            (entry): entry is FeedLiveEntryPayload => isRecord(entry)
        );
        if (!validEntries.length) {
            return;
        }
        set((state) => {
            const appended = validEntries.map((entry, index) => ({
                sequence: state.version + index + 1,
                ownerUserId,
                entry: { ...entry, ownerUserId }
            }));
            return {
                version: state.version + validEntries.length,
                entries: [...state.entries, ...appended].slice(-100)
            };
        });
    },
    patchEntry(id, fields) {
        const normalizedId = normalizeString(id);
        if (!normalizedId || !isRecord(fields)) {
            return;
        }
        set((state) => {
            let changed = false;
            const entries = state.entries.map((entry) => {
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
            const nextState = {
                version: state.version + 1,
                entries
            };
            return nextState;
        });
    },
    resetFeedLive() {
        set(initialState);
    }
}));
export type { FeedLiveEntry, FeedLiveStoreState };
