import { create } from 'zustand';

import { isRecord } from '@/shared/utils/record';
import { normalizeString } from '@/shared/utils/string';
import type {
    FeedEntryPatch,
    FeedEntryPatchInput,
    FeedLiveEntry,
    FeedLivePatch,
    FeedLiveEntryPayload
} from '@/state/feedLiveTypes';
import { usePreferencesStore } from '@/state/preferencesStore';

type FeedLivePushOptions = {
    ownerUserId?: string;
};

interface FeedLiveStoreState {
    version: number;
    entries: FeedLiveEntry[];
    patches: FeedLivePatch[];
    pushEntries: (
        entries:
            | readonly (FeedLiveEntry | null | undefined)[]
            | null
            | undefined,
        options?: FeedLivePushOptions
    ) => void;
    pushPatches: (
        patches:
            | readonly (FeedLivePatch | null | undefined)[]
            | null
            | undefined
    ) => void;
    resetFeedLive: () => void;
    trimEntries: () => void;
}

const initialState: Pick<
    FeedLiveStoreState,
    'version' | 'entries' | 'patches'
> = {
    version: 0,
    entries: [],
    patches: []
};

const PERSISTED_FEED_LIVE_MAX_ENTRIES = 100;

function feedLiveMaxEntries() {
    const preferences = usePreferencesStore.getState();
    return preferences.feedPersistenceDisabled
        ? preferences.tableLimits.maxTableSize
        : PERSISTED_FEED_LIVE_MAX_ENTRIES;
}

export function feedEntryCorrectionId(entry: FeedLiveEntryPayload): string {
    if (entry.type === 'instance.closed') {
        return `id:${entry.id}`;
    }
    const location = feedEntryLocation(entry);
    return `${entry.type}:${entry.created_at}:${entry.userId}:${location}:`;
}

function feedEntryLocation(entry: FeedLiveEntryPayload): string {
    switch (entry.type) {
        case 'Online':
        case 'Offline':
        case 'GPS':
        case 'OnPlayerJoining':
        case 'instance.closed':
            return entry.location;
        default:
            return '';
    }
}

function applyFeedEntryPatch(
    entry: FeedLiveEntryPayload,
    patch: FeedEntryPatch
): FeedLiveEntryPayload {
    let next = entry;
    if (patch.displayName !== undefined && next.type !== 'instance.closed') {
        next = { ...next, displayName: patch.displayName };
    }
    if (patch.worldName !== undefined) {
        switch (next.type) {
            case 'Online':
            case 'Offline':
            case 'GPS':
            case 'OnPlayerJoining':
            case 'instance.closed':
                next = { ...next, worldName: patch.worldName };
                break;
            default:
                break;
        }
    }
    if (patch.displayLocation !== undefined) {
        switch (next.type) {
            case 'Online':
            case 'Offline':
            case 'GPS':
            case 'OnPlayerJoining':
            case 'instance.closed':
                next = { ...next, displayLocation: patch.displayLocation };
                break;
            default:
                break;
        }
    }
    return next;
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

export const useFeedLiveStore = create<FeedLiveStoreState>((set) => ({
    ...initialState,
    pushEntries(entries, { ownerUserId = '' }: FeedLivePushOptions = {}) {
        const validEntries = (Array.isArray(entries) ? entries : []).filter(
            (entry): entry is FeedLiveEntry =>
                isRecord(entry) &&
                typeof entry.sequence === 'number' &&
                Number.isFinite(entry.sequence) &&
                entry.sequence > 0 &&
                isRecord(entry.entry)
        );
        if (!validEntries.length) {
            return;
        }
        const maxEntries = feedLiveMaxEntries();
        set((state) => {
            const appended = validEntries
                .filter((entry) => entry.sequence > state.version)
                .map((entry) => ({
                    sequence: entry.sequence,
                    ownerUserId,
                    entry: entry.entry
                }));
            if (!appended.length) {
                return state;
            }
            return {
                version: Math.max(
                    state.version,
                    ...appended.map((entry) => entry.sequence)
                ),
                entries: [...state.entries, ...appended].slice(-maxEntries)
            };
        });
    },
    pushPatches(patches) {
        const validPatches = (Array.isArray(patches) ? patches : []).filter(
            (patch): patch is FeedLivePatch =>
                isRecord(patch) &&
                typeof patch.sequence === 'number' &&
                Number.isFinite(patch.sequence) &&
                patch.sequence > 0 &&
                Boolean(normalizeString(patch.id)) &&
                isRecord(patch.fields)
        );
        if (!validPatches.length) {
            return;
        }
        set((state) => {
            const nextPatches = validPatches.filter(
                (patch) => patch.sequence > state.version
            );
            if (!nextPatches.length) {
                return state;
            }
            let entries = state.entries;
            for (const patchEntry of nextPatches) {
                const normalizedId = normalizeString(patchEntry.id);
                const patch = nonEmptyFeedPatch(patchEntry.fields);
                entries = entries.map((entry) => {
                    if (feedEntryCorrectionId(entry.entry) !== normalizedId) {
                        return entry;
                    }
                    return {
                        ...entry,
                        entry: applyFeedEntryPatch(entry.entry, patch)
                    };
                });
            }
            const maxEntries = feedLiveMaxEntries();
            return {
                version: Math.max(
                    state.version,
                    ...nextPatches.map((patch) => patch.sequence)
                ),
                entries,
                patches: [...state.patches, ...nextPatches].slice(-maxEntries)
            };
        });
    },
    resetFeedLive() {
        set(initialState);
    },
    trimEntries() {
        const maxEntries = feedLiveMaxEntries();
        set((state) => {
            const entries = state.entries.slice(-maxEntries);
            const patches = state.patches.slice(-maxEntries);
            if (
                entries.length === state.entries.length &&
                patches.length === state.patches.length
            ) {
                return state;
            }
            return {
                entries,
                patches
            };
        });
    }
}));
export type { FeedLiveEntry, FeedLivePatch, FeedLiveStoreState };
