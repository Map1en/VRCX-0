import { getEventId } from '@/components/hosts/tools-dialogs/toolsDialogUtils';
import type {
    GroupAnnouncementRecord,
    GroupProfileRecord
} from '@/domain/entities/profileEntities';
import { formatDateFilter } from '@/lib/dateTime';
import type { GroupCalendarEventRecord } from '@/repositories/vrchatToolsRepository';
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

export function firstText(...values: unknown[]) {
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

export function groupRowsEmptyTitle(kind: string) {
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

export function getGroupRowRawImage(row: unknown) {
    if (!isRecord(row)) {
        return '';
    }
    const versions = Array.isArray(row.versions) ? row.versions : [];
    const latestVersion = isRecord(versions[versions.length - 1])
        ? versions[versions.length - 1]
        : {};
    const latestFile = isRecord(latestVersion.file) ? latestVersion.file : {};
    return firstText(
        latestFile.url,
        row.imageUrl ||
            row.thumbnailImageUrl ||
            row.iconUrl ||
            row.fileUrl ||
            row.url
    );
}

export function getGroupRoleNameMap(group: unknown) {
    const map = new Map<string, string>();
    const source = isRecord(group) ? group : {};
    const roles = Array.isArray(source.roles) ? source.roles : [];
    for (const roleValue of roles) {
        const role = isRecord(roleValue) ? roleValue : {};
        const roleId = firstText(role.id);
        if (roleId) {
            map.set(roleId, firstText(role.name) || 'Role');
        }
    }
    return map;
}

export function announcementRoleNames(
    announcement: GroupAnnouncementRecord | undefined,
    group: GroupProfileRecord
) {
    const rolesById = getGroupRoleNameMap(group);
    return Array.isArray(announcement?.roleIds)
        ? announcement.roleIds
              .map((roleId) => rolesById.get(roleId) || roleId)
              .filter(Boolean)
        : [];
}

export function announcementTimestamp(value: string | null | undefined) {
    return value ? formatDateFilter(value, 'long') : '—';
}

export function announcementUserLabel(
    announcement: GroupAnnouncementRecord | undefined,
    key: 'author' | 'editor'
) {
    return firstText(
        announcement?.[`${key}DisplayName`],
        announcement?.[`${key}Name`],
        announcement?.[`${key}Username`]
    );
}

export function announcementUserId(
    announcement: GroupAnnouncementRecord | undefined,
    key: 'author' | 'editor'
) {
    const nested = isRecord(announcement?.[key]) ? announcement[key] : {};
    return firstText(
        announcement?.[`${key}Id`],
        announcement?.[`${key}UserId`],
        nested.id,
        nested.userId
    );
}

export function getGroupRowLabel(row: unknown): string {
    if (typeof row === 'string') {
        return row;
    }
    if (!isRecord(row)) {
        return '—';
    }
    const user = isRecord(row.user) ? row.user : {};
    const label =
        firstText(
            row.title,
            user.displayName,
            row.displayName,
            row.name,
            row.imageUrl
        ) || '—';
    const galleryName = firstText(row.$galleryName);
    return galleryName ? `${galleryName}: ${label}` : label;
}

export function getGroupRowImage(row: unknown, kind: string): string {
    if (!isRecord(row)) {
        return '';
    }
    if (kind === 'members') {
        return userImage(isRecord(row.user) ? row.user : row, true, '64');
    }
    return convertFileUrlToImageUrl(getGroupRowRawImage(row), 256);
}

export function hasGroupPermission(group: unknown, permission: string) {
    const source = isRecord(group) ? group : {};
    const myMember = isRecord(source.myMember) ? source.myMember : {};
    const direct = Array.isArray(myMember.permissions)
        ? myMember.permissions
        : [];
    if (direct.includes('*') || direct.includes(permission)) {
        return true;
    }
    const roleIds = Array.isArray(myMember.roleIds) ? myMember.roleIds : [];
    const roles = Array.isArray(source.roles)
        ? source.roles.filter(isRecord)
        : [];
    return roles
        .filter((role) => roleIds.includes(role.id))
        .some(
            (role) =>
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
        'group-bans-manage',
        'group-roles-assign'
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

export function hasGroupModerationPermission(group: unknown) {
    return Object.values(GROUP_MODERATION_TAB_PERMISSIONS).some((permissions) =>
        permissions.some((permission) => hasGroupPermission(group, permission))
    );
}

export function hasAnyGroupModerationPermission(
    permissions: readonly string[] | null | undefined
): boolean {
    const list = Array.isArray(permissions) ? permissions : [];
    if (list.includes('*')) {
        return true;
    }
    const moderationPermissions = Object.values(
        GROUP_MODERATION_TAB_PERMISSIONS
    ).flat();
    return moderationPermissions.some((permission) =>
        list.includes(permission)
    );
}

export function resolveGroupDialogTab(
    tabs: { value: string }[],
    preferred: string,
    fallback = 'overview'
) {
    return tabs.some((tab) => tab.value === preferred) ? preferred : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function eventRows(value: unknown): GroupCalendarEventRecord[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function extractGroupEventRows(
    value: unknown
): GroupCalendarEventRecord[] {
    if (Array.isArray(value)) {
        return eventRows(value);
    }
    if (!isRecord(value)) {
        return [];
    }
    if (Array.isArray(value.results)) {
        return eventRows(value.results);
    }
    const json = isRecord(value.json) ? value.json : null;
    if (Array.isArray(json?.results)) {
        return eventRows(json.results);
    }
    return [];
}

export function followingEventIds(value: unknown) {
    return new Set(
        extractGroupEventRows(value).map(getEventId).filter(Boolean)
    );
}

export function normalizeGroupEvent(
    event: GroupCalendarEventRecord,
    fallbackGroupId = '',
    {
        followingIds = null,
        isFollowing = null
    }: {
        followingIds?: Set<string> | null;
        isFollowing?: boolean | null;
    } = {}
): GroupCalendarEventRecord {
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
