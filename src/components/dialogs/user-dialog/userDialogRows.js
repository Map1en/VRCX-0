import { formatDateFilter, timeToText } from '@/lib/dateTime.js';
import {
    compareByDisplayName,
    compareByFriendOrder,
    compareByLastActiveRef,
    compareByMemberCount,
    compareByName
} from '@/shared/utils/compare.js';

const DASH = '\u2014';

export function firstArray(...values) {
    return values.find((value) => Array.isArray(value)) || [];
}

export function normalizedText(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function isGroupId(value) {
    return normalizedText(value).startsWith('grp_');
}

export function firstNonGroupIdText(...values) {
    const fallback = [];
    for (const value of values) {
        const text = normalizedText(value);
        if (!text) {
            continue;
        }
        if (!isGroupId(text)) {
            return text;
        }
        fallback.push(text);
    }
    return fallback[0] || '';
}

export function isOfflineLikeValue(value) {
    const normalized = normalizedText(value).toLowerCase();
    return (
        !normalized ||
        normalized === 'offline' ||
        normalized === 'private' ||
        normalized === 'traveling'
    );
}

export function summarizeEntityRow(row, fallback = DASH) {
    if (typeof row === 'string') {
        return /^(usr|wrld|wld|avtr|grp)_/i.test(row.trim()) ? fallback : row;
    }
    if (!row || typeof row !== 'object') {
        return fallback;
    }
    const label =
        row.displayName ||
        row.name ||
        row.worldName ||
        row.groupName ||
        row.avatarName ||
        fallback;
    return row.$favoriteGroup ? `${row.$favoriteGroup}: ${label}` : label;
}

export function groupDisplayName(row, fallback = 'Group') {
    if (!row || typeof row !== 'object') {
        return fallback;
    }
    return firstNonGroupIdText(
        row.displayName,
        row.display_name,
        row.name,
        row.groupName,
        row.group_name,
        row.shortCode,
        row.group?.displayName,
        row.group?.display_name,
        row.group?.name,
        fallback
    );
}

export function filterRows(rows, query) {
    const normalizedQuery = String(query || '')
        .trim()
        .toLowerCase();
    if (!normalizedQuery) {
        return rows;
    }
    return rows.filter((row) =>
        [
            row?.displayName,
            row?.name,
            row?.worldName,
            row?.groupName,
            row?.avatarName,
            row?.authorName,
            row?.description,
            row?.id,
            row?.$favoriteGroup
        ].some((value) =>
            String(value || '')
                .toLowerCase()
                .includes(normalizedQuery)
        )
    );
}

export function sortAvatarRows(rows, sortBy) {
    const nextRows = [...rows];
    if (sortBy === 'update') {
        return nextRows.sort((left, right) =>
            String(right.updated_at || right.updatedAt || '').localeCompare(
                String(left.updated_at || left.updatedAt || '')
            )
        );
    }
    if (sortBy === 'createdAt') {
        return nextRows.sort((left, right) =>
            String(right.created_at || right.createdAt || '').localeCompare(
                String(left.created_at || left.createdAt || '')
            )
        );
    }
    return nextRows.sort((left, right) =>
        String(left.name || '').localeCompare(String(right.name || ''))
    );
}

export function sortMutualFriendRows(rows, sortBy) {
    const comparers = {
        alphabetical: compareByDisplayName,
        lastActive: compareByLastActiveRef,
        friendOrder: compareByFriendOrder
    };
    const comparer = comparers[sortBy] || comparers.alphabetical;
    return [...rows].sort((left, right) => {
        const result = comparer(left, right);
        return Number.isFinite(result)
            ? result
            : compareByDisplayName(left, right);
    });
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

export function hydrateMutualFriendRows(rows, friendsById) {
    return rows.map((row) => {
        const userId = normalizedText(row?.id || row?.userId);
        const cachedFriend = userId ? friendsById?.[userId] : null;
        if (!cachedFriend) {
            return row;
        }
        const friendNumber =
            row?.$friendNumber ??
            row?.friendNumber ??
            cachedFriend.$friendNumber ??
            cachedFriend.friendNumber;
        return {
            ...cachedFriend,
            ...row,
            ...(friendNumber !== undefined
                ? { $friendNumber: friendNumber, friendNumber }
                : {})
        };
    });
}

export function worldOccupantSubtitle(row) {
    const occupants = Number(row?.occupants ?? row?.userCount ?? 0) || 0;
    return occupants > 0 ? `(${occupants})` : '';
}

export function normalizeLanguageRows(rows, tags = []) {
    const normalizedRows = firstArray(rows)
        .map((entry) => {
            if (typeof entry === 'string') {
                return { key: entry, value: entry };
            }
            return {
                key: entry?.key || entry?.id || entry?.value || '',
                value:
                    entry?.value ||
                    entry?.label ||
                    entry?.name ||
                    entry?.key ||
                    ''
            };
        })
        .filter((entry) => entry.key || entry.value);
    const seen = new Set(
        normalizedRows.map((entry) =>
            String(entry.key || entry.value).toLowerCase()
        )
    );
    for (const tag of firstArray(tags)) {
        const normalizedTag = String(tag || '')
            .trim()
            .toLowerCase();
        if (!normalizedTag.startsWith('language_')) {
            continue;
        }
        const key = normalizedTag.replace(/^language_/, '');
        if (!key || seen.has(key)) {
            continue;
        }
        normalizedRows.push({ key, value: key });
        seen.add(key);
    }
    return normalizedRows;
}

export function formatDate(value) {
    if (!value) {
        return DASH;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

export function formatStatsDate(value) {
    return value ? formatDateFilter(value, 'long') : DASH;
}

export function formatStatsDuration(value) {
    const duration = Number(value) || 0;
    return duration > 0 ? timeToText(duration) : DASH;
}

export function normalizePreviousDisplayNames(value) {
    const rows =
        value instanceof Map
            ? Array.from(value, ([displayName, updated_at]) => ({
                  displayName,
                  updated_at
              }))
            : firstArray(value);

    return rows
        .map((entry) => {
            if (typeof entry === 'string') {
                return { displayName: entry, updated_at: '' };
            }
            return {
                displayName: normalizedText(entry?.displayName || entry?.name),
                updated_at:
                    entry?.updated_at || entry?.updatedAt || entry?.date || ''
            };
        })
        .filter((entry) => entry.displayName);
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

function firstText(...values) {
    for (const value of values) {
        const normalized = normalizedText(value);
        if (normalized) {
            return normalized;
        }
    }
    return '';
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

export function userIdForRow(row) {
    return normalizedText(row?.id || row?.userId || row?.targetUserId);
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

export function formatCountText(count, max) {
    const normalizedMax = Number(max) || 0;
    return normalizedMax ? `${count}/${normalizedMax}` : String(count);
}

export function resolveStatusStateText(profile) {
    const state = normalizedText(profile?.state);
    const status = normalizedText(profile?.status);
    if (state && status && state.toLowerCase() !== status.toLowerCase()) {
        return `${state} / ${status}`;
    }
    return state || status || '';
}

export function userTravelingTimestamp(row) {
    if (normalizedText(row?.location).toLowerCase() !== 'traveling') {
        return 0;
    }
    const value =
        row?.$travelingToTime || row?.travelingToTime || row?.traveling_to_time;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

export function userRowSubtitle(row, nowMs) {
    if (userTravelingTimestamp(row)) {
        return '';
    }
    const explicit = row?.$subtitle || row?.subtitle;
    if (explicit) {
        return explicit;
    }
    const joinedAt = normalizedText(
        row?.$location_at ||
            row?.locationAt ||
            row?.joinedAt ||
            row?.created_at ||
            row?.createdAt
    );
    const timestamp = joinedAt ? Date.parse(joinedAt) : Number.NaN;
    const normalizedNowMs = Number(nowMs);
    if (!Number.isNaN(timestamp) && Number.isFinite(normalizedNowMs)) {
        return timeToText(normalizedNowMs - timestamp);
    }
    return (
        row?.statusDescription ||
        row?.status ||
        row?.stateBucket ||
        row?.state ||
        ''
    );
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

export function resolveTabValue(tabs, preferred, fallback = 'info') {
    return tabs.some((tab) => tab.value === preferred) ? preferred : fallback;
}
