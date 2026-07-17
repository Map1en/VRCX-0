import type { EntityRecord } from '@/domain/entities/profileEntities';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import {
    hasAvatarIdPrefix,
    hasGroupIdPrefix,
    hasUserIdPrefix,
    hasWorldIdPrefix
} from '@/shared/constants/vrchatIds';

import type { UserDialogEntityKind } from './userDialogEntityImages';

function isRecord(value: unknown): value is EntityRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function openRow(
    row: string | EntityRecord,
    kind: UserDialogEntityKind
) {
    const source = isRecord(row) ? row : {};
    const id =
        typeof row === 'string'
            ? row
            : source.id ||
              source.userId ||
              source.worldId ||
              source.avatarId ||
              source.groupId;
    if (!id) {
        return;
    }
    if (kind === 'user' || hasUserIdPrefix(id)) {
        openUserDialog({
            userId: id,
            title:
                String(source.displayName || source.username || '') ||
                undefined,
            seedData: isRecord(row) ? row : null
        });
        return;
    }
    if (
        kind === 'world' ||
        hasWorldIdPrefix(id) ||
        String(id).startsWith('wld_')
    ) {
        openWorldDialog({
            worldId: id,
            title: String(source.name || '') || undefined,
            seedData: isRecord(row) ? row : null
        });
        return;
    }
    if (kind === 'avatar' || hasAvatarIdPrefix(id)) {
        openAvatarDialog({
            avatarId: id,
            title: String(source.name || '') || undefined,
            seedData: isRecord(row) ? row : null
        });
        return;
    }
    if (kind === 'group' || hasGroupIdPrefix(id)) {
        openGroupDialog({
            groupId: id,
            title: String(source.name || '') || undefined,
            seedData: isRecord(row) ? row : null
        });
    }
}
