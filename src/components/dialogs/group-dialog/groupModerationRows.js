import { getGroupRoleNameMap } from './groupDialogUtils.js';

export function getGroupModerationTabs(t) {
    return [
        {
            value: 'members',
            label: t('dialog.group.moderation_tabs.members')
        },
        { value: 'bans', label: t('dialog.group.moderation_tabs.bans') },
        {
            value: 'invites',
            label: t('dialog.group.moderation_tabs.invites')
        },
        {
            value: 'requests',
            label: t('dialog.group.moderation_tabs.join_requests')
        },
        {
            value: 'blocked',
            label: t('dialog.group.moderation_tabs.blocked_requests')
        },
        { value: 'logs', label: t('dialog.group.moderation_tabs.logs') }
    ];
}

export function moderationRowUserId(row) {
    return (
        row?.userId || row?.targetUserId || row?.user?.id || row?.actorId || ''
    );
}

export function moderationRowLabel(row) {
    if (!row || typeof row !== 'object') {
        return String(row ?? '—');
    }
    return (
        row?.user?.displayName ||
        row?.displayName ||
        row?.targetDisplayName ||
        row?.actorDisplayName ||
        row?.userId ||
        row?.targetUserId ||
        row?.actorId ||
        row?.id ||
        '—'
    );
}

export function moderationRowSubtitle(row) {
    return [
        row?.roleIds?.length ? row.roleIds.join(', ') : '',
        row?.action ||
            row?.eventType ||
            row?.type ||
            row?.membershipStatus ||
            '',
        row?.createdAt || row?.updatedAt || row?.joinedAt || ''
    ]
        .filter(Boolean)
        .join(' | ');
}

export function moderationRowRoles(row, group) {
    const roles = getGroupRoleNameMap(group);
    const roleIds = Array.isArray(row?.roleIds)
        ? row.roleIds
        : Array.isArray(row?.user?.roleIds)
          ? row.user.roleIds
          : [];
    return roleIds
        .map((roleId) => roles.get(roleId) || 'Role')
        .filter(Boolean)
        .join(', ');
}

export function moderationRowStatus(row) {
    return (
        row?.action ||
        row?.eventType ||
        row?.type ||
        row?.membershipStatus ||
        row?.visibility ||
        '—'
    );
}

export function moderationRowDate(row) {
    return (
        row?.createdAt ||
        row?.created_at ||
        row?.updatedAt ||
        row?.updated_at ||
        row?.joinedAt ||
        row?.joined_at ||
        ''
    );
}

export function moderationRowSearchText(row, group) {
    return [
        moderationRowLabel(row),
        moderationRowUserId(row),
        moderationRowRoles(row, group),
        moderationRowStatus(row),
        moderationRowDate(row),
        row?.description,
        row?.note,
        row?.managerNotes
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

export function getGroupModerationActions(tabValue, row, t) {
    const userId = moderationRowUserId(row);
    if (!userId) {
        return [];
    }
    if (tabValue === 'members') {
        return [
            {
                key: 'kick',
                label: t('dialog.group.moderation_tabs.kick'),
                destructive: true
            },
            {
                key: 'ban',
                label: t('dialog.group.moderation_tabs.ban'),
                destructive: true
            }
        ];
    }
    if (tabValue === 'bans') {
        return [
            {
                key: 'unban',
                label: t('dialog.group.moderation_tabs.unban')
            }
        ];
    }
    if (tabValue === 'invites') {
        return [
            {
                key: 'delete-invite',
                label: t('dialog.group.moderation_tabs.delete'),
                destructive: true
            }
        ];
    }
    if (tabValue === 'requests') {
        return [
            {
                key: 'accept-request',
                label: t('dialog.group.moderation_tabs.accept')
            },
            {
                key: 'reject-request',
                label: t('dialog.group.moderation_tabs.reject'),
                destructive: true
            },
            {
                key: 'block-request',
                label: t('dialog.group.moderation_tabs.block'),
                destructive: true
            }
        ];
    }
    if (tabValue === 'blocked') {
        return [
            {
                key: 'delete-blocked',
                label: t('dialog.group.moderation_tabs.delete'),
                destructive: true
            }
        ];
    }
    return [];
}
