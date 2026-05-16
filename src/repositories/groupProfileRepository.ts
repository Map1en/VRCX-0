import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache.js';
import { backend } from '@/platform/index.js';
import { replaceBioSymbols } from '@/shared/utils/base/string.js';
import { createDefaultGroupRef } from '@/shared/utils/groupTransforms.js';

import {
    createRequestError,
    executeVrchatBackendRequest,
    notifyVrchatAuthFailure,
    parseJsonResponse,
    unwrapErrorMessage,
    type QueryParams
} from './vrchatRequest.js';

type GroupRecord = Record<string, any>;
type BackendApiResult = {
    status: number;
    data: unknown;
    raw: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function unwrapBackendGroupResponse<TJson = unknown>(
    response: BackendApiResult,
    path: string
) {
    const json = parseJsonResponse(response.data);
    if (response.status >= 400 || (isRecord(json) && 'error' in json)) {
        const requestError = createRequestError(
            unwrapErrorMessage(json, response.status, {
                fallbackMessage: 'VRChat group request failed'
            }),
            response.status,
            path,
            json
        );
        notifyVrchatAuthFailure(requestError);
        throw requestError;
    }

    return {
        json: json as TJson,
        status: response.status,
        raw: response.raw
    };
}

function normalizeEntityId(value: unknown): string {
    const normalize = (text: string) => {
        const normalized = text.trim();
        return normalized === '[object Object]' ? '' : normalized;
    };
    if (typeof value === 'string') {
        return normalize(value);
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
        return normalize(String(value));
    }
    return '';
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeText(value: unknown): string {
    if (typeof value !== 'string' || !value) {
        return '';
    }
    const rawText = value.trim();
    if (rawText === '[object Object]') {
        return '';
    }
    return replaceBioSymbols(rawText).trim();
}

function normalizeArray(values: unknown): string[] {
    if (!Array.isArray(values)) {
        return [];
    }

    return values
        .map((value) =>
            typeof value === 'string'
                ? value.trim()
                : String(value ?? '').trim()
        )
        .filter(Boolean);
}

function parseInteger(value: unknown): number {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeGroupRoles(values: unknown): GroupRecord[] {
    if (!Array.isArray(values)) {
        return [];
    }

    return values
        .filter((role) => role && typeof role === 'object')
        .map((role) => ({
            ...role,
            id: normalizeEntityId(role.id),
            name: normalizeText(role.name),
            description: normalizeText(role.description),
            permissions: normalizeArray(role.permissions)
        }));
}

function normalizeGroupProfile(group: GroupRecord | null | undefined) {
    const base = createDefaultGroupRef(group ?? {});
    const shortCode = normalizeString(base.shortCode);
    const discriminator = normalizeString(base.discriminator);
    const ownerId =
        normalizeEntityId(base.ownerId) ||
        normalizeEntityId(base.owner?.id) ||
        normalizeEntityId(base.owner?.userId) ||
        normalizeEntityId(base.owner?.user_id);
    const ownerDisplayName =
        normalizeText(base.ownerDisplayName) ||
        normalizeText(base.ownerName) ||
        normalizeText(base.owner?.displayName) ||
        normalizeText(base.owner?.username) ||
        normalizeText(base.owner?.name);
    const groupUrl =
        shortCode && discriminator
            ? `https://vrc.group/${shortCode}.${discriminator}`
            : '';

    return {
        ...base,
        id: normalizeEntityId(base.id || base.groupId),
        name: normalizeText(base.name),
        description: normalizeText(base.description),
        rules: normalizeText(base.rules),
        shortCode,
        discriminator,
        bannerUrl: normalizeString(base.bannerUrl),
        iconUrl: normalizeString(base.iconUrl),
        createdAt: base.createdAt || '',
        updatedAt: base.updatedAt || '',
        memberCount: parseInteger(base.memberCount),
        onlineMemberCount: parseInteger(base.onlineMemberCount),
        ownerId,
        ownerDisplayName,
        privacy: normalizeString(base.privacy),
        membershipStatus: normalizeString(base.membershipStatus),
        memberCountSyncedAt: base.memberCountSyncedAt || '',
        languages: normalizeArray(base.languages),
        links: normalizeArray(base.links),
        tags: normalizeArray(base.tags),
        roles: normalizeGroupRoles(base.roles),
        url: groupUrl
    };
}

function responseRows(json: any, key = '') {
    if (Array.isArray(json)) {
        return json;
    }

    if (key && Array.isArray(json?.[key])) {
        return json[key];
    }

    return [];
}

async function collectPages(
    fetchPage,
    { pageSize = 100, maxPages = Number.POSITIVE_INFINITY } = {}
) {
    const rows: any[] = [];

    for (let page = 0; page < maxPages; page += 1) {
        const nextRows = await fetchPage({
            n: pageSize,
            offset: page * pageSize
        });
        rows.push(...nextRows);

        if (nextRows.length < pageSize) {
            break;
        }
    }

    return rows;
}

function normalize(group: GroupRecord) {
    return normalizeGroupProfile(group);
}

async function executeGet(
    path: string,
    params: QueryParams = {},
    { endpoint = '' } = {}
) {
    return executeVrchatBackendRequest<any>('VrchatGroupExecute', path, {
        endpoint,
        method: 'GET',
        params,
        fallbackMessage: 'VRChat group request failed'
    });
}

async function executePost(
    path: string,
    params: QueryParams = {},
    { endpoint = '' } = {}
) {
    return executeVrchatBackendRequest<any>('VrchatGroupExecute', path, {
        endpoint,
        method: 'POST',
        body: params,
        fallbackMessage: 'VRChat group request failed'
    });
}

async function executePut(
    path: string,
    params: QueryParams = {},
    { endpoint = '' } = {}
) {
    return executeVrchatBackendRequest<any>('VrchatGroupExecute', path, {
        endpoint,
        method: 'PUT',
        body: params,
        fallbackMessage: 'VRChat group request failed'
    });
}

async function executeDelete(
    path: string,
    params: QueryParams = {},
    { endpoint = '' } = {}
) {
    return executeVrchatBackendRequest<any>('VrchatGroupExecute', path, {
        endpoint,
        method: 'DELETE',
        params,
        queryParams: params,
        jsonBody: false,
        fallbackMessage: 'VRChat group request failed'
    });
}

async function getGroupProfile({
    groupId,
    endpoint = '',
    includeRoles = true,
    force = false,
    dialog = false
}) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupProfile requires a group id.'
        );
    }

    const json = await fetchCachedData({
        queryKey: queryKeys.group(normalizedGroupId, includeRoles, endpoint),
        policy: dialog
            ? entityQueryPolicies.groupDialog
            : entityQueryPolicies.group,
        force,
        queryFn: () =>
            fetchGroupProfile({
                groupId: normalizedGroupId,
                endpoint,
                includeRoles
            })
    });

    return json;
}

async function fetchGroupProfile({
    groupId,
    endpoint = '',
    includeRoles = true
}) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.fetchGroupProfile requires a group id.'
        );
    }

    const response = unwrapBackendGroupResponse(
        await backend.app.BackendGroupGet({
            groupId: normalizedGroupId,
            includeRoles: Boolean(includeRoles),
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}`
    );
    return normalize(response.json);
}

async function getUserGroups({ userId, endpoint = '' }) {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.getUserGroups requires a user id.'
        );
    }

    const rows = await fetchCachedData({
        queryKey: queryKeys.userGroups(normalizedUserId, endpoint),
        policy: entityQueryPolicies.groupCollection,
        queryFn: async () => {
            const response = unwrapBackendGroupResponse(
                await backend.app.BackendGroupUserGroupsGet({
                    userId: normalizedUserId,
                    endpoint
                }),
                `users/${encodeURIComponent(normalizedUserId)}/groups`
            );
            return Array.isArray(response.json) ? response.json : [];
        }
    });
    return rows.map((group) => normalize(group));
}

async function getGroupPosts({ groupId, endpoint = '', n = 100, offset = 0 }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupPosts requires a group id.'
        );
    }

    const response = unwrapBackendGroupResponse(
        await backend.app.BackendGroupPostsGet({
            groupId: normalizedGroupId,
            n,
            offset,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/posts`
    );
    return responseRows(response.json, 'posts');
}

async function getAllGroupPosts({ groupId, endpoint = '' }) {
    return collectPages(({ n, offset }) =>
        getGroupPosts({ groupId, endpoint, n, offset })
    );
}

async function createGroupPost({ groupId, params = {}, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.createGroupPost requires a group id.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupPostCreate({
            groupId: normalizedGroupId,
            params,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/posts`
    );
}

async function editGroupPost({ groupId, postId, params = {}, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedPostId = normalizeEntityId(postId);
    if (!normalizedGroupId || !normalizedPostId) {
        throw new Error(
            'GroupProfileRepository.editGroupPost requires group and post ids.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupPostEdit({
            groupId: normalizedGroupId,
            postId: normalizedPostId,
            params,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/posts/${encodeURIComponent(normalizedPostId)}`
    );
}

async function deleteGroupPost({ groupId, postId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedPostId = normalizeEntityId(postId);
    if (!normalizedGroupId || !normalizedPostId) {
        throw new Error(
            'GroupProfileRepository.deleteGroupPost requires group and post ids.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupPostDelete({
            groupId: normalizedGroupId,
            postId: normalizedPostId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/posts/${encodeURIComponent(normalizedPostId)}`
    );
}

async function getGroupMembers({
    groupId,
    endpoint = '',
    n = 100,
    offset = 0,
    sort = 'joinedAt:desc',
    roleId = '',
    force = false
}) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupMembers requires a group id.'
        );
    }

    const params: QueryParams = { n, offset, sort };
    if (roleId) {
        params.roleId = roleId;
    }

    return fetchCachedData({
        queryKey: queryKeys.groupMembers(
            { groupId: normalizedGroupId, ...params },
            endpoint
        ),
        policy: entityQueryPolicies.groupCollection,
        force,
        queryFn: async () => {
            const response = unwrapBackendGroupResponse(
                await backend.app.BackendGroupMembersGet({
                    groupId: normalizedGroupId,
                    n,
                    offset,
                    sort,
                    roleId,
                    endpoint
                }),
                `groups/${encodeURIComponent(normalizedGroupId)}/members`
            );
            return responseRows(response.json, 'members');
        }
    });
}

async function getGroupMembersSearch({
    groupId,
    query = '',
    endpoint = '',
    n = 100,
    offset = 0
}) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedQuery = normalizeText(query);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupMembersSearch requires a group id.'
        );
    }

    const response = unwrapBackendGroupResponse(
        await backend.app.BackendGroupMembersSearch({
            groupId: normalizedGroupId,
            n,
            offset,
            query: normalizedQuery,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/members/search`
    );
    return responseRows(response.json, 'results');
}

async function getAllGroupMembers({
    groupId,
    endpoint = '',
    sort = 'joinedAt:desc',
    roleId = '',
    force = false
}) {
    return collectPages(({ n, offset }) =>
        getGroupMembers({ groupId, endpoint, n, offset, sort, roleId, force })
    );
}

async function getGroupGallery({
    groupId,
    galleryId,
    endpoint = '',
    n = 100,
    offset = 0,
    force = false
}) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedGalleryId = normalizeEntityId(galleryId);
    if (!normalizedGroupId || !normalizedGalleryId) {
        throw new Error(
            'GroupProfileRepository.getGroupGallery requires group and gallery ids.'
        );
    }

    const params: QueryParams = { n, offset };
    return fetchCachedData({
        queryKey: queryKeys.groupGallery(
            {
                groupId: normalizedGroupId,
                galleryId: normalizedGalleryId,
                ...params
            },
            endpoint
        ),
        policy: entityQueryPolicies.groupCollection,
        force,
        queryFn: async () => {
            const response = unwrapBackendGroupResponse(
                await backend.app.BackendGroupGalleryGet({
                    groupId: normalizedGroupId,
                    galleryId: normalizedGalleryId,
                    n,
                    offset,
                    endpoint
                }),
                `groups/${encodeURIComponent(normalizedGroupId)}/galleries/${encodeURIComponent(normalizedGalleryId)}`
            );
            return responseRows(response.json, 'files');
        }
    });
}

async function getAllGroupGallery({
    groupId,
    galleryId,
    endpoint = '',
    force = false
}) {
    return collectPages(({ n, offset }) =>
        getGroupGallery({ groupId, galleryId, endpoint, n, offset, force })
    );
}

async function joinGroup({ groupId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.joinGroup requires a group id.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupJoin({
            groupId: normalizedGroupId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/join`
    );
}

async function leaveGroup({ groupId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.leaveGroup requires a group id.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupLeave({
            groupId: normalizedGroupId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/leave`
    );
}

async function cancelGroupRequest({ groupId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.cancelGroupRequest requires a group id.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupRequestCancel({
            groupId: normalizedGroupId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/requests`
    );
}

async function sendGroupInvite({ groupId, userId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.sendGroupInvite requires group and user ids.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupInviteSend({
            groupId: normalizedGroupId,
            userId: normalizedUserId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/invites`
    );
}

async function kickGroupMember({ groupId, userId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.kickGroupMember requires group and user ids.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupMemberKick({
            groupId: normalizedGroupId,
            userId: normalizedUserId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/members/${encodeURIComponent(normalizedUserId)}`
    );
}

async function banGroupMember({ groupId, userId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.banGroupMember requires group and user ids.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupMemberBan({
            groupId: normalizedGroupId,
            userId: normalizedUserId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/bans`
    );
}

async function unbanGroupMember({ groupId, userId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.unbanGroupMember requires group and user ids.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupMemberUnban({
            groupId: normalizedGroupId,
            userId: normalizedUserId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/members/${encodeURIComponent(normalizedUserId)}`
    );
}

async function deleteSentGroupInvite({ groupId, userId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.deleteSentGroupInvite requires group and user ids.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupInviteDelete({
            groupId: normalizedGroupId,
            userId: normalizedUserId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/invites/${encodeURIComponent(normalizedUserId)}`
    );
}

async function respondGroupJoinRequest({
    groupId,
    userId,
    action,
    block = false,
    endpoint = ''
}) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId || !action) {
        throw new Error(
            'GroupProfileRepository.respondGroupJoinRequest requires group id, user id, and action.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupJoinRequestRespond({
            groupId: normalizedGroupId,
            userId: normalizedUserId,
            action,
            block: Boolean(block),
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/requests/${encodeURIComponent(normalizedUserId)}`
    );
}

async function deleteBlockedGroupRequest({ groupId, userId, endpoint = '' }) {
    return kickGroupMember({ groupId, userId, endpoint });
}

async function getGroupInstances({ groupId, userId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.getGroupInstances requires group and user ids.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupInstancesGet({
            groupId: normalizedGroupId,
            userId: normalizedUserId,
            endpoint
        }),
        `users/${encodeURIComponent(normalizedUserId)}/instances/groups/${encodeURIComponent(normalizedGroupId)}`
    );
}

async function getGroupBans({ groupId, endpoint = '', n = 100, offset = 0 }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupBans requires a group id.'
        );
    }

    const response = unwrapBackendGroupResponse(
        await backend.app.BackendGroupBansGet({
            groupId: normalizedGroupId,
            n,
            offset,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/bans`
    );
    return responseRows(response.json, 'bans');
}

async function getAllGroupBans({ groupId, endpoint = '' }) {
    return collectPages(({ n, offset }) =>
        getGroupBans({ groupId, endpoint, n, offset })
    );
}

async function getGroupInvites({
    groupId,
    endpoint = '',
    n = 100,
    offset = 0
}) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupInvites requires a group id.'
        );
    }

    const response = unwrapBackendGroupResponse(
        await backend.app.BackendGroupInvitesGet({
            groupId: normalizedGroupId,
            n,
            offset,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/invites`
    );
    return responseRows(response.json, 'invites');
}

async function getAllGroupInvites({ groupId, endpoint = '' }) {
    return collectPages(({ n, offset }) =>
        getGroupInvites({ groupId, endpoint, n, offset })
    );
}

async function getGroupJoinRequests({
    groupId,
    endpoint = '',
    n = 100,
    offset = 0,
    blocked = false
}) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupJoinRequests requires a group id.'
        );
    }

    const response = unwrapBackendGroupResponse(
        await backend.app.BackendGroupJoinRequestsGet({
            groupId: normalizedGroupId,
            n,
            offset,
            blocked: Boolean(blocked),
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/requests`
    );
    return responseRows(response.json, 'requests');
}

async function getAllGroupJoinRequests({
    groupId,
    endpoint = '',
    blocked = false
}) {
    return collectPages(({ n, offset }) =>
        getGroupJoinRequests({ groupId, endpoint, n, offset, blocked })
    );
}

async function getGroupAuditLogTypes({ groupId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupAuditLogTypes requires a group id.'
        );
    }

    const response = unwrapBackendGroupResponse(
        await backend.app.BackendGroupAuditLogTypesGet({
            groupId: normalizedGroupId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/auditLogTypes`
    );
    return Array.isArray(response.json) ? response.json : [];
}

async function getGroupLogs({
    groupId,
    endpoint = '',
    n = 100,
    offset = 0,
    eventTypes = []
}) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupLogs requires a group id.'
        );
    }

    const params: QueryParams = { n, offset };
    if (Array.isArray(eventTypes) && eventTypes.length) {
        params.eventTypes = eventTypes.join(',');
    }

    const response = unwrapBackendGroupResponse(
        await backend.app.BackendGroupLogsGet({
            groupId: normalizedGroupId,
            n,
            offset,
            eventTypes:
                typeof params.eventTypes === 'string'
                    ? params.eventTypes
                    : '',
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/auditLogs`
    );
    return responseRows(response.json, 'results');
}

async function getAllGroupLogs({ groupId, endpoint = '', eventTypes = [] }) {
    return collectPages(({ n, offset }) =>
        getGroupLogs({ groupId, endpoint, n, offset, eventTypes })
    );
}

async function setGroupRepresentation({
    groupId,
    isRepresenting,
    endpoint = ''
}) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.setGroupRepresentation requires a group id.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupRepresentationSet({
            groupId: normalizedGroupId,
            isRepresenting: Boolean(isRepresenting),
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/representation`
    );
}

async function setGroupMemberProps({
    groupId,
    userId,
    params = {},
    endpoint = ''
}) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.setGroupMemberProps requires group and user ids.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupMemberPropsSet({
            groupId: normalizedGroupId,
            userId: normalizedUserId,
            params,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/members/${encodeURIComponent(normalizedUserId)}`
    );
}

async function blockGroup({ groupId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.blockGroup requires a group id.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupBlock({
            groupId: normalizedGroupId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/block`
    );
}

async function unblockGroup({ groupId, userId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.unblockGroup requires group and user ids.'
        );
    }

    return unwrapBackendGroupResponse(
        await backend.app.BackendGroupUnblock({
            groupId: normalizedGroupId,
            userId: normalizedUserId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/bans/${encodeURIComponent(normalizedUserId)}`
    );
}

async function getUsersGroupInstances({ userId, endpoint = '' }) {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.getUsersGroupInstances requires a user id.'
        );
    }

    return unwrapBackendGroupResponse<{
        instances?: unknown[];
        fetchedAt?: unknown;
        [key: string]: unknown;
    }>(
        await backend.app.BackendGroupUserInstancesGet({
            userId: normalizedUserId,
            endpoint
        }),
        `users/${encodeURIComponent(normalizedUserId)}/instances/groups`
    );
}

const groupProfileRepository = Object.freeze({
    normalize,
    executeGet,
    executePost,
    executePut,
    executeDelete,
    fetchGroupProfile,
    getGroupProfile,
    getUserGroups,
    getGroupPosts,
    getAllGroupPosts,
    createGroupPost,
    editGroupPost,
    deleteGroupPost,
    getGroupMembers,
    getGroupMembersSearch,
    getAllGroupMembers,
    getGroupGallery,
    getAllGroupGallery,
    joinGroup,
    leaveGroup,
    cancelGroupRequest,
    sendGroupInvite,
    kickGroupMember,
    banGroupMember,
    unbanGroupMember,
    deleteSentGroupInvite,
    respondGroupJoinRequest,
    deleteBlockedGroupRequest,
    getGroupInstances,
    getGroupBans,
    getAllGroupBans,
    getGroupInvites,
    getAllGroupInvites,
    getGroupJoinRequests,
    getAllGroupJoinRequests,
    getGroupAuditLogTypes,
    getGroupLogs,
    getAllGroupLogs,
    setGroupRepresentation,
    setGroupMemberProps,
    blockGroup,
    unblockGroup,
    getUsersGroupInstances
});

export {
    normalize,
    executeGet,
    executePost,
    executePut,
    executeDelete,
    getGroupProfile,
    getUserGroups,
    getGroupPosts,
    getAllGroupPosts,
    createGroupPost,
    editGroupPost,
    deleteGroupPost,
    getGroupMembers,
    getGroupMembersSearch,
    getAllGroupMembers,
    getGroupGallery,
    getAllGroupGallery,
    joinGroup,
    leaveGroup,
    cancelGroupRequest,
    sendGroupInvite,
    kickGroupMember,
    banGroupMember,
    unbanGroupMember,
    deleteSentGroupInvite,
    respondGroupJoinRequest,
    deleteBlockedGroupRequest,
    getGroupInstances,
    getGroupBans,
    getAllGroupBans,
    getGroupInvites,
    getAllGroupInvites,
    getGroupJoinRequests,
    getAllGroupJoinRequests,
    getGroupAuditLogTypes,
    getGroupLogs,
    getAllGroupLogs,
    setGroupRepresentation,
    setGroupMemberProps,
    blockGroup,
    unblockGroup,
    getUsersGroupInstances
};
export default groupProfileRepository;
