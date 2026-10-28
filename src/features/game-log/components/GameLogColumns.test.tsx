// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAppTable } from '@/components/data-table/appTable';
import { getToggleableColumns } from '@/components/data-table/tableColumnLayout';

import { useGameLogColumns } from './GameLogColumns';

afterEach(cleanup);

describe('useGameLogColumns', () => {
    it('offers every data column in the column visibility menu', () => {
        const { result } = renderHook(() => {
            const columns = useGameLogColumns({
                deletingGameLogKey: '',
                loadingPreviousInstancesKey: '',
                onCopyDetail: vi.fn(),
                onDeleteRow: vi.fn(),
                onOpenPreviousInstances: vi.fn(),
                shiftHeld: false
            });
            return useAppTable({ data: [], columns });
        });

        expect(
            getToggleableColumns(result.current.getAllLeafColumns()).map(
                (column) => column.id
            )
        ).toEqual(['created_at', 'type', 'displayName', 'detail', 'action']);
    });
});
