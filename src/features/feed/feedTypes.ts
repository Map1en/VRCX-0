import type {
    ColumnDef,
    PaginationState,
    Table as ReactTable
} from '@tanstack/react-table';
import type { Dispatch, SetStateAction } from 'react';

import type { FeedEntry, FeedFilterType } from '@/repositories/feedRepository';

export type FeedRow = FeedEntry & {
    id?: unknown;
    rowId?: unknown;
    row_id?: unknown;
    sourceRank?: unknown;
    source_rank?: unknown;
    type?: unknown;
    created_at?: unknown;
    createdAt?: unknown;
    userId?: unknown;
    senderUserId?: unknown;
    location?: unknown;
    worldId?: unknown;
    worldName?: unknown;
    groupName?: unknown;
    message?: unknown;
    [key: string]: unknown;
};

export type FeedLoadStatus = 'idle' | 'running' | 'ready' | 'error';

export type FeedDateRange = {
    from: Date | undefined;
    to?: Date;
};

export type FeedFriendActionTarget = FeedRow | Record<string, unknown> | null;

export type FeedLocationActionPayload = {
    location?: unknown;
    worldId?: unknown;
    worldName?: unknown;
    groupName?: unknown;
    selfInvite?: boolean;
    [key: string]: unknown;
};

export type FeedPreviousInstanceRow = Record<string, unknown>;

export type FeedFriendActions = {
    canSendInviteFromFeed: boolean;
    canBoopFromFeed: boolean;
    isFeedUserHidden(userId: unknown): boolean;
    addFeedHiddenUser(userId: unknown): Promise<void>;
    removeFeedHiddenUser(userId: unknown): Promise<void>;
    canUseFeedFriendLocation(location: unknown): boolean;
    launchFeedFriendLocation(location: unknown): Promise<void>;
    selfInviteFeedFriendLocation(location: unknown): Promise<void>;
    sendFeedFriendInvite(friend: FeedFriendActionTarget): Promise<void>;
    requestFeedFriendInvite(friend: FeedFriendActionTarget): Promise<void>;
    sendFeedFriendBoop(friend: FeedFriendActionTarget): Promise<void>;
    openFeedNewInstance(payload?: FeedLocationActionPayload): void;
};

export type FeedColumns = ColumnDef<FeedRow>[];

export type FeedTableInstance = ReactTable<FeedRow>;

export type FeedPaginationSetter = Dispatch<SetStateAction<PaginationState>>;

export type { FeedFilterType, PaginationState };
