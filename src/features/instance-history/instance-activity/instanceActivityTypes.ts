import type { parseLocation } from '@/shared/utils/location';

export type ActivityLocation = ReturnType<typeof parseLocation>;

export type WorldDetailsById = Record<
    string,
    object & {
        id?: string;
        name?: string;
    }
>;

export type PreviousInstanceRow = object & {
    id?: string | number;
    created_at?: string | number | Date;
    createdAt?: string | number | Date;
    last_ts?: string | number | Date;
    lastTs?: string | number | Date;
    time?: string | number;
    duration?: string | number;
    location?: string;
    worldId?: string;
    worldName?: string;
    groupName?: string;
    ownerDisplayName?: string;
    ownerName?: string;
    events?: unknown[];
    $location?: Record<string, unknown> & {
        tag?: string;
        worldName?: string;
        groupName?: string;
        ownerDisplayName?: string;
    };
};

export type InstanceActivityRawRow = object & {
    id?: unknown;
    user_id?: unknown;
    display_name?: unknown;
    location?: unknown;
    created_at?: unknown;
    time?: unknown;
};

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

export type InstanceActivityDetailRow = InstanceActivityRawRow & {
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
    isDetailVisible: boolean;
    isSoloInstanceVisible: boolean;
    isNoFriendInstanceVisible: boolean;
};

export type TranslateKey = (key: string) => string;
