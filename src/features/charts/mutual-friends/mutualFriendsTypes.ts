import type { FriendRecord } from '@/domain/friends/types';

export interface MutualFriendNode {
    id: string;
    label: string;
    lastFetchedAt: string | null;
    optedOut: boolean;
    degree: number;
    mutualCount: number;
}

export interface MutualFriendLink {
    source: string;
    target: string;
}

export interface MutualFriendGraph {
    nodes: MutualFriendNode[];
    links: MutualFriendLink[];
}

export interface MutualFriendNodeMeta {
    lastFetchedAt: string | null;
    optedOut: boolean;
    totalCount: number | null;
}

export type MutualFriendSnapshot = Map<string, string[]>;
export type MutualFriendMeta = Map<string, MutualFriendNodeMeta>;

export interface MutualFriendsLayoutSettings {
    layoutIterations: number;
    layoutSpacing: number;
    edgeCurvature: number;
    communitySeparation: number;
}

export type MutualFriendsLayoutSettingKey = keyof MutualFriendsLayoutSettings;

export interface MutualFriendsViewFilters {
    searchQuery: string;
    minDegree: number;
    focusedCommunity: number | null;
}

export interface MutualFriendCommunity {
    index: number;
    size: number;
    color: string;
    label: string;
    isNamed: boolean;
}

export interface MutualFriendCommunityAssignment {
    communityIndexById: Map<string, number>;
    communities: MutualFriendCommunity[];
}

export interface MutualFriendsIsolatedCounts {
    noConnections: number;
    unavailable: number;
}

export interface MutualFriendsCoverage {
    friendCount: number;
    fetchedCount: number;
    unavailableCount: number;
    lastFetchedAt: string | null;
}

export interface MutualFriendPickerOption {
    value: string;
    label: string;
    displayLabel: string;
    search: string;
    user: FriendRecord | null;
    degree?: number;
}

export interface MutualFriendsFetchProgress {
    isFetching: boolean;
    processedFriends: number;
    totalFriends: number;
    cancelRequested: boolean;
}

export type MutualFriendsSnapshotStatus =
    | 'idle'
    | 'running'
    | 'ready'
    | 'error';
