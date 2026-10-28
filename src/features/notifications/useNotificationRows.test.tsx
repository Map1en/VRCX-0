// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationRow } from './notificationPageTypes';

const mocks = vi.hoisted(() => ({
    state: {
        rows: [] as NotificationRow[],
        loadStatus: 'ready',
        detail: '',
        loadForCurrentUser: vi.fn(async () => undefined)
    }
}));

vi.mock('@/state/vrcNotificationStore', () => ({
    useVrcNotificationStore: <T,>(selector: (state: typeof mocks.state) => T) =>
        selector(mocks.state)
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

import { useNotificationRows } from './useNotificationRows';

const NO_TYPES: string[] = [];

function friendRequest(id: string, seen = false): NotificationRow {
    return { id, type: 'friendRequest', version: 1, seen };
}

function renderRows(holdNew: boolean) {
    return renderHook(
        ({ hold }) =>
            useNotificationRows({
                activeTypes: NO_TYPES,
                currentUserId: 'usr_self',
                deferredSearchQuery: '',
                filtersReady: true,
                holdNew: hold,
                quickFilter: 'all'
            }),
        { initialProps: { hold: holdNew } }
    );
}

describe('useNotificationRows', () => {
    beforeEach(() => {
        mocks.state.rows = [friendRequest('not_1')];
    });

    afterEach(cleanup);

    it('holds new arrivals back while the reader is away from the top', () => {
        const { result, rerender } = renderRows(true);
        expect(result.current.rows.map((row) => row.id)).toEqual(['not_1']);

        mocks.state.rows = [friendRequest('not_2'), friendRequest('not_1')];
        rerender({ hold: true });

        expect(result.current.rows.map((row) => row.id)).toEqual(['not_1']);
        expect(result.current.pendingCount).toBe(1);

        rerender({ hold: false });

        expect(result.current.rows.map((row) => row.id)).toEqual([
            'not_2',
            'not_1'
        ]);
        expect(result.current.pendingCount).toBe(0);
    });

    it('counts actionable and unread rows for the quick tabs', () => {
        mocks.state.rows = [
            friendRequest('not_1'),
            friendRequest('not_2', true),
            { id: 'not_3', type: 'message', version: 2, seen: true }
        ];
        const { result } = renderRows(false);

        expect(result.current.quickFilterCounts).toEqual({
            all: 3,
            action: 2,
            unread: 1
        });
    });
});
