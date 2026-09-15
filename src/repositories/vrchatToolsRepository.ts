import {
    entityQueryPolicies,
    fetchCachedData,
    invalidateEntityQueries,
    queryKeys
} from '@/lib/entityQueryCache';
import {
    commands,
    type CalendarListParams,
    type HttpApiExecuteResponse,
    type InviteMessageType
} from '@/platform/tauri/bindings';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import { unwrapVrchatResponse } from './vrchatRequest';

type PageResponse<TRow = unknown> = {
    results?: TRow[];
    json?: TRow[];
    hasNext?: boolean;
    nextCursor?: string;
    totalCount?: number;
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
    displayName?: string;
    bannerUrl?: string;
    iconUrl?: string;
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
type VrchatApiResult = HttpApiExecuteResponse;

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
        isFollowing
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
    return unwrapVrchatToolsResponse(response, 'userNotes').json;
}

async function reportUser({
    userId,
    reason
}: {
    userId: string;
    reason: string;
}) {
    const response = await commands.appVrchatToolsUserReport({
        userId,
        reason
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
    messageType: InviteMessageType;
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
    messageType: InviteMessageType;
    slot: number;
    message: string;
}) {
    const response = await commands.appVrchatToolsInviteMessageEdit({
        currentUserId,
        messageType,
        slot,
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

export { saveUserNote };
export default vrchatToolsRepository;
