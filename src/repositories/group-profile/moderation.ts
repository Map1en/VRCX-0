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
    normalizeEntityId,
    normalizeString,
    responseRows,
    unwrapVrchatGroupResponse
} from './shared';

export async function kickGroupMember({
    groupId,
    userId,
    endpoint = ''
}: GroupUserInput) {
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
            userId: normalizedUserId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/members/${encodeURIComponent(normalizedUserId)}`
    );
}

export async function banGroupMember({
    groupId,
    userId,
    endpoint = ''
}: GroupUserInput) {
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
            userId: normalizedUserId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/bans`
    );
}

export async function unbanGroupMember({
    groupId,
    userId,
    endpoint = ''
}: GroupUserInput) {
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
            userId: normalizedUserId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/bans/${encodeURIComponent(normalizedUserId)}`
    );
}

export async function deleteSentGroupInvite({
    groupId,
    userId,
    endpoint = ''
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
            userId: normalizedUserId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/invites/${encodeURIComponent(normalizedUserId)}`
    );
}

export async function respondGroupJoinRequest({
    groupId,
    userId,
    action,
    block = false,
    endpoint = ''
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
            block: Boolean(block),
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/requests/${encodeURIComponent(normalizedUserId)}`
    );
}

export async function deleteBlockedGroupRequest({
    groupId,
    userId,
    endpoint = ''
}: GroupUserInput) {
    return kickGroupMember({ groupId, userId, endpoint });
}

export async function getGroupBans({
    groupId,
    endpoint = '',
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
            offset,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/bans`
    );
    return responseRows<GroupModerationRow>(response.json, 'bans');
}

export async function getAllGroupBans({
    groupId,
    endpoint = ''
}: GroupIdInput) {
    return collectPages(({ n, offset }) =>
        getGroupBans({ groupId, endpoint, n, offset })
    );
}

export async function getGroupInvites({
    groupId,
    endpoint = '',
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
            offset,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/invites`
    );
    return responseRows<GroupModerationRow>(response.json, 'invites');
}

export async function getAllGroupInvites({
    groupId,
    endpoint = ''
}: GroupIdInput) {
    return collectPages(({ n, offset }) =>
        getGroupInvites({ groupId, endpoint, n, offset })
    );
}

export async function getGroupJoinRequests({
    groupId,
    endpoint = '',
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
            blocked: Boolean(blocked),
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/requests`
    );
    return responseRows<GroupModerationRow>(response.json, 'requests');
}

export async function getAllGroupJoinRequests({
    groupId,
    endpoint = '',
    blocked = false
}: Omit<GroupJoinRequestInput, 'n' | 'offset'>) {
    return collectPages(({ n, offset }) =>
        getGroupJoinRequests({ groupId, endpoint, n, offset, blocked })
    );
}

export async function blockGroup({ groupId, endpoint = '' }: GroupIdInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.blockGroup requires a group id.'
        );
    }

    return unwrapVrchatGroupResponse(
        await commands.appVrchatGroupBlock({
            groupId: normalizedGroupId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/block`
    );
}

export async function unblockGroup({
    groupId,
    userId,
    endpoint = ''
}: GroupUserInput) {
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
            userId: normalizedUserId,
            endpoint
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/bans/${encodeURIComponent(normalizedUserId)}`
    );
}
