import { convertFileUrlToImageUrl, userImage } from '@/lib/entityMedia.js';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService.js';

export function rowImage(row, kind) {
    if (!row || typeof row !== 'object') {
        return '';
    }
    if (kind === 'user') {
        return userImage(row, true, '64');
    }
    return convertFileUrlToImageUrl(
        row.thumbnailImageUrl ||
            row.imageUrl ||
            row.iconUrl ||
            row.userIcon ||
            row.currentAvatarImageUrl,
        128
    );
}

export function openRow(row, kind) {
    const id =
        typeof row === 'string'
            ? row
            : row?.id ||
              row?.userId ||
              row?.worldId ||
              row?.avatarId ||
              row?.groupId;
    if (!id) {
        return;
    }
    if (kind === 'user' || String(id).startsWith('usr_')) {
        openUserDialog({
            userId: id,
            title: row?.displayName || row?.username || undefined,
            seedData: typeof row === 'object' ? row : null
        });
        return;
    }
    if (
        kind === 'world' ||
        String(id).startsWith('wrld_') ||
        String(id).startsWith('wld_')
    ) {
        openWorldDialog({
            worldId: id,
            title: row?.name || undefined,
            seedData: typeof row === 'object' ? row : null
        });
        return;
    }
    if (kind === 'avatar' || String(id).startsWith('avtr_')) {
        openAvatarDialog({
            avatarId: id,
            title: row?.name || undefined,
            seedData: typeof row === 'object' ? row : null
        });
        return;
    }
    if (kind === 'group' || String(id).startsWith('grp_')) {
        openGroupDialog({
            groupId: id,
            title: row?.name || undefined,
            seedData: typeof row === 'object' ? row : null
        });
    }
}
