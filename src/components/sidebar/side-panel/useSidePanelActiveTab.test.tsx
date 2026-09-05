// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    requestGroupInstancesRefresh: vi.fn()
}));

vi.mock('@/services/runtime-event-bridge/auxiliaryEventHandlers', () => ({
    requestGroupInstancesRefresh: mocks.requestGroupInstancesRefresh
}));

import { useSidePanelActiveTab } from './useSidePanelActiveTab';

describe('useSidePanelActiveTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.requestGroupInstancesRefresh.mockResolvedValue(undefined);
    });

    it('refreshes once each time the groups tab is selected', () => {
        const { result } = renderHook(() => useSidePanelActiveTab());

        act(() => result.current.setActiveTab('groups'));
        expect(mocks.requestGroupInstancesRefresh).toHaveBeenCalledTimes(1);
        expect(mocks.requestGroupInstancesRefresh).toHaveBeenCalledWith(
            'groups tab selected'
        );

        act(() => result.current.setActiveTab('groups'));
        expect(mocks.requestGroupInstancesRefresh).toHaveBeenCalledTimes(1);

        act(() => result.current.setActiveTab('friends'));
        act(() => result.current.setActiveTab('groups'));
        expect(mocks.requestGroupInstancesRefresh).toHaveBeenCalledTimes(2);
    });

    it('does not refresh when another tab is selected', () => {
        const { result } = renderHook(() => useSidePanelActiveTab());

        act(() => result.current.setActiveTab('favorite:local'));

        expect(mocks.requestGroupInstancesRefresh).not.toHaveBeenCalled();
    });
});
