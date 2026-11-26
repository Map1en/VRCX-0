// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    config: new Map<string, string>()
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getString: vi.fn(
            async (key: string, fallback: string) =>
                mocks.config.get(key) ?? fallback
        ),
        getRawValue: vi.fn(
            async (key: string) => mocks.config.get(key) ?? null
        ),
        setString: vi.fn(async () => null),
        remove: vi.fn(async (key: string) => {
            mocks.config.delete(key);
            return 1;
        })
    }
}));

import {
    STORAGE_KEYS,
    readStoredText,
    writeStoredText
} from '@/lib/browserStorage';

import { useMyAvatarsFilters } from './useMyAvatarsFilters';

describe('useMyAvatarsFilters grid density', () => {
    beforeEach(() => {
        localStorage.clear();
        mocks.config.clear();
    });

    it('reads the grid density from browser storage', () => {
        writeStoredText(STORAGE_KEYS.myAvatarsGridDensity, 'compact');

        const { result } = renderHook(() => useMyAvatarsFilters());

        expect(result.current.gridDensity).toBe('compact');
    });

    it('moves a density left in the database into browser storage', async () => {
        mocks.config.set('VRCX_MyAvatarsCardScale', '0.4');
        mocks.config.set('VRCX_MyAvatarsCardSpacing', '12');
        mocks.config.set('MyAvatarsViewMode', 'table');

        const { result } = renderHook(() => useMyAvatarsFilters());

        await waitFor(() => expect(result.current.gridDensity).toBe('dense'));
        expect(readStoredText(STORAGE_KEYS.myAvatarsGridDensity)).toBe('dense');
        await waitFor(() =>
            expect([...mocks.config.keys()]).toEqual(['MyAvatarsViewMode'])
        );
        expect(result.current.viewMode).toBe('table');
    });

    it('saves density changes to browser storage', () => {
        const { result } = renderHook(() => useMyAvatarsFilters());

        act(() => result.current.handleGridDensityChange('dense'));

        expect(readStoredText(STORAGE_KEYS.myAvatarsGridDensity)).toBe('dense');
    });
});
