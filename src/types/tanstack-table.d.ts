import type { RowData, TableFeatures } from '@tanstack/react-table';

declare module '@tanstack/react-table' {
    interface ColumnMeta<
        TFeatures extends TableFeatures,
        TData extends RowData,
        TValue
    > {
        label?: string | (() => string);
        tableHeadClassName?: string;
        tableCellClassName?: string;
        disableReorder?: boolean;
        disableVisibilityToggle?: boolean;
        stretch?: boolean;
        spacer?: boolean;
        isSpacer?: boolean;
    }

    interface TableMeta<
        TFeatures extends TableFeatures,
        TData extends RowData
    > {
        columnOrderLocked?: boolean | { value?: boolean };
        setColumnOrderLocked?: (locked: boolean) => void;
        onColumnOrderLockedChange?: (locked: boolean) => void;
    }
}
