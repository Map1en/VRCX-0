export const DATA_TABLE_ROW_CLASS_NAME =
    'h-[var(--vrcx-0-table-row-height)] border-[var(--vrcx-0-table-divider)] hover:bg-[var(--vrcx-0-table-row-hover-surface)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--vrcx-0-table-row-focus)] has-aria-expanded:bg-[var(--vrcx-0-table-row-expanded-surface)] has-aria-expanded:hover:bg-[var(--vrcx-0-table-row-expanded-surface)] data-[state=expanded]:bg-[var(--vrcx-0-table-row-expanded-surface)] data-[state=expanded]:hover:bg-[var(--vrcx-0-table-row-expanded-surface)] data-[state=selected]:bg-[var(--vrcx-0-table-row-selected-surface)] data-[state=selected]:hover:bg-[var(--vrcx-0-table-row-selected-hover-surface)]';

export const DATA_TABLE_HEADER_ROW_CLASS_NAME =
    'border-[var(--vrcx-0-table-divider)] hover:bg-transparent';

export const DATA_TABLE_HEAD_CLASS_NAME =
    'h-[var(--vrcx-0-table-header-height)] px-[var(--vrcx-0-table-cell-padding-inline)] text-xs text-[var(--vrcx-0-table-header-foreground)]';

export const DATA_TABLE_CELL_CLASS_NAME =
    'text-content-secondary px-[var(--vrcx-0-table-cell-padding-inline)] py-[var(--vrcx-0-table-cell-padding-block)] font-normal';

export const DATA_TABLE_PRIMARY_CELL_CLASS_NAME =
    'text-content-primary font-medium';

export const DATA_TABLE_METADATA_CELL_CLASS_NAME =
    'text-content-tertiary font-normal tabular-nums';

export const DATA_TABLE_CONTROL_CELL_CLASS_NAME =
    'text-content-tertiary !py-[var(--vrcx-0-table-control-cell-padding-block)] text-clip';

export const DATA_TABLE_NUMERIC_HEADER_CLASS_NAME = 'text-right';

export const DATA_TABLE_NUMERIC_CELL_CLASS_NAME = `${DATA_TABLE_METADATA_CELL_CLASS_NAME} text-right`;

export const DATA_TABLE_STICKY_ACTION_HEADER_CLASS_NAME =
    'vrcx-0-table-header sticky top-0 right-0 z-20';

export const DATA_TABLE_STICKY_ACTION_CELL_CLASS_NAME =
    'vrcx-0-table-sticky-action sticky right-0 z-10 !py-[var(--vrcx-0-table-control-cell-padding-block)]';
