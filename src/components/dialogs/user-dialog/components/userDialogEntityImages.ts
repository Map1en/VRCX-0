import type { EntityRecord } from '@/domain/entities/profileEntities';
import {
    convertFileUrlToImageUrl,
    userImage
} from '@/services/entityMediaService';

export type UserDialogEntityKind = 'user' | 'world' | 'avatar' | 'group';

function isRecord(value: unknown): value is EntityRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function rowImage(row: unknown, kind: UserDialogEntityKind) {
    if (!isRecord(row)) {
        return '';
    }
    if (kind === 'user') {
        return userImage(row, true, '64');
    }
    const imageUrl = [
        row.thumbnailImageUrl,
        row.imageUrl,
        row.iconUrl,
        row.userIcon,
        row.currentAvatarImageUrl
    ].find(
        (value): value is string =>
            typeof value === 'string' && Boolean(value.trim())
    );
    return convertFileUrlToImageUrl(imageUrl, 128);
}
