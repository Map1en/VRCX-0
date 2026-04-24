import { convertFileUrlToImageUrl, userImage } from '@/lib/entityMedia.js';

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
