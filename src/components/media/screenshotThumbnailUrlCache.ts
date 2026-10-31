const MAX_REMEMBERED_THUMBNAILS = 4000;

const thumbnailUrlByPath = new Map<string, string>();

export function rememberScreenshotThumbnailUrl(path: string, url: string) {
    if (!path || !url) {
        return;
    }
    thumbnailUrlByPath.delete(path);
    thumbnailUrlByPath.set(path, url);
    if (thumbnailUrlByPath.size > MAX_REMEMBERED_THUMBNAILS) {
        const oldest = thumbnailUrlByPath.keys().next().value;
        if (oldest !== undefined) {
            thumbnailUrlByPath.delete(oldest);
        }
    }
}

export function getRememberedScreenshotThumbnailUrl(path: string) {
    return (path && thumbnailUrlByPath.get(path)) || '';
}
