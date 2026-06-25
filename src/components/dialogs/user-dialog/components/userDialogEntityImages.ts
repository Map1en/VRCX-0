import {
    convertFileUrlToImageUrl,
    userImage
} from '@/services/entityMediaService';

export function rowImage(row: any, kind: any) {
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
