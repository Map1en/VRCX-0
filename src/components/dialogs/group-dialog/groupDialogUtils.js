import { formatDateFilter } from '@/lib/dateTime.js';
import {
    convertFileUrlToImageUrl,
    userImage
} from '@/lib/entityMedia.js';

export function firstArray(...values) {
    return values.find((value) => Array.isArray(value)) || [];
}

export function firstText(...values) {
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

export function groupRowsEmptyTitle(kind) {
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

export function getGroupRowRawImage(row) {
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

export function getGroupRoleNameMap(group) {
    const map = new Map();
    for (const role of Array.isArray(group?.roles) ? group.roles : []) {
        if (role?.id) {
            map.set(role.id, role.name || 'Role');
        }
    }
    return map;
}

export function announcementRoleNames(announcement, group) {
    const rolesById = getGroupRoleNameMap(group);
    return Array.isArray(announcement?.roleIds)
        ? announcement.roleIds
              .map((roleId) => rolesById.get(roleId) || roleId)
              .filter(Boolean)
        : [];
}

export function announcementTimestamp(value) {
    return value ? formatDateFilter(value, 'long') : '—';
}

export function announcementUserLabel(announcement, key) {
    return firstText(
        announcement?.[`${key}DisplayName`],
        announcement?.[`${key}Name`],
        announcement?.[`${key}Username`]
    );
}

export function announcementUserId(announcement, key) {
    return firstText(
        announcement?.[`${key}Id`],
        announcement?.[`${key}UserId`],
        announcement?.[key]?.id,
        announcement?.[key]?.userId
    );
}

export function getGroupRowLabel(row) {
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

export function getGroupRowImage(row, kind) {
    if (!row || typeof row !== 'object') {
        return '';
    }
    if (kind === 'members') {
        return userImage(row.user || row, true, '64');
    }
    return convertFileUrlToImageUrl(getGroupRowRawImage(row), 256);
}

export function hasGroupPermission(group, permission) {
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
        .filter((role) => roleIds.includes(role?.id))
        .some(
            (role) =>
                Array.isArray(role.permissions) &&
                (role.permissions.includes('*') ||
                    role.permissions.includes(permission))
        );
}

export function hasGroupModerationPermission(group) {
    return [
        'group-invites-manage',
        'group-moderates-manage',
        'group-audit-view',
        'group-bans-manage',
        'group-data-manage',
        'group-members-manage',
        'group-members-remove',
        'group-roles-assign',
        'group-roles-manage',
        'group-default-role-manage'
    ].some((permission) => hasGroupPermission(group, permission));
}
