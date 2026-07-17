import type { GroupProfileRecord } from '@/domain/entities/profileEntities';
import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';
import { createDefaultGroupRef } from '@/shared/utils/groupTransforms';

import {
    type GroupInstancesResponse,
    type GroupProfileInput,
    type GroupRecord,
    type GroupUserGroupRow,
    type GroupUserInput,
    isRecord,
    normalizeArray,
    normalizeEntityId,
    normalizeString,
    normalizeText,
    parseInteger,
    unwrapVrchatGroupResponse
} from './shared';

function normalizeGroupRoles(values: unknown): GroupRecord[] {
    if (!Array.isArray(values)) {
        return [];
    }

    return values
        .filter((role): role is GroupRecord =>
            Boolean(role && typeof role === 'object')
        )
        .map((role) => ({
            ...role,
            id: normalizeEntityId(role.id),
            name: normalizeText(role.name),
            description: normalizeText(role.description),
            permissions: normalizeArray(role.permissions)
        }));
}

function normalizeGroupProfile(
    group: GroupRecord | null | undefined
): GroupProfileRecord {
    const base = createDefaultGroupRef(group ?? {});
    const owner = isRecord(base.owner) ? base.owner : {};
    const shortCode = normalizeString(base.shortCode);
    const discriminator = normalizeString(base.discriminator);
    const ownerId =
        normalizeEntityId(base.ownerId) ||
        normalizeEntityId(owner.id) ||
        normalizeEntityId(owner.userId) ||
        normalizeEntityId(owner.user_id);
    const ownerDisplayName =
        normalizeText(base.ownerDisplayName) ||
        normalizeText(base.ownerName) ||
        normalizeText(owner.displayName) ||
        normalizeText(owner.username) ||
        normalizeText(owner.name);
    const groupUrl =
        shortCode && discriminator
            ? `https://vrc.group/${shortCode}.${discriminator}`
            : '';

    return {
        ...base,
        id: normalizeEntityId(base.id || base.groupId),
        name: normalizeText(base.name),
        displayName: normalizeText(base.displayName || base.name),
        description: normalizeText(base.description),
        rules: normalizeText(base.rules),
        shortCode,
        discriminator,
        bannerUrl: normalizeString(base.bannerUrl),
        iconUrl: normalizeString(base.iconUrl),
        createdAt: typeof base.createdAt === 'string' ? base.createdAt : '',
        updatedAt: typeof base.updatedAt === 'string' ? base.updatedAt : '',
        memberCount: parseInteger(base.memberCount),
        onlineMemberCount: parseInteger(base.onlineMemberCount),
        ownerId,
        ownerDisplayName,
        privacy: normalizeString(base.privacy),
        membershipStatus: normalizeString(base.membershipStatus),
        memberCountSyncedAt:
            typeof base.memberCountSyncedAt === 'string'
                ? base.memberCountSyncedAt
                : '',
        languages: normalizeArray(base.languages),
        links: normalizeArray(base.links),
        tags: normalizeArray(base.tags),
        roles: normalizeGroupRoles(base.roles),
        url: groupUrl
    };
}

export function normalize(group: GroupRecord): GroupProfileRecord {
    return normalizeGroupProfile(group);
}

export async function getGroupProfile({
    groupId,
    endpoint = '',
    includeRoles = true,
    force = false,
    dialog = false
}: GroupProfileInput): Promise<GroupProfileRecord> {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupProfile requires a group id.'
        );
    }

    return fetchCachedData({
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
}

export async function fetchGroupProfile({
    groupId,
    endpoint = '',
    includeRoles = true
}: GroupProfileInput): Promise<GroupProfileRecord> {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.fetchGroupProfile requires a group id.'
        );
    }

    const response = unwrapVrchatGroupResponse<GroupRecord>(
        await commands.appVrchatGroupGet({
            groupId: normalizedGroupId,
            includeRoles: Boolean(includeRoles),
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}`
    );
    return normalize(isRecord(response.json) ? response.json : {});
}

export async function getUserGroups({
    userId,
    endpoint = ''
}: Pick<GroupUserInput, 'userId' | 'endpoint'>) {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.getUserGroups requires a user id.'
        );
    }

    const rows = await fetchCachedData<GroupUserGroupRow[]>({
        queryKey: queryKeys.userGroups(normalizedUserId, endpoint),
        policy: entityQueryPolicies.groupCollection,
        queryFn: async () => {
            const response = unwrapVrchatGroupResponse<GroupUserGroupRow[]>(
                await commands.appVrchatGroupUserGroupsGet({
                    userId: normalizedUserId,
                    endpoint
                }),
                `users/${encodeURIComponent(normalizedUserId)}/groups`
            );
            return Array.isArray(response.json) ? response.json : [];
        }
    });
    return rows.map((group) => normalize(isRecord(group) ? group : {}));
}

export async function getGroupInstances({
    groupId,
    userId,
    endpoint = ''
}: GroupUserInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.getGroupInstances requires group and user ids.'
        );
    }

    return unwrapVrchatGroupResponse<GroupInstancesResponse>(
        await commands.appVrchatGroupInstancesGet({
            groupId: normalizedGroupId,
            userId: normalizedUserId,
            endpoint
        }),
        `users/${encodeURIComponent(normalizedUserId)}/instances/groups/${encodeURIComponent(normalizedGroupId)}`
    );
}

export async function getUsersGroupInstances({
    userId,
    endpoint = ''
}: Pick<GroupUserInput, 'userId' | 'endpoint'>) {
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.getUsersGroupInstances requires a user id.'
        );
    }

    return unwrapVrchatGroupResponse<GroupInstancesResponse>(
        await commands.appVrchatGroupUserInstancesGet({
            userId: normalizedUserId,
            endpoint
        }),
        `users/${encodeURIComponent(normalizedUserId)}/instances/groups`
    );
}
