import { compareByMemberCount, compareByName } from '@/shared/utils/compare.js';

import { firstArray, normalizedText } from './userDialogRows.js';

function firstText(...values) {
    for (const value of values) {
        const normalized = normalizedText(value);
        if (normalized) {
            return normalized;
        }
    }
    return '';
}

export function groupIdForRow(group) {
    const nestedGroup =
        group?.group && typeof group.group === 'object' ? group.group : {};
    const explicitGroupId = firstText(
        group?.groupId,
        group?.group_id,
        nestedGroup.id,
        nestedGroup.groupId,
        nestedGroup.group_id
    );
    if (explicitGroupId) {
        return explicitGroupId;
    }
    const directId = firstText(group?.id);
    return directId.startsWith('grp_') ? directId : '';
}

function compareGroupRowsByInGameOrder(groupOrder = []) {
    const orderMap = new Map(
        (groupOrder || []).map((groupId, index) => [groupId, index])
    );
    return (left, right) => {
        const leftOrder = orderMap.has(groupIdForRow(left))
            ? orderMap.get(groupIdForRow(left))
            : Number.MAX_SAFE_INTEGER;
        const rightOrder = orderMap.has(groupIdForRow(right))
            ? orderMap.get(groupIdForRow(right))
            : Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }
        return compareByName(left, right);
    };
}

export function sortUserGroupRows(rows, sortBy, groupOrder = []) {
    const comparers = {
        alphabetical: compareByName,
        members: compareByMemberCount,
        inGame: compareGroupRowsByInGameOrder(groupOrder)
    };
    const comparer = comparers[sortBy] || comparers.alphabetical;
    return [...rows].sort((left, right) => {
        const result = comparer(left, right);
        return Number.isFinite(result) && result !== 0
            ? result
            : compareByName(left, right);
    });
}

export function groupMemberVisibility(group) {
    return (
        normalizedText(
            group?.memberVisibility ||
                group?.member_visibility ||
                group?.myMember?.visibility ||
                group?.my_member?.visibility ||
                'visible'
        ) || 'visible'
    );
}

function normalizedBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    const normalized = normalizedText(value).toLowerCase();
    if (
        !normalized ||
        normalized === 'false' ||
        normalized === '0' ||
        normalized === 'no'
    ) {
        return false;
    }
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
    }
    return Boolean(value);
}

function isMutualGroup(group) {
    const membership =
        group?.membership && typeof group.membership === 'object'
            ? group.membership
            : {};
    const myMember = group?.myMember || group?.my_member || {};
    return normalizedBoolean(
        group?.mutualGroup ??
            group?.mutual_group ??
            group?.isMutualGroup ??
            group?.is_mutual_group ??
            group?.isMutual ??
            group?.is_mutual ??
            group?.mutualMembership ??
            group?.mutual_membership ??
            group?.sharedGroup ??
            group?.shared_group ??
            group?.isSharedGroup ??
            group?.is_shared_group ??
            membership.mutual ??
            membership.isMutual ??
            membership.is_mutual ??
            myMember.mutual ??
            myMember.isMutual ??
            myMember.is_mutual ??
            group?.mutual ??
            group?.shared
    );
}

function groupOwnerId(group) {
    const owner = group?.owner;
    const creator = group?.creator || group?.createdBy || group?.created_by;
    return firstText(
        group?.ownerId,
        group?.owner_id,
        group?.ownerUserId,
        group?.owner_user_id,
        group?.ownerUserID,
        group?.owner_userID,
        group?.creatorId,
        group?.creator_id,
        group?.creatorUserId,
        group?.creator_user_id,
        typeof owner === 'string' ? owner : '',
        owner?.id,
        owner?.userId,
        owner?.user_id,
        owner?.userID,
        typeof creator === 'string' ? creator : '',
        creator?.id,
        creator?.userId,
        creator?.user_id,
        creator?.userID
    );
}

function groupMemberUserId(group) {
    const myMember = group?.myMember || group?.my_member || {};
    return firstText(
        group?.userId,
        group?.user_id,
        group?.memberUserId,
        group?.member_user_id,
        myMember.userId,
        myMember.user_id,
        myMember.userID
    );
}

function topLevelMembershipStatus(group) {
    return firstText(
        group?.membershipStatus,
        group?.membership_status,
        group?.memberStatus,
        group?.member_status,
        group?.membership?.status,
        group?.membership?.role,
        group?.member?.role,
        group?.myMember?.role,
        group?.my_member?.role,
        group?.roleName,
        group?.role_name,
        group?.role,
        group?.relationship
    ).toLowerCase();
}

function roleNameContainsOwner(value) {
    if (!value) {
        return false;
    }
    if (Array.isArray(value)) {
        return value.some(roleNameContainsOwner);
    }
    if (typeof value === 'object') {
        return roleNameContainsOwner(
            value.name ||
                value.displayName ||
                value.roleName ||
                value.role_name ||
                value.id
        );
    }
    return normalizedText(value).toLowerCase().includes('owner');
}

function isOwnedGroupForUser(group, userId) {
    const normalizedUserId = normalizedText(userId);
    if (!normalizedUserId) {
        return false;
    }

    const ownerId = groupOwnerId(group);
    if (ownerId && ownerId === normalizedUserId) {
        return true;
    }

    const memberUserId = groupMemberUserId(group);
    const status = topLevelMembershipStatus(group);
    if (
        (memberUserId === normalizedUserId || !memberUserId) &&
        (status === 'owner' || status === 'owned' || status.includes('owner'))
    ) {
        return true;
    }

    return (
        (memberUserId === normalizedUserId || !memberUserId) &&
        (normalizedBoolean(group?.isOwner ?? group?.is_owner ?? group?.owned) ||
            roleNameContainsOwner(group?.membership?.roles) ||
            roleNameContainsOwner(group?.member?.roles) ||
            roleNameContainsOwner(group?.userRoles) ||
            roleNameContainsOwner(group?.user_roles) ||
            roleNameContainsOwner(group?.userRoleNames) ||
            roleNameContainsOwner(group?.user_role_names) ||
            roleNameContainsOwner(group?.myMember?.roles) ||
            roleNameContainsOwner(group?.my_member?.roles))
    );
}

function isMutualGroupForUser(group, isCurrentUser) {
    if (isCurrentUser) {
        return false;
    }
    return isMutualGroup(group);
}

function normalizeUserGroupMembershipRow(group) {
    if (!group || typeof group !== 'object') {
        return group;
    }

    const nestedGroup =
        group.group && typeof group.group === 'object' ? group.group : {};
    const groupId = groupIdForRow(group);
    const currentId = normalizedText(group.id);
    const memberId = normalizedText(
        group.$memberId ||
            group.memberId ||
            group.member_id ||
            (currentId && currentId !== groupId ? currentId : '')
    );
    const myMember = group.myMember || group.my_member || {};
    const mergedGroup = { ...nestedGroup, ...group };
    const ownerId = groupOwnerId(mergedGroup);

    return {
        ...nestedGroup,
        ...group,
        ...(memberId ? { $memberId: memberId } : {}),
        id: groupId,
        groupId,
        ownerId,
        memberVisibility:
            group.memberVisibility ||
            group.member_visibility ||
            myMember.visibility ||
            group.visibility ||
            'visible',
        isRepresenting: Boolean(
            group.isRepresenting ||
            group.is_representing ||
            myMember.isRepresenting ||
            myMember.is_representing
        ),
        mutualGroup: isMutualGroup(mergedGroup),
        myMember: {
            ...myMember,
            ...(memberId ? { id: memberId } : {}),
            groupId,
            visibility:
                myMember.visibility ||
                group.memberVisibility ||
                group.member_visibility ||
                group.visibility ||
                'visible',
            isRepresenting: Boolean(
                myMember.isRepresenting ||
                myMember.is_representing ||
                group.isRepresenting ||
                group.is_representing
            )
        }
    };
}

export function normalizeUserGroupMembershipRows(groups) {
    return firstArray(groups).map(normalizeUserGroupMembershipRow);
}

export function splitUserGroups(groups, userId, isCurrentUser) {
    const ownGroups = [];
    const mutualGroups = [];
    const remainingGroups = [];

    for (const group of groups || []) {
        if (isOwnedGroupForUser(group, userId)) {
            ownGroups.push(group);
            continue;
        }
        if (isMutualGroupForUser(group, isCurrentUser)) {
            mutualGroups.push(group);
            continue;
        }
        remainingGroups.push(group);
    }

    return { ownGroups, mutualGroups, remainingGroups };
}
