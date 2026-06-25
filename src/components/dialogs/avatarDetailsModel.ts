import { normalizeString } from '@/shared/utils/string';

export function normalizeTagName(value: any, prefix: any) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(new RegExp(`^${prefix}`), '');
    return normalized ? `${prefix}${normalized}` : '';
}

export function authorTagsFromCsv(value: any) {
    return Array.from(
        new Set(
            String(value || '')
                .split(',')
                .map((entry: any) => normalizeTagName(entry, 'author_tag_'))
                .filter(Boolean)
        )
    );
}

export function authorTagsCsv(tags: any) {
    return (Array.isArray(tags) ? tags : [])
        .filter(
            (tag: any) =>
                typeof tag === 'string' && tag.startsWith('author_tag_')
        )
        .map((tag: any) => tag.replace(/^author_tag_/, ''))
        .join(',');
}

export function tagsKey(tags: any) {
    return (Array.isArray(tags) ? tags : []).slice().sort().join('\n');
}

export function styleName(style: any) {
    return normalizeString(style?.styleName || style?.name || style?.id);
}
