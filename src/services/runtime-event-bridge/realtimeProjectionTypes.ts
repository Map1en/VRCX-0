import type { UserProfileEntity } from '@/domain/entities/user';
import type {
    FriendProjection,
    FriendProjectionPatch,
    RealtimeCurrentUserProjection,
    RealtimeEntryCorrection,
    RealtimeFeedProjection,
    RealtimeFeedUpsert,
    RealtimeInstanceClosedProjection,
    RealtimeNotificationProjection,
    RealtimeNotificationUpsert,
    RealtimeUserProjection
} from '@/platform/tauri/bindings';
import type { NotificationRow } from '@/repositories/notificationPersistenceRepository';
import type {
    FeedLiveEntryPayload,
    FeedLivePatch
} from '@/state/feedLiveTypes';

export type RealtimeFriendProjectionPayload = Omit<
    FriendProjection,
    'feedEntries' | 'patches' | 'removals'
> & {
    feedEntries: FeedLiveEntryPayload[];
    patches: FriendProjectionPatch[];
    removals: string[];
};

export type RealtimeEntryCorrectionPayload = Omit<
    RealtimeEntryCorrection,
    'fields'
> & {
    fields: {
        displayName?: string;
        worldName?: string;
        displayLocation?: string;
    };
};

export type RealtimeFeedProjectionPayload = Omit<
    RealtimeFeedProjection,
    'upserts' | 'patches'
> & {
    upserts: RealtimeFeedUpsert[];
    patches: FeedLivePatch[];
};

export type RealtimeUserRecord = UserProfileEntity & {
    endpoint?: string;
    updatedAt?: string;
    userId?: string;
};

export type RealtimeUserProjectionPayload = Omit<
    RealtimeUserProjection,
    'users'
> & {
    users: RealtimeUserRecord[];
};

type RealtimeGameStatePatch = Partial<{
    currentLocation: string;
    currentWorldId: string;
    currentWorldName: string;
    currentDestination: string;
    currentLocationStartedAt: string | null;
    currentLocationPlayerIds: [];
    currentLocationPlayers: [];
    lastGameLogAt: string;
    lastGameLogType: 'location';
}>;

export type RealtimeCurrentUserProjectionPayload = Omit<
    RealtimeCurrentUserProjection,
    'patch' | 'snapshot' | 'gameStatePatch'
> & {
    patch: UserProfileEntity;
    snapshot: UserProfileEntity;
    gameStatePatch?: RealtimeGameStatePatch | null;
};

type RealtimeNotificationUpsertPayload = Omit<
    RealtimeNotificationUpsert,
    'notification' | 'insertDefaults'
> & {
    notification: NotificationRow;
    insertDefaults?: NotificationRow | null;
};

export type RealtimeNotificationProjectionPayload = Omit<
    RealtimeNotificationProjection,
    'upserts' | 'expiredIds' | 'seenIds'
> & {
    upserts: RealtimeNotificationUpsertPayload[];
    expiredIds: string[];
    seenIds: string[];
};

export type RealtimeInstanceClosedProjectionPayload = Omit<
    RealtimeInstanceClosedProjection,
    'notification'
> & {
    notification: NotificationRow;
};
