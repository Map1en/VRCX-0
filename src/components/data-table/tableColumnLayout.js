export function resolveColumnLabel(column) {
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

function hasExplicitColumnLayoutLabel(column) {
    const metaLabel = column?.columnDef?.meta?.label;
    if (typeof metaLabel === 'function') {
        const resolved = metaLabel();
        return typeof resolved === 'string' && Boolean(resolved.trim());
    }
    return typeof metaLabel === 'string' && Boolean(metaLabel.trim());
}

export function isSpacerColumn(column) {
    if (!column) {
        return false;
    }
    if (column.id === '__spacer') {
        return true;
    }
    return Boolean(column.columnDef?.meta?.spacer);
}

export function getColumnOrder(table, leafColumns = table?.getAllLeafColumns?.() ?? []) {
    const leafColumnIds = leafColumns.map((column) => column.id);
    const leafColumnIdSet = new Set(leafColumnIds);
    const currentOrder = table?.getState?.().columnOrder || [];
    const ordered = currentOrder.filter((columnId) => leafColumnIdSet.has(columnId));
    const orderedIds = new Set(ordered);

    for (const columnId of leafColumnIds) {
        if (!orderedIds.has(columnId)) {
            ordered.push(columnId);
            orderedIds.add(columnId);
        }
    }

    return ordered;
}

export function getToggleableColumns(columns = []) {
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

export function getColumnOrderLocked(table) {
    const value = table?.options?.meta?.columnOrderLocked;
    if (value == null) {
        return false;
    }
    if (typeof value === 'object' && 'value' in value) {
        return value.value === true;
    }
    return value === true;
}

export function hasColumnOrderLock(table) {
    const meta = table?.options?.meta;
    return Boolean(
        meta &&
            (
                meta.columnOrderLocked != null ||
                typeof meta.setColumnOrderLocked === 'function' ||
                typeof meta.onColumnOrderLockedChange === 'function'
            )
    );
}

export function setColumnOrderLocked(table, locked) {
    const meta = table?.options?.meta;
    if (typeof meta?.setColumnOrderLocked === 'function') {
        meta.setColumnOrderLocked(locked);
        return;
    }
    if (typeof meta?.onColumnOrderLockedChange === 'function') {
        meta.onColumnOrderLockedChange(locked);
        return;
    }
    if (meta?.columnOrderLocked && typeof meta.columnOrderLocked === 'object' && 'value' in meta.columnOrderLocked) {
        meta.columnOrderLocked.value = locked;
    }
}

export function isColumnReorderable(column) {
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
    try {
        if (column.getIsPinned?.()) {
            return false;
        }
    } catch {
        return false;
    }
    return true;
}

export function getReorderableColumnIds(table) {
    return (table?.getVisibleLeafColumns?.() ?? [])
        .filter((column) => isColumnReorderable(column))
        .map((column) => column.id);
}

export function resetTableLayout(table, onResetLayout) {
    if (typeof onResetLayout === 'function') {
        onResetLayout(table);
        return;
    }

    table?.resetColumnVisibility?.();
    table?.setColumnOrder?.([]);
    table?.setColumnSizing?.({});
}
