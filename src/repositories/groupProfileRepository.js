import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache.js';
import { replaceBioSymbols } from '@/shared/utils/base/string.js';
import { createDefaultGroupRef } from '@/shared/utils/groupTransforms.js';

import { executeVrchatRequest } from './vrchatRequest.js';

function normalizeEntityId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeText(value) {
    return typeof value === 'string' && value
        ? replaceBioSymbols(value).trim()
        : '';
}

function normalizeArray(values) {
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

function parseInteger(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeGroupRoles(values) {
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

function normalizeGroupProfile(group) {
    const base = createDefaultGroupRef(group ?? {});
    const shortCode = normalizeString(base.shortCode);
    const discriminator = normalizeString(base.discriminator);
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
        ownerId: normalizeEntityId(base.ownerId),
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

function responseRows(json, key = '') {
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
    const rows = [];

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

function normalize(group) {
    return normalizeGroupProfile(group);
}

async function executeGet(path, params = {}, { endpoint = '' } = {}) {
    return executeVrchatRequest(path, {
        endpoint,
        method: 'GET',
        params,
        fallbackMessage: 'VRChat group request failed'
    });
}

async function executePost(path, params = {}, { endpoint = '' } = {}) {
    return executeVrchatRequest(path, {
        endpoint,
        method: 'POST',
        body: params,
        fallbackMessage: 'VRChat group request failed'
    });
}

async function executePut(path, params = {}, { endpoint = '' } = {}) {
    return executeVrchatRequest(path, {
        endpoint,
        method: 'PUT',
        body: params,
        fallbackMessage: 'VRChat group request failed'
    });
}

async function executeDelete(path, params = {}, { endpoint = '' } = {}) {
    return executeVrchatRequest(path, {
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
        queryFn: async () => {
            const response = await executeGet(
                `groups/${encodeURIComponent(normalizedGroupId)}`,
                {
                    includeRoles: includeRoles ? 'true' : 'false'
                },
                { endpoint }
            );
            return response.json;
        }
    });

    return normalize(json);
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
            const response = await executeGet(
                `users/${encodeURIComponent(normalizedUserId)}/groups`,
                {},
                { endpoint }
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

    const response = await executeGet(
        `groups/${encodeURIComponent(normalizedGroupId)}/posts`,
        { n, offset },
        { endpoint }
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

    return executePost(
        `groups/${encodeURIComponent(normalizedGroupId)}/posts`,
        params,
        { endpoint }
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

    return executePut(
        `groups/${encodeURIComponent(normalizedGroupId)}/posts/${encodeURIComponent(normalizedPostId)}`,
        params,
        { endpoint }
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

    return executeDelete(
        `groups/${encodeURIComponent(normalizedGroupId)}/posts/${encodeURIComponent(normalizedPostId)}`,
        {},
        { endpoint }
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

    const params = { n, offset, sort };
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
            const response = await executeGet(
                `groups/${encodeURIComponent(normalizedGroupId)}/members`,
                params,
                { endpoint }
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

    const response = await executeGet(
        `groups/${encodeURIComponent(normalizedGroupId)}/members/search`,
        { n, offset, query: normalizedQuery },
        { endpoint }
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

    const params = { n, offset };
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
            const response = await executeGet(
                `groups/${encodeURIComponent(normalizedGroupId)}/galleries/${encodeURIComponent(normalizedGalleryId)}`,
                params,
                { endpoint }
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

    return executePost(
        `groups/${encodeURIComponent(normalizedGroupId)}/join`,
        {},
        { endpoint }
    );
}

async function leaveGroup({ groupId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.leaveGroup requires a group id.'
        );
    }

    return executePost(
        `groups/${encodeURIComponent(normalizedGroupId)}/leave`,
        {},
        { endpoint }
    );
}

async function cancelGroupRequest({ groupId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.cancelGroupRequest requires a group id.'
        );
    }

    return executeDelete(
        `groups/${encodeURIComponent(normalizedGroupId)}/requests`,
        {},
        { endpoint }
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

    return executePost(
        `groups/${encodeURIComponent(normalizedGroupId)}/invites`,
        { userId: normalizedUserId },
        { endpoint }
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

    return executeDelete(
        `groups/${encodeURIComponent(normalizedGroupId)}/members/${encodeURIComponent(normalizedUserId)}`,
        {},
        { endpoint }
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

    return executePost(
        `groups/${encodeURIComponent(normalizedGroupId)}/bans`,
        { userId: normalizedUserId },
        { endpoint }
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

    return executeDelete(
        `groups/${encodeURIComponent(normalizedGroupId)}/members/${encodeURIComponent(normalizedUserId)}`,
        {},
        { endpoint }
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

    return executeDelete(
        `groups/${encodeURIComponent(normalizedGroupId)}/invites/${encodeURIComponent(normalizedUserId)}`,
        {},
        { endpoint }
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

    return executePut(
        `groups/${encodeURIComponent(normalizedGroupId)}/requests/${encodeURIComponent(normalizedUserId)}`,
        { action, ...(block ? { block: true } : {}) },
        { endpoint }
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

    return executeGet(
        `users/${encodeURIComponent(normalizedUserId)}/instances/groups/${encodeURIComponent(normalizedGroupId)}`,
        {},
        { endpoint }
    );
}

async function getGroupBans({ groupId, endpoint = '', n = 100, offset = 0 }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupBans requires a group id.'
        );
    }

    const response = await executeGet(
        `groups/${encodeURIComponent(normalizedGroupId)}/bans`,
        { n, offset },
        { endpoint }
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

    const response = await executeGet(
        `groups/${encodeURIComponent(normalizedGroupId)}/invites`,
        { n, offset },
        { endpoint }
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

    const response = await executeGet(
        `groups/${encodeURIComponent(normalizedGroupId)}/requests`,
        { n, offset, blocked },
        { endpoint }
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

    const response = await executeGet(
        `groups/${encodeURIComponent(normalizedGroupId)}/auditLogTypes`,
        {},
        { endpoint }
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

    const params = { n, offset };
    if (Array.isArray(eventTypes) && eventTypes.length) {
        params.eventTypes = eventTypes.join(',');
    }

    const response = await executeGet(
        `groups/${encodeURIComponent(normalizedGroupId)}/auditLogs`,
        params,
        { endpoint }
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

    return executePut(
        `groups/${encodeURIComponent(normalizedGroupId)}/representation`,
        { isRepresenting: Boolean(isRepresenting) },
        { endpoint }
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

    return executePut(
        `groups/${encodeURIComponent(normalizedGroupId)}/members/${encodeURIComponent(normalizedUserId)}`,
        params,
        { endpoint }
    );
}

async function blockGroup({ groupId, endpoint = '' }) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.blockGroup requires a group id.'
        );
    }

    return executePost(
        `groups/${encodeURIComponent(normalizedGroupId)}/block`,
        {},
        { endpoint }
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

    return executeDelete(
        `groups/${encodeURIComponent(normalizedGroupId)}/bans/${encodeURIComponent(normalizedUserId)}`,
        {},
        { endpoint }
    );
}

async function getUsersGroupInstances({ userId, endpoint = '' }) {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.getUsersGroupInstances requires a user id.'
        );
    }

    return executeGet(
        `users/${encodeURIComponent(normalizedUserId)}/instances/groups`,
        {},
        { endpoint }
    );
}

const groupProfileRepository = Object.freeze({
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
