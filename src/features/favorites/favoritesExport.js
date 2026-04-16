import { formatCsvRow } from '@/shared/utils/csv.js';

export const FAVORITES_EXPORT_ALL_VALUE = '__all__';
export const FAVORITES_EXPORT_NONE_VALUE = '__none__';

export const FAVORITE_EXPORT_FIELD_OPTIONS = Object.freeze({
    friend: Object.freeze([
        { label: 'ID', value: 'id' },
        { label: 'Name', value: 'name' },
        { label: 'Status', value: 'status' },
        { label: 'Group', value: 'group' },
        { label: 'Source', value: 'source' }
    ]),
    entity: Object.freeze([
        { label: 'ID', value: 'id' },
        { label: 'Name', value: 'name' },
        { label: 'Author', value: 'author' },
        { label: 'Thumbnail', value: 'thumbnail' },
        { label: 'Group', value: 'group' },
        { label: 'Source', value: 'source' }
    ])
});

export function getFavoriteExportFieldOptions(kind) {
    return kind === 'friend'
        ? FAVORITE_EXPORT_FIELD_OPTIONS.friend
        : FAVORITE_EXPORT_FIELD_OPTIONS.entity;
}

export function buildFavoriteExportCsv(items, kind, selectedFields = null) {
    const options = getFavoriteExportFieldOptions(kind);
    const optionByValue = Object.fromEntries(options.map((option) => [option.value, option]));
    const fields = (Array.isArray(selectedFields) && selectedFields.length ? selectedFields : options.map((option) => option.value))
        .filter((field) => optionByValue[field]);
    const labels = fields.map((field) => optionByValue[field].label);
    const lines = [labels.join(',')];

    for (const item of items) {
        lines.push(formatCsvRow({
            id: item.id,
            name: item.title,
            status: item.statusLabel || item.subtitle || '',
            author: item.subtitle || '',
            thumbnail: item.imageUrl || '',
            group: item.groupLabel || item.groupKey || '',
            source: item.source || ''
        }, fields));
    }

    return lines.join('\n');
}
