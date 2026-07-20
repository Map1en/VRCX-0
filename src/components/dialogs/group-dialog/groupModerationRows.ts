import type { EntityRecord } from '@/domain/entities/profileEntities';

import {
    getGroupRoleNameMap,
    groupModerationTabPermissions,
    hasGroupPermission,
    type GroupModerationTabValue
} from './groupDialogUtils';

type TranslateFn = (key: string) => string;

export interface GroupModerationTab {
    disabled: boolean;
    label: string;
    value: GroupModerationTabValue;
}

export type GroupModerationActionKey =
    | 'kick'
    | 'ban'
    | 'unban'
    | 'delete-invite'
    | 'accept-request'
    | 'reject-request'
    | 'block-request'
    | 'delete-blocked';

export interface GroupModerationAction {
    key: GroupModerationActionKey;
    label: string;
    destructive?: boolean;
}

function isRecord(value: unknown): value is EntityRecord {
    return Boolean(value && typeof value === 'object');
}

function record(value: unknown): EntityRecord {
    return isRecord(value) ? value : {};
}

function text(...values: unknown[]): string {
    const value = values.find(
        (entry) => typeof entry === 'string' && entry.trim()
    );
    return typeof value === 'string' ? value : '';
}

const GROUP_MODERATION_TAB_LABELS: Array<{
    labelKey: string;
    value: GroupModerationTabValue;
}> = [
    {
        value: 'members',
        labelKey: 'dialog.group_member_moderation.members'
    },
    { value: 'bans', labelKey: 'dialog.group_member_moderation.bans' },
    {
        value: 'invites',
        labelKey: 'dialog.group_member_moderation.invites'
    },
    {
        value: 'requests',
        labelKey: 'dialog.group_member_moderation.join_requests'
    },
    {
        value: 'blocked',
        labelKey: 'dialog.group_member_moderation.blocked_requests'
    },
    { value: 'logs', labelKey: 'dialog.group_member_moderation.logs' }
];

export function getGroupModerationTabs(
    t: TranslateFn,
    group?: unknown
): GroupModerationTab[] {
    return GROUP_MODERATION_TAB_LABELS.map((tab) => {
        const permissions = groupModerationTabPermissions(tab.value);
        return {
            value: tab.value,
            label: t(tab.labelKey),
            disabled: Boolean(
                group &&
                permissions.length &&
                !permissions.some((permission) =>
                    hasGroupPermission(group, permission)
                )
            )
        };
    });
}

export function resolveGroupModerationActiveTab(
    activeTab: string,
    tabs: GroupModerationTab[]
) {
    const currentTab = tabs.find((tab) => tab.value === activeTab);
    if (currentTab && !currentTab.disabled) {
        return currentTab.value;
    }
    return tabs.find((tab) => !tab.disabled)?.value || '';
}

export function moderationRowUserId(row: unknown) {
    const source = record(row);
    return text(
        source.userId,
        source.targetUserId,
        record(source.user).id,
        source.actorId
    );
}

export function moderationRowLabel(row: unknown) {
    if (!isRecord(row)) {
        return String(row ?? '—');
    }
    return (
        text(
            record(row.user).displayName,
            row.displayName,
            row.targetDisplayName,
            row.actorDisplayName,
            row.userId,
            row.targetUserId,
            row.actorId,
            row.id
        ) || '—'
    );
}

export function moderationRowRoleIds(row: unknown): string[] {
    const source = record(row);
    const user = record(source.user);
    const roleIds = Array.isArray(source.roleIds)
        ? source.roleIds
        : Array.isArray(user.roleIds)
          ? user.roleIds
          : [];
    return roleIds
        .map((roleId) => text(roleId))
        .filter((roleId): roleId is string => Boolean(roleId));
}

export function moderationRowRoles(row: unknown, group: unknown) {
    const roles = getGroupRoleNameMap(group);
    return moderationRowRoleIds(row)
        .map((roleId) => roles.get(roleId) || 'Role')
        .filter(Boolean)
        .join(', ');
}

export function moderationRowStatus(row: unknown) {
    const source = record(row);
    return (
        text(
            source.action,
            source.eventType,
            source.type,
            source.membershipStatus,
            source.visibility
        ) || '—'
    );
}

export type GroupModerationStatusTone =
    | 'neutral'
    | 'active'
    | 'pending'
    | 'danger';

export function moderationStatusTone(
    status: string
): GroupModerationStatusTone {
    const value = status.toLowerCase();
    if (!value || value === '—') {
        return 'neutral';
    }
    if (value.includes('banned')) {
        return 'danger';
    }
    if (
        value.includes('invited') ||
        value.includes('request') ||
        value.includes('pending')
    ) {
        return 'pending';
    }
    if (
        value.includes('member') ||
        value.includes('active') ||
        value.includes('joined')
    ) {
        return 'active';
    }
    return 'neutral';
}

export function moderationRowDate(row: unknown) {
    const source = record(row);
    return text(
        source.createdAt,
        source.created_at,
        source.updatedAt,
        source.updated_at,
        source.joinedAt,
        source.joined_at
    );
}

export function moderationRowNote(row: unknown): string {
    const source = record(row);
    return (
        text(source.description) ||
        text(source.note) ||
        text(source.managerNotes)
    );
}

const GROUP_MODERATION_STATUS_LABEL_KEYS: Record<string, string> = {
    member: 'dialog.group_member_moderation.status.member',
    invited: 'dialog.group_member_moderation.status.invited',
    banned: 'dialog.group_member_moderation.status.banned',
    requested: 'dialog.group_member_moderation.status.requested',
    blocked: 'dialog.group_member_moderation.status.blocked',
    userblocked: 'dialog.group_member_moderation.status.userblocked',
    joined: 'dialog.group_member_moderation.status.joined',
    active: 'dialog.group_member_moderation.status.active',
    pending: 'dialog.group_member_moderation.status.pending'
};

export function moderationStatusLabel(status: string, t: TranslateFn): string {
    const key = GROUP_MODERATION_STATUS_LABEL_KEYS[status.trim().toLowerCase()];
    return key ? t(key) : status;
}

export function moderationRowSearchText(row: unknown, group: unknown) {
    const source = record(row);
    return [
        moderationRowLabel(row),
        moderationRowUserId(row),
        moderationRowRoles(row, group),
        moderationRowStatus(row),
        moderationRowDate(row),
        text(source.description),
        text(source.note),
        text(source.managerNotes)
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

export function getGroupModerationActions(
    tabValue: GroupModerationTabValue,
    row: unknown,
    t: TranslateFn
): GroupModerationAction[] {
    const userId = moderationRowUserId(row);
    if (!userId) {
        return [];
    }
    if (tabValue === 'members') {
        return [
            {
                key: 'kick',
                label: t('dialog.group_member_moderation.kick'),
                destructive: true
            },
            {
                key: 'ban',
                label: t('dialog.group_member_moderation.ban'),
                destructive: true
            }
        ];
    }
    if (tabValue === 'bans') {
        return [
            {
                key: 'unban',
                label: t('dialog.group_member_moderation.unban')
            }
        ];
    }
    if (tabValue === 'invites') {
        return [
            {
                key: 'delete-invite',
                label: t('dialog.group_member_moderation.delete'),
                destructive: true
            }
        ];
    }
    if (tabValue === 'requests') {
        return [
            {
                key: 'accept-request',
                label: t('dialog.group_member_moderation.accept')
            },
            {
                key: 'reject-request',
                label: t('dialog.group_member_moderation.reject'),
                destructive: true
            },
            {
                key: 'block-request',
                label: t('dialog.group_member_moderation.block'),
                destructive: true
            }
        ];
    }
    if (tabValue === 'blocked') {
        return [
            {
                key: 'delete-blocked',
                label: t('dialog.group_member_moderation.delete'),
                destructive: true
            }
        ];
    }
    return [];
}
