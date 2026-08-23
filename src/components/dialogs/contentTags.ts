export const CONTENT_TAG_OPTIONS = [
    {
        value: 'content_horror',
        labelKey: 'dialog.world.tags.content_horror'
    },
    {
        value: 'content_gore',
        labelKey: 'dialog.world.tags.content_gore'
    },
    {
        value: 'content_violence',
        labelKey: 'dialog.world.tags.content_violence'
    },
    {
        value: 'content_adult',
        labelKey: 'dialog.world.tags.content_adult'
    },
    {
        value: 'content_sex',
        labelKey: 'dialog.world.tags.content_sex'
    }
] as const;

function normalizeContentTag(value: unknown) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^content_/, '');
    return normalized ? `content_${normalized}` : '';
}

export function contentTagsFromCsv(value: unknown) {
    return Array.from(
        new Set(
            String(value || '')
                .split(',')
                .map(normalizeContentTag)
                .filter(Boolean)
        )
    );
}

export function contentTagsCsv(tags: readonly string[]) {
    return tags
        .filter((tag) => tag.startsWith('content_'))
        .map((tag) => tag.replace(/^content_/, ''))
        .join(',');
}
