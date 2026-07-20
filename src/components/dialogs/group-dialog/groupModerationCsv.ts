import { formatCsvField } from '@/shared/utils/csv';

import type { GroupAuditLogRow } from './GroupModerationLogsPanel';

export interface GroupAuditLogExportColumn {
    key:
        | 'actorDisplayName'
        | 'created_at'
        | 'data'
        | 'description'
        | 'eventType';
    labelKey: string;
}

export const GROUP_AUDIT_LOG_EXPORT_COLUMNS: readonly GroupAuditLogExportColumn[] =
    [
        {
            key: 'created_at',
            labelKey: 'dialog.group_member_moderation.created_at'
        },
        { key: 'eventType', labelKey: 'dialog.group_member_moderation.type' },
        {
            key: 'actorDisplayName',
            labelKey: 'dialog.group_member_moderation.display_name'
        },
        {
            key: 'description',
            labelKey: 'dialog.group_member_moderation.description'
        },
        { key: 'data', labelKey: 'dialog.group_member_moderation.data' }
    ];

function groupAuditLogFieldValue(
    row: GroupAuditLogRow,
    key: GroupAuditLogExportColumn['key']
): string {
    if (key === 'data') {
        if (row.data === null || row.data === undefined) {
            return '';
        }
        try {
            return JSON.stringify(row.data);
        } catch {
            return '';
        }
    }
    return String(row[key] ?? '');
}

export function buildGroupAuditLogCsv(
    rows: GroupAuditLogRow[],
    selectedColumns: readonly string[]
): string {
    const columns = GROUP_AUDIT_LOG_EXPORT_COLUMNS.filter((column) =>
        selectedColumns.includes(column.key)
    );
    const header = columns.map((column) => column.key).join(',');
    const lines = rows.map((row) =>
        columns
            .map((column) =>
                formatCsvField(groupAuditLogFieldValue(row, column.key))
            )
            .join(',')
    );
    return [header, ...lines].join('\n');
}
