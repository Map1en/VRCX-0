import { getEventId } from '@/components/hosts/tools-dialogs/toolsDialogUtils';
import { formatDateFilter } from '@/lib/dateTime';
import {
    convertFileUrlToImageUrl,
    userImage
} from '@/services/entityMediaService';
import { replaceBioSymbols } from '@/shared/utils/string';

export function firstArray<T>(...values: (T[] | null | undefined)[]): T[];
export function firstArray(...values: unknown[]) {
    const result = values.find(Array.isArray);
    return Array.isArray(result) ? result : [];
}

export function firstText(...values: any[]) {
    for (const value of values) {
        if (value === null || value === undefined) {
            continue;
        }
        const text = String(value).trim();
        if (text) {
            return text;
        }
    }
    return '';
}

export function groupRowsEmptyTitle(kind: any) {
    if (kind === 'posts') {
        return 'No posts';
    }
    if (kind === 'members') {
        return 'No members';
    }
    if (kind === 'photos') {
        return 'No photos';
    }
    return 'No rows';
}

export function getGroupRowRawImage(row: any) {
    if (!row || typeof row !== 'object') {
        return '';
    }
    const versions = Array.isArray(row.versions) ? row.versions : [];
    const latestVersion = versions[versions.length - 1];
    return (
        latestVersion?.file?.url ||
        row.imageUrl ||
        row.thumbnailImageUrl ||
        row.iconUrl ||
        row.fileUrl ||
        row.url ||
        ''
    );
}

export function getGroupRoleNameMap(group: any) {
    const map = new Map();
    for (const role of Array.isArray(group?.roles) ? group.roles : []) {
        if (role?.id) {
            map.set(role.id, role.name || 'Role');
        }
    }
    return map;
}

export function announcementRoleNames(announcement: any, group: any) {
    const rolesById = getGroupRoleNameMap(group);
    return Array.isArray(announcement?.roleIds)
        ? announcement.roleIds
              .map((roleId: any) => rolesById.get(roleId) || roleId)
              .filter(Boolean)
        : [];
}

export function announcementTimestamp(value: any) {
    return value ? formatDateFilter(value, 'long') : '—';
}

export function announcementUserLabel(announcement: any, key: any) {
    return firstText(
        announcement?.[`${key}DisplayName`],
        announcement?.[`${key}Name`],
        announcement?.[`${key}Username`]
    );
}

export function announcementUserId(announcement: any, key: any) {
    return firstText(
        announcement?.[`${key}Id`],
        announcement?.[`${key}UserId`],
        announcement?.[key]?.id,
        announcement?.[key]?.userId
    );
}

export function getGroupRowLabel(row: any) {
    if (typeof row === 'string') {
        return row;
    }
    if (!row || typeof row !== 'object') {
        return '—';
    }
    const label =
        row.title ||
        row.user?.displayName ||
        row.displayName ||
        row.name ||
        row.imageUrl ||
        '—';
    return row.$galleryName ? `${row.$galleryName}: ${label}` : label;
}

export function getGroupRowImage(row: any, kind: any) {
    if (!row || typeof row !== 'object') {
        return '';
    }
    if (kind === 'members') {
        return userImage(row.user || row, true, '64');
    }
    return convertFileUrlToImageUrl(getGroupRowRawImage(row), 256);
}

export function hasGroupPermission(group: any, permission: any) {
    const direct = Array.isArray(group?.myMember?.permissions)
        ? group.myMember.permissions
        : [];
    if (direct.includes('*') || direct.includes(permission)) {
        return true;
    }
    const roleIds = Array.isArray(group?.myMember?.roleIds)
        ? group.myMember.roleIds
        : [];
    return (Array.isArray(group?.roles) ? group.roles : [])
        .filter((role: any) => roleIds.includes(role?.id))
        .some(
            (role: any) =>
                Array.isArray(role.permissions) &&
                (role.permissions.includes('*') ||
                    role.permissions.includes(permission))
        );
}

export type GroupModerationTabValue =
    | 'members'
    | 'bans'
    | 'invites'
    | 'requests'
    | 'blocked'
    | 'logs';

export const GROUP_MODERATION_TAB_PERMISSIONS: Record<
    GroupModerationTabValue,
    readonly string[]
> = Object.freeze({
    members: [
        'group-members-manage',
        'group-members-remove',
        'group-bans-manage'
    ],
    bans: ['group-bans-manage'],
    invites: ['group-invites-manage'],
    requests: ['group-members-manage'],
    blocked: ['group-bans-manage'],
    logs: ['group-audit-view']
});

export function groupModerationTabPermissions(tab: string): readonly string[] {
    switch (tab) {
        case 'members':
            return GROUP_MODERATION_TAB_PERMISSIONS.members;
        case 'bans':
            return GROUP_MODERATION_TAB_PERMISSIONS.bans;
        case 'invites':
            return GROUP_MODERATION_TAB_PERMISSIONS.invites;
        case 'requests':
            return GROUP_MODERATION_TAB_PERMISSIONS.requests;
        case 'blocked':
            return GROUP_MODERATION_TAB_PERMISSIONS.blocked;
        case 'logs':
            return GROUP_MODERATION_TAB_PERMISSIONS.logs;
        default:
            return [];
    }
}

export function hasGroupModerationPermission(group: any) {
    return Object.values(GROUP_MODERATION_TAB_PERMISSIONS).some((permissions) =>
        permissions.some((permission) => hasGroupPermission(group, permission))
    );
}

export function resolveGroupDialogTab(
    tabs: any,
    preferred: any,
    fallback: any = 'overview'
) {
    return tabs.some((tab: any) => tab.value === preferred)
        ? preferred
        : fallback;
}

export function extractGroupEventRows(value: any) {
    if (Array.isArray(value)) {
        return value;
    }
    if (Array.isArray(value?.results)) {
        return value.results;
    }
    if (Array.isArray(value?.json?.results)) {
        return value.json.results;
    }
    return [];
}

export function followingEventIds(value: any) {
    return new Set(
        extractGroupEventRows(value).map(getEventId).filter(Boolean)
    );
}

export function normalizeGroupEvent(
    event: any,
    fallbackGroupId: any = '',
    { followingIds = null, isFollowing = null }: any = {}
) {
    const eventId = getEventId(event);
    const resolvedFollowing =
        isFollowing ??
        (followingIds?.has(eventId) ? true : event?.userInterest?.isFollowing);

    return {
        ...event,
        groupId: event?.groupId || fallbackGroupId,
        ownerId: event?.ownerId || event?.groupId || fallbackGroupId,
        userInterest: {
            ...(event?.userInterest || {}),
            isFollowing: Boolean(resolvedFollowing)
        },
        title: replaceBioSymbols(event?.title || ''),
        description: replaceBioSymbols(event?.description || '')
    };
}
