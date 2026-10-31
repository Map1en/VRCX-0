// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { NotificationRow } from './notificationPageTypes';
import { useSessionUnreadKeys } from './notificationSessionUnread';

afterEach(cleanup);

describe('useSessionUnreadKeys', () => {
    it('keeps rows highlighted for the session after they are marked seen', () => {
        const unread: NotificationRow = {
            id: 'not_1',
            type: 'friendRequest',
            version: 1,
            seen: false
        };
        const { result, rerender } = renderHook(
            ({ rows }) => useSessionUnreadKeys(rows),
            { initialProps: { rows: [unread] } }
        );
        expect(result.current.has('not_1')).toBe(true);

        rerender({ rows: [{ ...unread, seen: true }] });

        expect(result.current.has('not_1')).toBe(true);
    });
});
