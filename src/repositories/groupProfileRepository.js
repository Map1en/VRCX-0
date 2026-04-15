import webRepository from './webRepository.js';
import { safeJsonParse } from './baseRepository.js';
import { DEFAULT_ENDPOINT_DOMAIN } from './vrchatAuthRepository.js';
import { createDefaultGroupRef } from '@/shared/utils/groupTransforms.js';
import { replaceBioSymbols } from '@/shared/utils/base/string.js';
import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/services/entityQueryCacheService.js';

function normalizeEndpointDomain(endpointDomain) {
    if (typeof endpointDomain === 'string' && endpointDomain.trim()) {
        return endpointDomain.trim();
    }

    return DEFAULT_ENDPOINT_DOMAIN;
}

function appendParams(url, params) {
    if (!params || typeof params !== 'object') {
        return url;
    }

    for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined) {
            continue;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                if (item === null || item === undefined) {
                    continue;
                }
                url.searchParams.append(key, String(item));
            }
            continue;
        }

        url.searchParams.set(key, String(value));
    }

    return url;
}

function buildUrl(path, params = {}, endpoint = '') {
    const baseUrl = normalizeEndpointDomain(endpoint).replace(/\/?$/, '/');
    const url = new URL(path, baseUrl);
    return appendParams(url, params).toString();
}

function parseJsonResponse(data) {
    if (data === null || data === undefined || data === '') {
        return data ?? null;
    }

    if (typeof data !== 'string') {
        return data;
    }

    return safeJsonParse(data, data);
}

function unwrapErrorMessage(json, status) {
    if (typeof json === 'string' && json.trim()) {
        return json.replace(/^"+|"+$/g, '');
    }

    const message = json?.error?.message ?? json?.message;
    if (typeof message === 'string' && message.trim()) {
        return message.replace(/^"+|"+$/g, '');
    }

    return `VRChat group request failed (${status})`;
}

function createGroupRequestError(message, status, path, payload = null) {
    const error = new Error(message);
    error.status = status;
    error.endpoint = path;
    error.payload = payload;
    return error;
}

function normalizeEntityId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
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
        .map((value) => (typeof value === 'string' ? value.trim() : String(value ?? '').trim()))
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

async function collectPages(fetchPage, { pageSize = 100, maxPages = Number.POSITIVE_INFINITY } = {}) {
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

class GroupProfileRepository {
    normalize(group) {
        return normalizeGroupProfile(group);
    }

    async executeGet(path, params = {}, { endpoint = '' } = {}) {
        const response = await webRepository.execute({
            url: buildUrl(path, params, endpoint),
            method: 'GET'
        });
        const json = parseJsonResponse(response.data);

        if (response.status >= 400) {
            throw createGroupRequestError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw createGroupRequestError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        return {
            json,
            status: response.status,
            raw: response.raw
        };
    }

    async executePost(path, params = {}, { endpoint = '' } = {}) {
        const response = await webRepository.execute({
            url: buildUrl(path, {}, endpoint),
            method: 'POST',
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: JSON.stringify(params && typeof params === 'object' ? params : {})
        });
        const json = parseJsonResponse(response.data);

        if (response.status >= 400) {
            throw createGroupRequestError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw createGroupRequestError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        return {
            json,
            status: response.status,
            raw: response.raw
        };
    }

    async executePut(path, params = {}, { endpoint = '' } = {}) {
        const response = await webRepository.execute({
            url: buildUrl(path, {}, endpoint),
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: JSON.stringify(params && typeof params === 'object' ? params : {})
        });
        const json = parseJsonResponse(response.data);

        if (response.status >= 400) {
            throw createGroupRequestError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw createGroupRequestError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        return {
            json,
            status: response.status,
            raw: response.raw
        };
    }

    async executeDelete(path, params = {}, { endpoint = '' } = {}) {
        const response = await webRepository.execute({
            url: buildUrl(path, params, endpoint),
            method: 'DELETE'
        });
        const json = parseJsonResponse(response.data);

        if (response.status >= 400) {
            throw createGroupRequestError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        if (json && typeof json === 'object' && 'error' in json) {
            throw createGroupRequestError(
                unwrapErrorMessage(json, response.status),
                response.status,
                path,
                json
            );
        }

        return {
            json,
            status: response.status,
            raw: response.raw
        };
    }

    async getGroupProfile({ groupId, endpoint = '', includeRoles = true, force = false }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        if (!normalizedGroupId) {
            throw new Error('GroupProfileRepository.getGroupProfile requires a group id.');
        }

        const json = await fetchCachedData({
            queryKey: queryKeys.group(normalizedGroupId, includeRoles, endpoint),
            policy: entityQueryPolicies.group,
            force,
            queryFn: async () => {
                const response = await this.executeGet(
                    `groups/${encodeURIComponent(normalizedGroupId)}`,
                    {
                        includeRoles: includeRoles ? 'true' : 'false'
                    },
                    { endpoint }
                );
                return response.json;
            }
        });

        return this.normalize(json);
    }

    async getUserGroups({ userId, endpoint = '' }) {
        const normalizedUserId = normalizeEntityId(userId);
        if (!normalizedUserId) {
            throw new Error('GroupProfileRepository.getUserGroups requires a user id.');
        }

        const rows = await fetchCachedData({
            queryKey: ['user', normalizedUserId, 'groups', endpoint || ''],
            policy: entityQueryPolicies.groupCollection,
            queryFn: async () => {
                const response = await this.executeGet(
                    `users/${encodeURIComponent(normalizedUserId)}/groups`,
                    {},
                    { endpoint }
                );
                return Array.isArray(response.json) ? response.json : [];
            }
        });
        return rows.map((group) => this.normalize(group));
    }

    async getGroupPosts({ groupId, endpoint = '', n = 100, offset = 0 }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        if (!normalizedGroupId) {
            throw new Error('GroupProfileRepository.getGroupPosts requires a group id.');
        }

        const response = await this.executeGet(
            `groups/${encodeURIComponent(normalizedGroupId)}/posts`,
            { n, offset },
            { endpoint }
        );
        return responseRows(response.json, 'posts');
    }

    async getAllGroupPosts({ groupId, endpoint = '' }) {
        return collectPages(({ n, offset }) =>
            this.getGroupPosts({ groupId, endpoint, n, offset })
        );
    }

    async createGroupPost({ groupId, params = {}, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        if (!normalizedGroupId) {
            throw new Error('GroupProfileRepository.createGroupPost requires a group id.');
        }

        return this.executePost(
            `groups/${encodeURIComponent(normalizedGroupId)}/posts`,
            params,
            { endpoint }
        );
    }

    async editGroupPost({ groupId, postId, params = {}, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        const normalizedPostId = normalizeEntityId(postId);
        if (!normalizedGroupId || !normalizedPostId) {
            throw new Error('GroupProfileRepository.editGroupPost requires group and post ids.');
        }

        return this.executePut(
            `groups/${encodeURIComponent(normalizedGroupId)}/posts/${encodeURIComponent(normalizedPostId)}`,
            params,
            { endpoint }
        );
    }

    async deleteGroupPost({ groupId, postId, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        const normalizedPostId = normalizeEntityId(postId);
        if (!normalizedGroupId || !normalizedPostId) {
            throw new Error('GroupProfileRepository.deleteGroupPost requires group and post ids.');
        }

        return this.executeDelete(
            `groups/${encodeURIComponent(normalizedGroupId)}/posts/${encodeURIComponent(normalizedPostId)}`,
            {},
            { endpoint }
        );
    }

    async getGroupMembers({ groupId, endpoint = '', n = 100, offset = 0, sort = 'joinedAt:desc', roleId = '', force = false }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        if (!normalizedGroupId) {
            throw new Error('GroupProfileRepository.getGroupMembers requires a group id.');
        }

        const params = { n, offset, sort };
        if (roleId) {
            params.roleId = roleId;
        }

        return fetchCachedData({
            queryKey: queryKeys.groupMembers({ groupId: normalizedGroupId, ...params }, endpoint),
            policy: entityQueryPolicies.groupCollection,
            force,
            queryFn: async () => {
                const response = await this.executeGet(
                    `groups/${encodeURIComponent(normalizedGroupId)}/members`,
                    params,
                    { endpoint }
                );
                return responseRows(response.json, 'members');
            }
        });
    }

    async getGroupMembersSearch({ groupId, query = '', endpoint = '', n = 100, offset = 0 }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        const normalizedQuery = normalizeText(query);
        if (!normalizedGroupId) {
            throw new Error('GroupProfileRepository.getGroupMembersSearch requires a group id.');
        }

        const response = await this.executeGet(
            `groups/${encodeURIComponent(normalizedGroupId)}/members/search`,
            { n, offset, query: normalizedQuery },
            { endpoint }
        );
        return responseRows(response.json, 'results');
    }

    async getAllGroupMembers({ groupId, endpoint = '', sort = 'joinedAt:desc', roleId = '', force = false }) {
        return collectPages(({ n, offset }) =>
            this.getGroupMembers({ groupId, endpoint, n, offset, sort, roleId, force })
        );
    }

    async getGroupGallery({ groupId, galleryId, endpoint = '', n = 100, offset = 0, force = false }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        const normalizedGalleryId = normalizeEntityId(galleryId);
        if (!normalizedGroupId || !normalizedGalleryId) {
            throw new Error('GroupProfileRepository.getGroupGallery requires group and gallery ids.');
        }

        const params = { n, offset };
        return fetchCachedData({
            queryKey: queryKeys.groupGallery(
                { groupId: normalizedGroupId, galleryId: normalizedGalleryId, ...params },
                endpoint
            ),
            policy: entityQueryPolicies.groupCollection,
            force,
            queryFn: async () => {
                const response = await this.executeGet(
                    `groups/${encodeURIComponent(normalizedGroupId)}/galleries/${encodeURIComponent(normalizedGalleryId)}`,
                    params,
                    { endpoint }
                );
                return responseRows(response.json, 'files');
            }
        });
    }

    async getAllGroupGallery({ groupId, galleryId, endpoint = '', force = false }) {
        return collectPages(({ n, offset }) =>
            this.getGroupGallery({ groupId, galleryId, endpoint, n, offset, force })
        );
    }

    async joinGroup({ groupId, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        if (!normalizedGroupId) {
            throw new Error('GroupProfileRepository.joinGroup requires a group id.');
        }

        return this.executePost(
            `groups/${encodeURIComponent(normalizedGroupId)}/join`,
            {},
            { endpoint }
        );
    }

    async leaveGroup({ groupId, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        if (!normalizedGroupId) {
            throw new Error('GroupProfileRepository.leaveGroup requires a group id.');
        }

        return this.executePost(
            `groups/${encodeURIComponent(normalizedGroupId)}/leave`,
            {},
            { endpoint }
        );
    }

    async cancelGroupRequest({ groupId, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        if (!normalizedGroupId) {
            throw new Error('GroupProfileRepository.cancelGroupRequest requires a group id.');
        }

        return this.executeDelete(
            `groups/${encodeURIComponent(normalizedGroupId)}/requests`,
            {},
            { endpoint }
        );
    }

    async sendGroupInvite({ groupId, userId, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        const normalizedUserId = normalizeEntityId(userId);
        if (!normalizedGroupId || !normalizedUserId) {
            throw new Error('GroupProfileRepository.sendGroupInvite requires group and user ids.');
        }

        return this.executePost(
            `groups/${encodeURIComponent(normalizedGroupId)}/invites`,
            { userId: normalizedUserId },
            { endpoint }
        );
    }

    async kickGroupMember({ groupId, userId, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        const normalizedUserId = normalizeEntityId(userId);
        if (!normalizedGroupId || !normalizedUserId) {
            throw new Error('GroupProfileRepository.kickGroupMember requires group and user ids.');
        }

        return this.executeDelete(
            `groups/${encodeURIComponent(normalizedGroupId)}/members/${encodeURIComponent(normalizedUserId)}`,
            {},
            { endpoint }
        );
    }

    async banGroupMember({ groupId, userId, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        const normalizedUserId = normalizeEntityId(userId);
        if (!normalizedGroupId || !normalizedUserId) {
            throw new Error('GroupProfileRepository.banGroupMember requires group and user ids.');
        }

        return this.executePost(
            `groups/${encodeURIComponent(normalizedGroupId)}/bans`,
            { userId: normalizedUserId },
            { endpoint }
        );
    }

    async unbanGroupMember({ groupId, userId, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        const normalizedUserId = normalizeEntityId(userId);
        if (!normalizedGroupId || !normalizedUserId) {
            throw new Error('GroupProfileRepository.unbanGroupMember requires group and user ids.');
        }

        return this.executeDelete(
            `groups/${encodeURIComponent(normalizedGroupId)}/members/${encodeURIComponent(normalizedUserId)}`,
            {},
            { endpoint }
        );
    }

    async deleteSentGroupInvite({ groupId, userId, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        const normalizedUserId = normalizeEntityId(userId);
        if (!normalizedGroupId || !normalizedUserId) {
            throw new Error('GroupProfileRepository.deleteSentGroupInvite requires group and user ids.');
        }

        return this.executeDelete(
            `groups/${encodeURIComponent(normalizedGroupId)}/invites/${encodeURIComponent(normalizedUserId)}`,
            {},
            { endpoint }
        );
    }

    async respondGroupJoinRequest({ groupId, userId, action, block = false, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        const normalizedUserId = normalizeEntityId(userId);
        if (!normalizedGroupId || !normalizedUserId || !action) {
            throw new Error('GroupProfileRepository.respondGroupJoinRequest requires group id, user id, and action.');
        }

        return this.executePut(
            `groups/${encodeURIComponent(normalizedGroupId)}/requests/${encodeURIComponent(normalizedUserId)}`,
            { action, ...(block ? { block: true } : {}) },
            { endpoint }
        );
    }

    async deleteBlockedGroupRequest({ groupId, userId, endpoint = '' }) {
        return this.kickGroupMember({ groupId, userId, endpoint });
    }

    async getGroupInstances({ groupId, userId, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        const normalizedUserId = normalizeEntityId(userId);
        if (!normalizedGroupId || !normalizedUserId) {
            throw new Error('GroupProfileRepository.getGroupInstances requires group and user ids.');
        }

        return this.executeGet(
            `users/${encodeURIComponent(normalizedUserId)}/instances/groups/${encodeURIComponent(normalizedGroupId)}`,
            {},
            { endpoint }
        );
    }

    async getGroupBans({ groupId, endpoint = '', n = 100, offset = 0 }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        if (!normalizedGroupId) {
            throw new Error('GroupProfileRepository.getGroupBans requires a group id.');
        }

        const response = await this.executeGet(
            `groups/${encodeURIComponent(normalizedGroupId)}/bans`,
            { n, offset },
            { endpoint }
        );
        return responseRows(response.json, 'bans');
    }

    async getAllGroupBans({ groupId, endpoint = '' }) {
        return collectPages(({ n, offset }) =>
            this.getGroupBans({ groupId, endpoint, n, offset })
        );
    }

    async getGroupInvites({ groupId, endpoint = '', n = 100, offset = 0 }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        if (!normalizedGroupId) {
            throw new Error('GroupProfileRepository.getGroupInvites requires a group id.');
        }

        const response = await this.executeGet(
            `groups/${encodeURIComponent(normalizedGroupId)}/invites`,
            { n, offset },
            { endpoint }
        );
        return responseRows(response.json, 'invites');
    }

    async getAllGroupInvites({ groupId, endpoint = '' }) {
        return collectPages(({ n, offset }) =>
            this.getGroupInvites({ groupId, endpoint, n, offset })
        );
    }

    async getGroupJoinRequests({ groupId, endpoint = '', n = 100, offset = 0, blocked = false }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        if (!normalizedGroupId) {
            throw new Error('GroupProfileRepository.getGroupJoinRequests requires a group id.');
        }

        const response = await this.executeGet(
            `groups/${encodeURIComponent(normalizedGroupId)}/requests`,
            { n, offset, blocked },
            { endpoint }
        );
        return responseRows(response.json, 'requests');
    }

    async getAllGroupJoinRequests({ groupId, endpoint = '', blocked = false }) {
        return collectPages(({ n, offset }) =>
            this.getGroupJoinRequests({ groupId, endpoint, n, offset, blocked })
        );
    }

    async getGroupAuditLogTypes({ groupId, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        if (!normalizedGroupId) {
            throw new Error('GroupProfileRepository.getGroupAuditLogTypes requires a group id.');
        }

        const response = await this.executeGet(
            `groups/${encodeURIComponent(normalizedGroupId)}/auditLogTypes`,
            {},
            { endpoint }
        );
        return Array.isArray(response.json) ? response.json : [];
    }

    async getGroupLogs({ groupId, endpoint = '', n = 100, offset = 0, eventTypes = [] }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        if (!normalizedGroupId) {
            throw new Error('GroupProfileRepository.getGroupLogs requires a group id.');
        }

        const params = { n, offset };
        if (Array.isArray(eventTypes) && eventTypes.length) {
            params.eventTypes = eventTypes.join(',');
        }

        const response = await this.executeGet(
            `groups/${encodeURIComponent(normalizedGroupId)}/auditLogs`,
            params,
            { endpoint }
        );
        return responseRows(response.json, 'results');
    }

    async getAllGroupLogs({ groupId, endpoint = '', eventTypes = [] }) {
        return collectPages(({ n, offset }) =>
            this.getGroupLogs({ groupId, endpoint, n, offset, eventTypes })
        );
    }

    async setGroupRepresentation({ groupId, isRepresenting, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        if (!normalizedGroupId) {
            throw new Error('GroupProfileRepository.setGroupRepresentation requires a group id.');
        }

        return this.executePut(
            `groups/${encodeURIComponent(normalizedGroupId)}/representation`,
            { isRepresenting: Boolean(isRepresenting) },
            { endpoint }
        );
    }

    async setGroupMemberProps({ groupId, userId, params = {}, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        const normalizedUserId = normalizeEntityId(userId);
        if (!normalizedGroupId || !normalizedUserId) {
            throw new Error('GroupProfileRepository.setGroupMemberProps requires group and user ids.');
        }

        return this.executePut(
            `groups/${encodeURIComponent(normalizedGroupId)}/members/${encodeURIComponent(normalizedUserId)}`,
            params,
            { endpoint }
        );
    }

    async blockGroup({ groupId, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        if (!normalizedGroupId) {
            throw new Error('GroupProfileRepository.blockGroup requires a group id.');
        }

        return this.executePost(
            `groups/${encodeURIComponent(normalizedGroupId)}/block`,
            {},
            { endpoint }
        );
    }

    async unblockGroup({ groupId, userId, endpoint = '' }) {
        const normalizedGroupId = normalizeEntityId(groupId);
        const normalizedUserId = normalizeEntityId(userId);
        if (!normalizedGroupId || !normalizedUserId) {
            throw new Error('GroupProfileRepository.unblockGroup requires group and user ids.');
        }

        return this.executeDelete(
            `groups/${encodeURIComponent(normalizedGroupId)}/bans/${encodeURIComponent(normalizedUserId)}`,
            {},
            { endpoint }
        );
    }

    async getUsersGroupInstances({ userId, endpoint = '' }) {
        const normalizedUserId = normalizeEntityId(userId);
        if (!normalizedUserId) {
            throw new Error('GroupProfileRepository.getUsersGroupInstances requires a user id.');
        }

        return this.executeGet(
            `users/${encodeURIComponent(normalizedUserId)}/instances/groups`,
            {},
            { endpoint }
        );
    }
}

const groupProfileRepository = new GroupProfileRepository();

export { GroupProfileRepository };
export default groupProfileRepository;
