import { formatCsvRow } from '@/shared/utils/csv';

import type { FavoriteItem, FavoriteKind } from './favoritesTypes';

export const FAVORITES_EXPORT_ALL_VALUE = '__all__';
export const FAVORITES_EXPORT_NONE_VALUE = '__none__';

export type FavoriteExportField =
    | 'id'
    | 'name'
    | 'status'
    | 'author'
    | 'thumbnail'
    | 'group'
    | 'source';

export type FavoriteExportFieldOption = {
    label: string;
    value: FavoriteExportField;
};

type FavoriteExportItem = Pick<FavoriteItem, 'id' | 'source'> &
    Partial<
        Pick<
            FavoriteItem,
            | 'authorName'
            | 'groupKey'
            | 'groupLabel'
            | 'imageUrl'
            | 'statusLabel'
            | 'subtitle'
            | 'title'
        >
    >;

export const FAVORITE_EXPORT_FIELD_OPTIONS: Readonly<{
    friend: readonly FavoriteExportFieldOption[];
    entity: readonly FavoriteExportFieldOption[];
}> = Object.freeze({
    friend: Object.freeze([
        { label: 'ID', value: 'id' },
        { label: 'Name', value: 'name' },
        { label: 'Status', value: 'status' },
        { label: 'Group', value: 'group' },
        { label: 'Source', value: 'source' }
    ] satisfies FavoriteExportFieldOption[]),
    entity: Object.freeze([
        { label: 'ID', value: 'id' },
        { label: 'Name', value: 'name' },
        { label: 'Author', value: 'author' },
        { label: 'Thumbnail', value: 'thumbnail' },
        { label: 'Group', value: 'group' },
        { label: 'Source', value: 'source' }
    ] satisfies FavoriteExportFieldOption[])
});

export function getFavoriteExportFieldOptions(
    kind: FavoriteKind
): readonly FavoriteExportFieldOption[] {
    return kind === 'friend'
        ? FAVORITE_EXPORT_FIELD_OPTIONS.friend
        : FAVORITE_EXPORT_FIELD_OPTIONS.entity;
}

export function buildFavoriteExportCsv(
    items: readonly FavoriteExportItem[],
    kind: FavoriteKind,
    selectedFields: readonly FavoriteExportField[] | null = null
): string {
    const options = getFavoriteExportFieldOptions(kind);
    const optionByValue = new Map<string, FavoriteExportFieldOption>(
        options.map((option) => [option.value, option])
    );
    const fields = (
        Array.isArray(selectedFields) && selectedFields.length
            ? selectedFields
            : options.map((option) => option.value)
    ).filter((field) => optionByValue.has(field));
    const labels = fields.map((field) => optionByValue.get(field)?.label ?? '');
    const lines = [labels.join(',')];

    for (const item of items) {
        lines.push(
            formatCsvRow(
                {
                    id: item.id,
                    name: item.title,
                    status: item.statusLabel || item.subtitle || '',
                    author: item.authorName ?? (item.subtitle || ''),
                    thumbnail: item.imageUrl || '',
                    group: item.groupLabel || item.groupKey || '',
                    source: item.source || ''
                },
                fields
            )
        );
    }

    return lines.join('\n');
}
