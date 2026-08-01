import {
    entityQueryPolicies,
    fetchCachedData,
    invalidateEntityQueries,
    queryKeys
} from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import { type QueryParams, unwrapVrchatResponse } from './vrchatRequest';

type PageResponse<TRow = unknown> = {
    results?: TRow[];
    json?: TRow[];
    hasNext?: boolean;
    nextCursor?: string;
    totalCount?: number;
};
type CalendarListParams = QueryParams & {
    n?: number;
};
type RepositoryOptions = {
    force?: boolean;
};
type GroupCalendarIdentity = {
    groupId: string;
};
type GroupCalendarEventIdentity = GroupCalendarIdentity & {
    eventId: string;
};
export type GroupCalendarGroupRecord = Record<string, unknown> & {
    id?: string;
    name?: string;
};
export type GroupCalendarEventRecord = Record<string, unknown> & {
    accessType?: string;
    category?: string;
    closeAfterEndMinutes?: number;
    closeInstanceAfterEndMinutes?: number;
    createdAt?: string;
    deletedAt?: string | null;
    description?: string;
    durationInMs?: number;
    endsAt?: string;
    eventId?: string;
    featured?: boolean;
    group?: GroupCalendarGroupRecord;
    groupId?: string;
    guestEarlyJoinMinutes?: number;
    hostEarlyJoinMinutes?: number;
    id?: string;
    imageId?: string;
    imageUrl?: string;
    interestedUserCount?: number;
    isDraft?: boolean;
    languages?: string[];
    occurrenceKind?: string;
    ownerId?: string;
    platforms?: string[];
    startsAt?: string;
    thumbnailImageUrl?: string;
    title?: string;
    userInterest?: Record<string, unknown>;
};
type GroupCalendarListResponse = PageResponse<GroupCalendarEventRecord>;
export type InviteMessageRecord = Record<string, unknown> & {
    canBeUpdated?: boolean;
    id?: string;
    message?: string;
    messageType?: string;
    remainingCooldownMinutes?: number;
    slot?: number;
    updatedAt?: string;
};
type InviteMessagesRecord = InviteMessageRecord[];
type VrchatApiResult = {
    status: number;
    data: unknown;
};

function unwrapVrchatToolsResponse<TJson = Record<string, unknown>>(
    response: VrchatApiResult,
    path: string,
    responseType: 'json' | 'text' = 'json'
) {
    return unwrapVrchatResponse<TJson>(response, path, {
        fallbackMessage: 'VRChat tool request failed',
        responseType
    });
}

async function getGroupCalendar(
    { groupId }: GroupCalendarIdentity,
    { force = false }: RepositoryOptions = {}
) {
    return fetchCachedData({
        queryKey: queryKeys.groupCalendarList(
            'group',
            { groupId },
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.groupCollection,
        force,
        queryFn: async () => {
            const response = await commands.appVrchatToolsGroupCalendarGet({
                groupId
            });
            return unwrapVrchatToolsResponse<GroupCalendarListResponse>(
                response,
                `calendar/${encodeURIComponent(groupId)}`
            ).json;
        }
    });
}

async function getFollowingGroupCalendars(
    params: CalendarListParams = {},
    { force = false }: RepositoryOptions = {}
) {
    return fetchCachedData({
        queryKey: queryKeys.groupCalendarList(
            'following',
            params,
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.groupCollection,
        force,
        queryFn: async () => {
            const response = await commands.appVrchatToolsFollowingCalendarsGet(
                {
                    params
                }
            );
            return unwrapVrchatToolsResponse<GroupCalendarListResponse>(
                response,
                'calendar/following'
            ).json;
        }
    });
}

async function followGroupEvent({
    groupId,
    eventId,
    isFollowing
}: GroupCalendarEventIdentity & { isFollowing: boolean }) {
    const response = await commands.appVrchatToolsGroupEventFollow({
        groupId,
        eventId,
        isFollowing: Boolean(isFollowing)
    });
    invalidateEntityQueries(['calendar']);
    return unwrapVrchatToolsResponse<GroupCalendarEventRecord>(
        response,
        `calendar/${encodeURIComponent(groupId)}/${encodeURIComponent(eventId)}/follow`
    ).json;
}

async function getGroupCalendarIcs(
    { groupId, eventId }: GroupCalendarEventIdentity,
    { force = false }: RepositoryOptions = {}
) {
    return fetchCachedData({
        queryKey: queryKeys.groupCalendarEvent(
            { groupId, eventId },
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.groupCalendarEvent,
        force,
        queryFn: async () => {
            const response = await commands.appVrchatToolsGroupCalendarIcsGet({
                groupId,
                eventId
            });
            return unwrapVrchatToolsResponse<string>(
                response,
                `calendar/${encodeURIComponent(groupId)}/${encodeURIComponent(eventId)}.ics`,
                'text'
            ).json;
        }
    });
}

async function saveUserNote({
    targetUserId,
    note
}: {
    targetUserId: string;
    note: string;
}) {
    const response = await commands.appVrchatToolsUserNoteSave({
        targetUserId,
        note
    });
    void invalidateEntityQueries(['quickSearch']);
    return unwrapVrchatToolsResponse(response, 'userNotes').json;
}

async function reportUser({
    userId,
    contentType = 'user',
    reason,
    type = 'report'
}: {
    userId: string;
    contentType?: string;
    reason: string;
    type?: string;
}) {
    const response = await commands.appVrchatToolsUserReport({
        userId,
        contentType,
        reason,
        type
    });
    return unwrapVrchatToolsResponse(
        response,
        `feedback/${encodeURIComponent(userId)}/user`
    ).json;
}

async function getInviteMessages({
    currentUserId,
    messageType
}: {
    currentUserId: string;
    messageType: string;
}) {
    const response = await commands.appVrchatToolsInviteMessagesGet({
        currentUserId,
        messageType
    });
    return unwrapVrchatToolsResponse<InviteMessagesRecord>(
        response,
        `message/${encodeURIComponent(currentUserId)}/${encodeURIComponent(messageType)}`
    ).json;
}

async function editInviteMessage({
    currentUserId,
    messageType,
    slot,
    message
}: {
    currentUserId: string;
    messageType: string;
    slot: number | string;
    message: string;
}) {
    const response = await commands.appVrchatToolsInviteMessageEdit({
        currentUserId,
        messageType,
        slot: String(slot),
        message
    });
    return unwrapVrchatToolsResponse<InviteMessagesRecord>(
        response,
        `message/${encodeURIComponent(currentUserId)}/${encodeURIComponent(messageType)}/${encodeURIComponent(slot)}`
    ).json;
}

const vrchatToolsRepository = Object.freeze({
    getGroupCalendar,
    getFollowingGroupCalendars,
    followGroupEvent,
    getGroupCalendarIcs,
    saveUserNote,
    reportUser,
    getInviteMessages,
    editInviteMessage
});

export {
    getGroupCalendar,
    getFollowingGroupCalendars,
    followGroupEvent,
    getGroupCalendarIcs,
    saveUserNote,
    reportUser,
    getInviteMessages,
    editInviteMessage
};
export default vrchatToolsRepository;
