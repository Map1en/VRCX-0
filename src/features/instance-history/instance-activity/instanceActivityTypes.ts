import type { InstanceHistoryEntryOutput } from '@/platform/tauri/bindings';
import type { InstanceActivityRow } from '@/repositories/instanceActivityRepository';
import type { parseLocation } from '@/shared/utils/location';

type ActivityLocation = ReturnType<typeof parseLocation>;

export type WorldDetailsById = Record<
    string,
    object & {
        id?: string;
        name?: string;
    }
>;

export type InstanceHistoryEntryRow = Partial<InstanceHistoryEntryOutput> & {
    id?: string | number;
    created_at?: string | number | Date;
    last_ts?: string | number | Date;
    duration?: string | number;
    location?: string;
    worldId?: string;
    worldName?: string;
    groupName?: string;
    ownerDisplayName?: string;
    ownerName?: string;
    $location?: Record<string, unknown> & {
        tag?: string;
        worldName?: string;
        groupName?: string;
        ownerDisplayName?: string;
    };
};

export type InstanceActivityRawRow = InstanceActivityRow;

export type InstanceActivityChartRow = {
    id: string;
    currentUserId: string;
    displayName: string;
    location: string;
    userId: string;
    parsedLocation: ActivityLocation;
    worldId: string;
    worldName: string;
    worldResolvedFromCache: boolean;
    joinMs: number;
    leaveMs: number;
    visibleStartMs: number;
    visibleDurationMs: number;
    activityKey: string;
};

export type InstanceActivityDetailRow = Omit<InstanceActivityRawRow, 'id'> & {
    id: string;
    displayName: string;
    userId: string;
    location: string;
    joinMs: number;
    leaveMs: number;
    durationMs: number;
    isCurrentUser: boolean;
    isFriend: boolean;
    isFavorite: boolean;
};

export type InstanceActivityDetailGroup = InstanceActivityDetailRow[];

export type InstanceActivityGroupsFilterOptions = {
    isSoloInstanceVisible: boolean;
    isNoFriendInstanceVisible: boolean;
};

export type TranslateKey = (key: string) => string;
