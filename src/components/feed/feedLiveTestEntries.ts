import type { FeedLiveEntryPayload } from '@/state/feedLiveTypes';

type FeedLiveEntryOf<T extends FeedLiveEntryPayload['type']> = Extract<
    FeedLiveEntryPayload,
    { type: T }
>;

export function onlineFeedEntry(
    overrides: Partial<FeedLiveEntryOf<'Online'>> = {}
): FeedLiveEntryPayload {
    return {
        type: 'Online',
        created_at: '2026-08-11T00:00:00Z',
        userId: 'usr_friend',
        displayName: 'Friend',
        location: '',
        worldName: '',
        groupName: '',
        ownerUserId: '',
        ...overrides
    };
}

export function gpsFeedEntry(
    overrides: Partial<FeedLiveEntryOf<'GPS'>> = {}
): FeedLiveEntryPayload {
    return {
        type: 'GPS',
        created_at: '2026-08-11T00:00:00Z',
        userId: 'usr_friend',
        displayName: 'Friend',
        location: '',
        worldName: '',
        previousLocation: '',
        time: 0,
        groupName: '',
        ownerUserId: '',
        ...overrides
    };
}

export function statusFeedEntry(
    overrides: Partial<FeedLiveEntryOf<'Status'>> = {}
): FeedLiveEntryPayload {
    return {
        type: 'Status',
        created_at: '2026-08-11T00:00:00Z',
        userId: 'usr_friend',
        displayName: 'Friend',
        status: '',
        statusDescription: '',
        previousStatus: '',
        previousStatusDescription: '',
        ownerUserId: '',
        ...overrides
    };
}

export function avatarFeedEntry(
    overrides: Partial<FeedLiveEntryOf<'Avatar'>> = {}
): FeedLiveEntryPayload {
    return {
        type: 'Avatar',
        created_at: '2026-08-11T00:00:00Z',
        userId: 'usr_friend',
        displayName: 'Friend',
        ownerId: '',
        previousOwnerId: '',
        avatarName: '',
        previousAvatarName: '',
        currentAvatarImageUrl: '',
        currentAvatarThumbnailImageUrl: '',
        previousCurrentAvatarImageUrl: '',
        previousCurrentAvatarThumbnailImageUrl: '',
        ownerUserId: '',
        ...overrides
    };
}

export function instanceClosedFeedEntry(
    overrides: Partial<FeedLiveEntryOf<'instance.closed'>> = {}
): FeedLiveEntryPayload {
    return {
        type: 'instance.closed',
        created_at: '2026-08-11T00:00:00Z',
        id: 'instance.closed:wrld_world:123:2026-08-11T00:00:00Z',
        location: 'wrld_world:123',
        message: 'Instance Closed',
        ownerUserId: '',
        ...overrides
    };
}
