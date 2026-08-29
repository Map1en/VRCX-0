import type { RowData } from '@tanstack/react-table';

import type { AppColumn, AppTable, AppTableCore } from './appTable';

export function resolveColumnLabel<TData extends RowData>(
    column: AppColumn<TData> | null | undefined
) {
    const metaLabel = column?.columnDef?.meta?.label;
    if (typeof metaLabel === 'function') {
        const resolved = metaLabel();
        return typeof resolved === 'string' ? resolved : '';
    }
    if (typeof metaLabel === 'string') {
        return metaLabel.trim() ? metaLabel : '';
    }
    if (typeof column?.columnDef?.header === 'string') {
        return column.columnDef.header.trim() ? column.columnDef.header : '';
    }
    return column?.id || '';
}

function hasExplicitColumnLayoutLabel<TData extends RowData>(
    column: AppColumn<TData> | null | undefined
) {
    const metaLabel = column?.columnDef?.meta?.label;
    if (typeof metaLabel === 'function') {
        const resolved = metaLabel();
        return typeof resolved === 'string' && Boolean(resolved.trim());
    }
    return typeof metaLabel === 'string' && Boolean(metaLabel.trim());
}

export function isSpacerColumn<TData extends RowData>(
    column: AppColumn<TData> | null | undefined
) {
    if (!column) {
        return false;
    }
    if (column.id === '__spacer') {
        return true;
    }
    return Boolean(column.columnDef?.meta?.spacer);
}

export function getStretchColumnId<TData extends RowData>(
    table: AppTableCore<TData>
): string | null {
    const visibleLeafColumns = table.getVisibleLeafColumns();
    const markedStretchColumn = visibleLeafColumns.find(
        (column) => column.columnDef?.meta?.stretch === true
    );
    if (markedStretchColumn) {
        return markedStretchColumn.id;
    }

    for (let index = visibleLeafColumns.length - 1; index >= 0; index -= 1) {
        const column = visibleLeafColumns[index];
        if (isSpacerColumn(column)) {
            continue;
        }
        if (column.columnDef?.maxSize != null) {
            continue;
        }
        if (column.columnDef?.enableResizing === false) {
            continue;
        }
        return column.id;
    }

    return null;
}

export function getColumnOrder<TData extends RowData>(
    table: AppTable<TData>,
    leafColumns: AppColumn<TData>[] = table.getAllLeafColumns()
) {
    const leafColumnIds = leafColumns.map((column) => column.id);
    const leafColumnIdSet = new Set(leafColumnIds);
    const currentOrder = table.atoms.columnOrder.get() || [];
    const ordered = currentOrder.filter((columnId) =>
        leafColumnIdSet.has(columnId)
    );
    const orderedIds = new Set(ordered);

    for (const columnId of leafColumnIds) {
        if (!orderedIds.has(columnId)) {
            ordered.push(columnId);
            orderedIds.add(columnId);
        }
    }

    return ordered;
}

export function getToggleableColumns<TData extends RowData>(
    columns: AppColumn<TData>[] = []
) {
    return columns.filter((column) => {
        if (!column?.getCanHide?.()) {
            return false;
        }
        if (isSpacerColumn(column)) {
            return false;
        }
        if (column.columnDef?.meta?.disableVisibilityToggle) {
            return false;
        }
        return hasExplicitColumnLayoutLabel(column);
    });
}

export function getColumnOrderLocked<TData extends RowData>(
    table: AppTable<TData>
) {
    const value = table.options.meta?.columnOrderLocked;
    if (value == null) {
        return false;
    }
    if (typeof value === 'object' && 'value' in value) {
        return value.value === true;
    }
    return value === true;
}

export function hasColumnOrderLock<TData extends RowData>(
    table: AppTable<TData>
) {
    const meta = table.options.meta;
    return Boolean(
        meta &&
        (meta.columnOrderLocked != null ||
            typeof meta.setColumnOrderLocked === 'function' ||
            typeof meta.onColumnOrderLockedChange === 'function')
    );
}

export function setColumnOrderLocked<TData extends RowData>(
    table: AppTable<TData>,
    locked: boolean
) {
    const meta = table.options.meta;
    if (typeof meta?.setColumnOrderLocked === 'function') {
        meta.setColumnOrderLocked(locked);
        return;
    }
    if (typeof meta?.onColumnOrderLockedChange === 'function') {
        meta.onColumnOrderLockedChange(locked);
        return;
    }
    if (
        meta?.columnOrderLocked &&
        typeof meta.columnOrderLocked === 'object' &&
        'value' in meta.columnOrderLocked
    ) {
        meta.columnOrderLocked.value = locked;
    }
}

export function isColumnReorderable<TData extends RowData>(
    column: AppColumn<TData> | null | undefined
) {
    if (!column) {
        return false;
    }
    if (isSpacerColumn(column)) {
        return false;
    }
    if (column.columnDef?.meta?.disableReorder) {
        return false;
    }
    if (!hasExplicitColumnLayoutLabel(column)) {
        return false;
    }
    return true;
}

export function getReorderableColumnIds<TData extends RowData>(
    columns: AppColumn<TData>[]
) {
    return columns
        .filter((column) => isColumnReorderable(column))
        .map((column) => column.id);
}

export function resetTableLayout<TData extends RowData>(
    table: AppTable<TData>,
    onResetLayout?: ((table: AppTable<TData>) => void) | null
) {
    if (typeof onResetLayout === 'function') {
        onResetLayout(table);
        return;
    }

    table?.resetColumnVisibility?.();
    table?.setColumnOrder?.([]);
    table?.setColumnSizing?.({});
}
