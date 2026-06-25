import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getDataTableStorageKey,
    readPersistedTableState,
    sanitizeTableColumnSizing,
    safeJsonParse,
    writePersistedTableState
} from './dataTablePersistence';

function installLocalStorage(initial: any = {}) {
    const values = new Map(
        Object.entries(initial).map(([key, value]: any) => [key, String(value)])
    );
    const localStorage: any = {
        getItem: vi.fn((key: any) => values.get(key) ?? null),
        setItem: vi.fn((key: any, value: any) => {
            values.set(key, String(value));
        })
    };
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { localStorage }
    });
    return { localStorage, values };
}

describe('data table persistence helpers', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-03T04:05:06Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        Reflect.deleteProperty(globalThis, 'window');
    });

    it('uses the vrcx-0 table namespace for generated storage keys', () => {
        expect(getDataTableStorageKey('feed')).toBe('vrcx-0:table:feed');
    });

    it('safely reads persisted table state', () => {
        installLocalStorage({
            'vrcx-0:table:feed': JSON.stringify({ pageSize: 25 }),
            'vrcx-0:table:bad': '{not-json'
        });

        expect(safeJsonParse('{"sorting":[]}')).toEqual({ sorting: [] });
        expect(safeJsonParse('bad')).toBeNull();
        expect(safeJsonParse('')).toBeNull();
        expect(readPersistedTableState('vrcx-0:table:feed')).toEqual({
            pageSize: 25
        });
        expect(readPersistedTableState('vrcx-0:table:bad')).toEqual({});
        expect(readPersistedTableState('')).toEqual({});
    });

    it('writes patch data without losing existing persisted fields', () => {
        const { localStorage, values } = installLocalStorage({
            'vrcx-0:table:feed': JSON.stringify({
                pageSize: 25,
                columnVisibility: { detail: false }
            })
        });

        writePersistedTableState('vrcx-0:table:feed', {
            columnSizing: { detail: 320 }
        });

        expect(localStorage.setItem).toHaveBeenCalledWith(
            'vrcx-0:table:feed',
            expect.any(String)
        );
        expect(JSON.parse(values.get('vrcx-0:table:feed') ?? '')).toEqual({
            pageSize: 25,
            columnVisibility: { detail: false },
            columnSizing: { detail: 320 },
            updatedAt: new Date('2026-02-03T04:05:06Z').getTime()
        });
    });

    it('filters column sizing to known positive finite widths', () => {
        expect(
            sanitizeTableColumnSizing(
                {
                    expander: 40,
                    detail: '320',
                    bad: 50,
                    type: -1,
                    displayName: 0,
                    created_at: Number.NaN
                },
                ['expander', 'detail', 'type', 'displayName', 'created_at']
            )
        ).toEqual({
            expander: 40,
            detail: 320
        });
    });

    it('treats localStorage failures as optional table state', () => {
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                localStorage: {
                    getItem() {
                        throw new Error('storage blocked');
                    },
                    setItem() {
                        throw new Error('storage blocked');
                    }
                }
            }
        });

        expect(readPersistedTableState('vrcx-0:table:feed')).toEqual({});
        expect(() =>
            writePersistedTableState('vrcx-0:table:feed', { pageSize: 10 })
        ).not.toThrow();
    });
});
