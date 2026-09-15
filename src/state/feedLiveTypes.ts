import type {
    FeedLiveEntry as FeedLiveEntryPayload,
    RealtimeEntryCorrectionFields
} from '@/platform/tauri/bindings';

export type { FeedLiveEntryPayload };

export type FeedLiveEntry = {
    sequence: number;
    ownerUserId?: string;
    entry: FeedLiveEntryPayload;
};

export type FeedEntryPatchInput = RealtimeEntryCorrectionFields;

export type FeedLivePatch = {
    sequence: number;
    id: string;
    fields: FeedEntryPatchInput;
};

export type FeedEntryPatch = Partial<{
    displayName: string;
    worldName: string;
    displayLocation: string;
}>;
