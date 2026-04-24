import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    NOTIFICATION_TABLE_DEFAULT_SORTING,
    normalizeNotificationColumnId,
    readPersistedNotificationTableState,
    resolveNotificationPageSize,
    safeJsonParse,
    sanitizeNotificationColumnOrder,
    sanitizeNotificationColumnSizing,
    sanitizeNotificationColumnVisibility,
    sanitizeNotificationFilters,
    sanitizeNotificationSorting,
    writePersistedNotificationTableState
} from './notificationTableState.js';

function installLocalStorage(initial = {}) {
    const values = new Map(
        Object.entries(initial).map(([key, value]) => [key, String(value)])
    );
    const localStorage = {
        getItem: vi.fn((key) => values.get(key) ?? null),
        setItem: vi.fn((key, value) => {
            values.set(key, String(value));
        })
    };
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { localStorage }
    });
    return { localStorage, values };
}

describe('notification table state helpers', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-02T03:04:05Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        delete globalThis.window;
    });

    it('parses persisted JSON safely', () => {
        expect(safeJsonParse('{"pageSize":25}')).toEqual({ pageSize: 25 });
        expect(safeJsonParse('bad json')).toBeNull();
        expect(safeJsonParse('')).toBeNull();
    });

    it('reads and writes persisted table state without dropping existing keys', () => {
        const { localStorage, values } = installLocalStorage({
            'vrcx:table:notifications': JSON.stringify({ pageSize: 25 })
        });

        expect(readPersistedNotificationTableState()).toEqual({ pageSize: 25 });
        writePersistedNotificationTableState({
            sorting: [{ id: 'type', desc: false }]
        });

        expect(localStorage.setItem).toHaveBeenCalledWith(
            'vrcx:table:notifications',
            expect.any(String)
        );
        expect(JSON.parse(values.get('vrcx:table:notifications'))).toEqual({
            pageSize: 25,
            sorting: [{ id: 'type', desc: false }],
            updatedAt: new Date('2026-01-02T03:04:05Z').getTime()
        });
    });

    it('ignores unavailable browser storage for optional table state', () => {
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

        expect(readPersistedNotificationTableState()).toEqual({});
        expect(() =>
            writePersistedNotificationTableState({ pageSize: 10 })
        ).not.toThrow();
    });

    it('normalizes legacy column ids and keeps only sortable notification columns', () => {
        expect(normalizeNotificationColumnId('createdAt')).toBe('created_at');
        expect(normalizeNotificationColumnId('sender')).toBe('senderUsername');
        expect(
            sanitizeNotificationSorting([
                { id: 'createdAt', desc: true },
                { id: 'sender', desc: false },
                { id: 'message', desc: true }
            ])
        ).toEqual([
            { id: 'created_at', desc: true },
            { id: 'senderUsername', desc: false }
        ]);
        expect(
            sanitizeNotificationSorting([{ id: 'message', desc: true }])
        ).toBe(NOTIFICATION_TABLE_DEFAULT_SORTING);
    });

    it('sanitizes filters, column visibility, order, sizing, and page size', () => {
        const allowedTypes = ['invite', 'message'];

        expect(
            sanitizeNotificationFilters(
                ['invite', 'unknown', 'message'],
                allowedTypes
            )
        ).toEqual(['invite', 'message']);
        expect(
            sanitizeNotificationColumnVisibility({
                createdAt: false,
                sender: true,
                missing: false,
                message: 'yes'
            })
        ).toEqual({
            created_at: false,
            senderUsername: true
        });
        expect(
            sanitizeNotificationColumnOrder([
                'sender',
                'senderUsername',
                'message',
                'missing'
            ])
        ).toEqual(['senderUsername', 'message']);
        expect(
            sanitizeNotificationColumnSizing({
                createdAt: 120,
                message: '240',
                missing: 50,
                type: -1
            })
        ).toEqual({
            created_at: 120,
            message: 240
        });
        expect(resolveNotificationPageSize(50)).toBe(50);
        expect(resolveNotificationPageSize('bad')).toBe(20);
    });
});
