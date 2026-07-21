import type { UserGroupsOverviewGroup } from '@/platform/tauri/bindings';

const MANAGE_GROUP_INVITES_PERMISSION = 'group-invites-manage';

export function groupsForInvitePicker(
    groups: readonly UserGroupsOverviewGroup[],
    permissionsDegraded: boolean
): readonly UserGroupsOverviewGroup[] {
    if (permissionsDegraded) {
        return groups;
    }

    return groups.filter(
        (group) =>
            group.permissions.includes('*') ||
            group.permissions.includes(MANAGE_GROUP_INVITES_PERMISSION)
    );
}
