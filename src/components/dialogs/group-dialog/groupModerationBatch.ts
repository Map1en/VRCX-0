import type { EntityRecord } from '@/domain/entities/profileEntities';
import type {
    GroupModerationBatchAction,
    GroupModerationBatchInput
} from '@/platform/tauri/bindings';

import {
    moderationRowRoleIds,
    moderationRowUserId
} from './groupModerationRows';

export function buildGroupModerationBatchInput({
    action,
    expectedEndpoint,
    expectedOwnerUserId,
    groupId,
    roleIds = [],
    rows
}: {
    action: GroupModerationBatchAction;
    expectedEndpoint: string;
    expectedOwnerUserId: string;
    groupId: string;
    roleIds?: string[];
    rows: EntityRecord[];
}): GroupModerationBatchInput {
    const normalizedRoleIds = Array.from(
        new Set(roleIds.map((roleId) => roleId.trim()).filter(Boolean))
    );
    return {
        expectedEndpoint,
        expectedOwnerUserId,
        groupId,
        action,
        targets: rows.map((row) => {
            const currentRoleIds = new Set(moderationRowRoleIds(row));
            const targetRoleIds =
                action.type === 'addRoles'
                    ? normalizedRoleIds.filter(
                          (roleId) => !currentRoleIds.has(roleId)
                      )
                    : action.type === 'removeRoles'
                      ? normalizedRoleIds.filter((roleId) =>
                            currentRoleIds.has(roleId)
                        )
                      : [];
            return {
                userId: moderationRowUserId(row),
                roleIds: targetRoleIds
            };
        })
    };
}
