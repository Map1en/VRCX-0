import { commands } from '@/platform/tauri/bindings';

import { VRCHAT_API_DEFAULT_PAGE_SIZE } from '../paginationConstants';
import {
    collectPages,
    type GroupIdInput,
    type GroupJoinRequestInput,
    type GroupJoinRequestResponseInput,
    type GroupModerationRow,
    type GroupPageInput,
    type GroupUserInput,
    type GroupUserRoleInput,
    normalizeEntityId,
    normalizeString,
    responseRows,
    unwrapVrchatGroupResponse
} from './shared';

export async function kickGroupMember({ groupId, userId }: GroupUserInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.kickGroupMember requires group and user ids.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupMemberKick({
            groupId: normalizedGroupId,
            userId: normalizedUserId
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/members/${encodeURIComponent(normalizedUserId)}`
    );
}

export async function banGroupMember({ groupId, userId }: GroupUserInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.banGroupMember requires group and user ids.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupMemberBan({
            groupId: normalizedGroupId,
            userId: normalizedUserId
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/bans`
    );
}

export async function unbanGroupMember({ groupId, userId }: GroupUserInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.unbanGroupMember requires group and user ids.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupMemberUnban({
            groupId: normalizedGroupId,
            userId: normalizedUserId
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/bans/${encodeURIComponent(normalizedUserId)}`
    );
}

export async function addGroupMemberRole({
    groupId,
    userId,
    roleId
}: GroupUserRoleInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    const normalizedRoleId = normalizeEntityId(roleId);
    if (!normalizedGroupId || !normalizedUserId || !normalizedRoleId) {
        throw new Error(
            'GroupProfileRepository.addGroupMemberRole requires group, user, and role ids.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupMemberRoleAdd({
            groupId: normalizedGroupId,
            userId: normalizedUserId,
            roleId: normalizedRoleId
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/members/${encodeURIComponent(normalizedUserId)}/roles/${encodeURIComponent(normalizedRoleId)}`
    );
}

export async function removeGroupMemberRole({
    groupId,
    userId,
    roleId
}: GroupUserRoleInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    const normalizedRoleId = normalizeEntityId(roleId);
    if (!normalizedGroupId || !normalizedUserId || !normalizedRoleId) {
        throw new Error(
            'GroupProfileRepository.removeGroupMemberRole requires group, user, and role ids.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupMemberRoleRemove({
            groupId: normalizedGroupId,
            userId: normalizedUserId,
            roleId: normalizedRoleId
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/members/${encodeURIComponent(normalizedUserId)}/roles/${encodeURIComponent(normalizedRoleId)}`
    );
}

export async function deleteSentGroupInvite({
    groupId,
    userId
}: GroupUserInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.deleteSentGroupInvite requires group and user ids.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupInviteDelete({
            groupId: normalizedGroupId,
            userId: normalizedUserId
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/invites/${encodeURIComponent(normalizedUserId)}`
    );
}

export async function respondGroupJoinRequest({
    groupId,
    userId,
    action,
    block = false
}: GroupJoinRequestResponseInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    const normalizedAction = normalizeString(action);
    if (!normalizedGroupId || !normalizedUserId || !normalizedAction) {
        throw new Error(
            'GroupProfileRepository.respondGroupJoinRequest requires group id, user id, and action.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupJoinRequestRespond({
            groupId: normalizedGroupId,
            userId: normalizedUserId,
            action: normalizedAction,
            block: Boolean(block)
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/requests/${encodeURIComponent(normalizedUserId)}`
    );
}

export async function deleteBlockedGroupRequest({
    groupId,
    userId
}: GroupUserInput) {
    return kickGroupMember({ groupId, userId });
}

export async function getGroupBans({
    groupId,
    n = VRCHAT_API_DEFAULT_PAGE_SIZE,
    offset = 0
}: GroupPageInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupBans requires a group id.'
        );
    }

    const response = unwrapVrchatGroupResponse(
        await commands.appVrchatGroupBansGet({
            groupId: normalizedGroupId,
            n,
            offset
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/bans`
    );
    return responseRows<GroupModerationRow>(response.json, 'bans');
}

export async function getAllGroupBans({ groupId }: GroupIdInput) {
    return collectPages(({ n, offset }) =>
        getGroupBans({ groupId, n, offset })
    );
}

export async function getGroupInvites({
    groupId,
    n = VRCHAT_API_DEFAULT_PAGE_SIZE,
    offset = 0
}: GroupPageInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupInvites requires a group id.'
        );
    }

    const response = unwrapVrchatGroupResponse(
        await commands.appVrchatGroupInvitesGet({
            groupId: normalizedGroupId,
            n,
            offset
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/invites`
    );
    return responseRows<GroupModerationRow>(response.json, 'invites');
}

export async function getAllGroupInvites({ groupId }: GroupIdInput) {
    return collectPages(({ n, offset }) =>
        getGroupInvites({ groupId, n, offset })
    );
}

export async function getGroupJoinRequests({
    groupId,
    n = VRCHAT_API_DEFAULT_PAGE_SIZE,
    offset = 0,
    blocked = false
}: GroupJoinRequestInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupJoinRequests requires a group id.'
        );
    }

    const response = unwrapVrchatGroupResponse(
        await commands.appVrchatGroupJoinRequestsGet({
            groupId: normalizedGroupId,
            n,
            offset,
            blocked: Boolean(blocked)
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/requests`
    );
    return responseRows<GroupModerationRow>(response.json, 'requests');
}

export async function getAllGroupJoinRequests({
    groupId,
    blocked = false
}: Omit<GroupJoinRequestInput, 'n' | 'offset'>) {
    return collectPages(({ n, offset }) =>
        getGroupJoinRequests({ groupId, n, offset, blocked })
    );
}

export async function blockGroup({ groupId }: GroupIdInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.blockGroup requires a group id.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupBlock({
            groupId: normalizedGroupId
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/block`
    );
}

export async function unblockGroup({ groupId, userId }: GroupUserInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    const normalizedUserId = normalizeEntityId(userId);
    if (!normalizedGroupId || !normalizedUserId) {
        throw new Error(
            'GroupProfileRepository.unblockGroup requires group and user ids.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupUnblock({
            groupId: normalizedGroupId,
            userId: normalizedUserId
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/bans/${encodeURIComponent(normalizedUserId)}`
    );
}
