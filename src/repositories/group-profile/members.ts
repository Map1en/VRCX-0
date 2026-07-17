import type { GroupMemberRow } from '@/domain/entities/profileEntities';
import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';

import { VRCHAT_API_DEFAULT_PAGE_SIZE } from '../paginationConstants';
import type { QueryParams } from '../vrchatRequest';
import {
    collectPages,
    type GroupIdInput,
    type GroupMemberPropsInput,
    type GroupMembersInput,
    type GroupMembersSearchInput,
    type GroupRepresentationInput,
    type GroupUserInput,
    normalizeEntityId,
    normalizeText,
    responseRows,
    unwrapVrchatGroupResponse
} from './shared';

export async function getGroupMembers({
    groupId,
    endpoint = '',
    n = VRCHAT_API_DEFAULT_PAGE_SIZE,
    offset = 0,
    sort = 'joinedAt:desc',
    roleId = '',
    force = false
}: GroupMembersInput): Promise<GroupMemberRow[]> {
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
            const response = unwrapVrchatGroupResponse(
                await commands.appVrchatGroupMembersGet({
                    groupId: normalizedGroupId,
                    n,
                    offset,
                    sort,
                    roleId,
                    endpoint
                }),
                `groups/${encodeURIComponent(normalizedGroupId)}/members`
            );
            return responseRows<GroupMemberRow>(response.json, 'members');
        }
    });
}

export async function getGroupMembersSearch({
    groupId,
    query = '',
    endpoint = '',
    n = VRCHAT_API_DEFAULT_PAGE_SIZE,
    offset = 0
}: GroupMembersSearchInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedQuery = normalizeText(query);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupMembersSearch requires a group id.'
        );
    }

    const response = unwrapVrchatGroupResponse(
        await commands.appVrchatGroupMembersSearch({
            groupId: normalizedGroupId,
            n,
            offset,
            query: normalizedQuery,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/members/search`
    );
    return responseRows<GroupMemberRow>(response.json, 'results');
}

export async function getAllGroupMembers({
    groupId,
    endpoint = '',
    sort = 'joinedAt:desc',
    roleId = '',
    force = false
}: Omit<GroupMembersInput, 'n' | 'offset'>) {
    return collectPages(({ n, offset }) =>
        getGroupMembers({ groupId, endpoint, n, offset, sort, roleId, force })
    );
}

export async function joinGroup({ groupId, endpoint = '' }: GroupIdInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.joinGroup requires a group id.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupJoin({
            groupId: normalizedGroupId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/join`
    );
}

export async function leaveGroup({ groupId, endpoint = '' }: GroupIdInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.leaveGroup requires a group id.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupLeave({
            groupId: normalizedGroupId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/leave`
    );
}

export async function cancelGroupRequest({
    groupId,
    endpoint = ''
}: GroupIdInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.cancelGroupRequest requires a group id.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupRequestCancel({
            groupId: normalizedGroupId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/requests`
    );
}

export async function sendGroupInvite({
    groupId,
    userId,
    endpoint = ''
}: GroupUserInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.sendGroupInvite requires group and user ids.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupInviteSend({
            groupId: normalizedGroupId,
            userId: normalizedUserId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/invites`
    );
}

export async function setGroupRepresentation({
    groupId,
    isRepresenting,
    endpoint = ''
}: GroupRepresentationInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.setGroupRepresentation requires a group id.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupRepresentationSet({
            groupId: normalizedGroupId,
            isRepresenting: Boolean(isRepresenting),
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/representation`
    );
}

export async function setGroupMemberProps({
    groupId,
    userId,
    params = {},
    endpoint = ''
}: GroupMemberPropsInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.setGroupMemberProps requires group and user ids.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupMemberPropsSet({
            groupId: normalizedGroupId,
            userId: normalizedUserId,
            params,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/members/${encodeURIComponent(normalizedUserId)}`
    );
}
