import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';
import { compareByMemberCount, compareByName } from '@/shared/utils/compare';

import { firstArray, normalizedText } from './userDialogRows';

type UserGroupRow = Record<string, unknown> & {
    group?: Record<string, unknown>;
    id?: string;
    memberCount?: number;
    name?: string;
};

type UserGroupSort = 'alphabetical' | 'members' | 'inGame';

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value))
        : {};
}

function firstText(...values: unknown[]) {
    for (const value of values) {
        const normalized = normalizedText(value);
        if (normalized) {
            return normalized;
        }
    }
    return '';
}

export function groupIdForRow(source: unknown) {
    const group = record(source);
    const nestedGroup = record(group.group);
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
    return hasGroupIdPrefix(directId) ? directId : '';
}

function compareGroupRowsByInGameOrder(groupOrder: string[] = []) {
    const orderMap = new Map(
        groupOrder.map((groupId, index) => [groupId, index])
    );
    return (left: UserGroupRow, right: UserGroupRow) => {
        const leftOrder = orderMap.has(groupIdForRow(left))
            ? (orderMap.get(groupIdForRow(left)) ?? Number.MAX_SAFE_INTEGER)
            : Number.MAX_SAFE_INTEGER;
        const rightOrder = orderMap.has(groupIdForRow(right))
            ? (orderMap.get(groupIdForRow(right)) ?? Number.MAX_SAFE_INTEGER)
            : Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }
        return compareByName(left, right);
    };
}

export function sortUserGroupRows(
    rows: UserGroupRow[],
    sortBy: UserGroupSort | string,
    groupOrder: string[] = []
) {
    const comparers: Record<
        UserGroupSort,
        (left: UserGroupRow, right: UserGroupRow) => number
    > = {
        alphabetical: compareByName,
        members: compareByMemberCount,
        inGame: compareGroupRowsByInGameOrder(groupOrder)
    };
    const comparer =
        sortBy === 'members' || sortBy === 'inGame'
            ? comparers[sortBy]
            : comparers.alphabetical;
    return [...rows].sort((left, right) => {
        const result = comparer(left, right);
        return Number.isFinite(result) && result !== 0
            ? result
            : compareByName(left, right);
    });
}

export function groupMemberVisibility(source: unknown) {
    const group = record(source);
    const myMember = record(group.myMember);
    const legacyMyMember = record(group.my_member);
    return (
        normalizedText(
            group.memberVisibility ||
                group.member_visibility ||
                myMember.visibility ||
                legacyMyMember.visibility ||
                'visible'
        ) || 'visible'
    );
}

function normalizedBoolean(value: unknown) {
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

function isMutualGroup(source: unknown) {
    const group = record(source);
    const membership = record(group.membership);
    const myMember = record(group.myMember || group.my_member);
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

function groupOwnerId(source: unknown) {
    const group = record(source);
    const owner = group.owner;
    const ownerRecord = record(owner);
    const creator = group.creator || group.createdBy || group.created_by;
    const creatorRecord = record(creator);
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
        ownerRecord.id,
        ownerRecord.userId,
        ownerRecord.user_id,
        ownerRecord.userID,
        typeof creator === 'string' ? creator : '',
        creatorRecord.id,
        creatorRecord.userId,
        creatorRecord.user_id,
        creatorRecord.userID
    );
}

function groupMemberUserId(source: unknown) {
    const group = record(source);
    const myMember = record(group.myMember || group.my_member);
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

function topLevelMembershipStatus(source: unknown) {
    const group = record(source);
    const membership = record(group.membership);
    const member = record(group.member);
    const myMember = record(group.myMember);
    const legacyMyMember = record(group.my_member);
    return firstText(
        group?.membershipStatus,
        group?.membership_status,
        group?.memberStatus,
        group?.member_status,
        membership.status,
        membership.role,
        member.role,
        myMember.role,
        legacyMyMember.role,
        group?.roleName,
        group?.role_name,
        group?.role,
        group?.relationship
    ).toLowerCase();
}

function roleNameContainsOwner(value: unknown): boolean {
    if (!value) {
        return false;
    }
    if (Array.isArray(value)) {
        return value.some(roleNameContainsOwner);
    }
    if (typeof value === 'object') {
        const role = record(value);
        return roleNameContainsOwner(
            role.name ||
                role.displayName ||
                role.roleName ||
                role.role_name ||
                role.id
        );
    }
    return normalizedText(value).toLowerCase().includes('owner');
}

function isOwnedGroupForUser(source: unknown, userId: unknown) {
    const group = record(source);
    const membership = record(group.membership);
    const member = record(group.member);
    const myMember = record(group.myMember);
    const legacyMyMember = record(group.my_member);
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
            roleNameContainsOwner(membership.roles) ||
            roleNameContainsOwner(member.roles) ||
            roleNameContainsOwner(group?.userRoles) ||
            roleNameContainsOwner(group?.user_roles) ||
            roleNameContainsOwner(group?.userRoleNames) ||
            roleNameContainsOwner(group?.user_role_names) ||
            roleNameContainsOwner(myMember.roles) ||
            roleNameContainsOwner(legacyMyMember.roles))
    );
}

function isMutualGroupForUser(group: unknown, isCurrentUser: boolean) {
    if (isCurrentUser) {
        return false;
    }
    return isMutualGroup(group);
}

function normalizeUserGroupMembershipRow(source: unknown): UserGroupRow {
    const group = record(source);
    const nestedGroup = record(group.group);
    const groupId = groupIdForRow(group);
    const currentId = normalizedText(group.id);
    const memberId = normalizedText(
        group.$memberId ||
            group.memberId ||
            group.member_id ||
            (currentId && currentId !== groupId ? currentId : '')
    );
    const myMember = record(group.myMember || group.my_member);
    const mergedGroup: UserGroupRow = { ...nestedGroup, ...group };
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

export function normalizeUserGroupMembershipRows(groups: unknown) {
    return firstArray(groups).map(normalizeUserGroupMembershipRow);
}

export function splitUserGroups(
    groups: UserGroupRow[],
    userId: unknown,
    isCurrentUser: boolean
) {
    const ownGroups: UserGroupRow[] = [];
    const mutualGroups: UserGroupRow[] = [];
    const remainingGroups: UserGroupRow[] = [];

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
