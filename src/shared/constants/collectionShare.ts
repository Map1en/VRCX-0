export const COLLECTION_SHORTCODE_RE = /^[A-Za-z0-9]{6,12}$/;

export function isCollectionShortcode(value: unknown): boolean {
    return (
        typeof value === 'string' && COLLECTION_SHORTCODE_RE.test(value.trim())
    );
}
