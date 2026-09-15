// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseLocation } from '@/shared/utils/location';
import { usePreviousInstancesDialogStore } from '@/state/previousInstancesDialogStore';

import { useLocationPreviousInstancesDialog } from './useLocationPreviousInstancesDialog';

const mocks = vi.hoisted(() => ({
    getPreviousInstancesByWorldId: vi.fn(),
    toastAdd: vi.fn()
}));

vi.mock('@/repositories/gameLogRepository', () => ({
    default: {
        getPreviousInstancesByWorldId: mocks.getPreviousInstancesByWorldId
    }
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd }
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

const CURRENT_LOCATION = 'wrld_current:1';

function renderPreviousInstances(
    overrides: Partial<
        Parameters<typeof useLocationPreviousInstancesDialog>[0]
    > = {}
) {
    return renderHook(() =>
        useLocationPreviousInstancesDialog({
            currentLocation: CURRENT_LOCATION,
            groupName: '',
            parsedLocation: parseLocation(CURRENT_LOCATION),
            worldName: 'Current World',
            worldNameHint: '',
            ...overrides
        })
    );
}

describe('useLocationPreviousInstancesDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        usePreviousInstancesDialogStore
            .getState()
            .setPreviousInstancesDialogOpen(false);
    });

    afterEach(() => {
        cleanup();
    });

    it('opens the shared history dialog with the current instance first and the rest newest first', async () => {
        mocks.getPreviousInstancesByWorldId.mockResolvedValue([
            { location: 'wrld_current:2', created_at: '2026-01-01T00:00:00Z' },
            { location: 'wrld_current:3', created_at: '2026-02-01T00:00:00Z' }
        ]);
        const { result } = renderPreviousInstances();

        await act(async () => {
            await result.current.showPreviousInstances();
        });

        const dialog = usePreviousInstancesDialogStore.getState().dialog;
        expect(dialog.open).toBe(true);
        expect(dialog.detailsOnly).toBe(false);
        expect(dialog.title).toBe('Instance History - Current World');
        expect(dialog.rows.map((row) => row.location)).toEqual([
            CURRENT_LOCATION,
            'wrld_current:3',
            'wrld_current:2'
        ]);
        expect(result.current.previousInstancesLoading).toBe(false);
    });

    it('opens a details-only dialog for the exact current instance without loading history', () => {
        const { result } = renderPreviousInstances();

        act(() => {
            result.current.showExactPreviousInstanceInfo();
        });

        const dialog = usePreviousInstancesDialogStore.getState().dialog;
        expect(dialog.open).toBe(true);
        expect(dialog.detailsOnly).toBe(true);
        expect(dialog.title).toBe('Instance Details');
        expect(dialog.rows).toEqual([
            {
                location: CURRENT_LOCATION,
                worldId: 'wrld_current',
                worldName: 'Current World',
                groupName: ''
            }
        ]);
        expect(mocks.getPreviousInstancesByWorldId).not.toHaveBeenCalled();
    });

    it('hands the row to the page callback instead of opening the shared dialog', async () => {
        const onShowPreviousInstances = vi.fn();
        const { result } = renderPreviousInstances({ onShowPreviousInstances });

        await act(async () => {
            await result.current.showPreviousInstances();
        });

        expect(onShowPreviousInstances).toHaveBeenCalledWith({
            location: CURRENT_LOCATION,
            worldId: 'wrld_current',
            worldName: 'Current World',
            groupName: ''
        });
        expect(mocks.getPreviousInstancesByWorldId).not.toHaveBeenCalled();
        expect(usePreviousInstancesDialogStore.getState().dialog.open).toBe(
            false
        );
    });

    it('reports history load failures with a toast and keeps the dialog closed', async () => {
        mocks.getPreviousInstancesByWorldId.mockRejectedValue(
            new Error('history unavailable')
        );
        const { result } = renderPreviousInstances();

        await act(async () => {
            await result.current.showPreviousInstances();
        });

        expect(mocks.toastAdd).toHaveBeenCalledWith({
            type: 'error',
            title: 'history unavailable'
        });
        expect(usePreviousInstancesDialogStore.getState().dialog.open).toBe(
            false
        );
        expect(result.current.previousInstancesLoading).toBe(false);
    });
});
