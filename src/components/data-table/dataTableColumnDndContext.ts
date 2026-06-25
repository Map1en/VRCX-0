import type { UniqueIdentifier } from '@dnd-kit/core';
import { createContext, useContext } from 'react';

type DataTableColumnDndState = {
    enabled: boolean;
    items: UniqueIdentifier[];
    table: unknown;
};

export const dataTableColumnDndDefaultState: DataTableColumnDndState = {
    enabled: false,
    items: [],
    table: null
};

export const DataTableColumnDndContext = createContext(
    dataTableColumnDndDefaultState
);

export function useDataTableColumnDnd() {
    return useContext(DataTableColumnDndContext);
}
