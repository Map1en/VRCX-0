import type {
    ColumnDef,
    PaginationState,
    Table as ReactTable,
    RowData
} from '@tanstack/react-table';
import type { Dispatch, SetStateAction } from 'react';

import type { UserFact } from '@/domain/users/userFacts';
import type { FeedRowOutput } from '@/platform/tauri/bindings';
import type { FeedFilterType } from '@/repositories/feedRepository';

export type FeedRow = FeedRowOutput;

export type FeedLoadStatus = 'idle' | 'running' | 'ready' | 'error';

export type FeedDateRange = {
    from: Date | undefined;
    to?: Date;
};

export type FeedFriendActionTarget = Record<string, unknown> | null;

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

export type FeedTableMeta = {
    actions: FeedFriendActions;
    friendLogNamesById: Record<string, string>;
    knownUsersById: Record<string, UserFact>;
    loadingPreviousInstancesKey: string;
    onOpenPreviousInstances(payload?: FeedLocationActionPayload): void;
};

declare module '@tanstack/react-table' {
    interface TableMeta<TData extends RowData> {
        feed?: FeedTableMeta;
    }
}

export type FeedColumns = ColumnDef<FeedRow>[];

export type FeedTableInstance = ReactTable<FeedRow>;

export type FeedPaginationSetter = Dispatch<SetStateAction<PaginationState>>;

export type { FeedFilterType, PaginationState };
