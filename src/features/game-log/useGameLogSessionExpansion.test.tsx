// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { getGameLogSessionKey } from './gameLogRows';
import type { GameLogSession } from './gameLogTypes';
import { useGameLogSessionExpansion } from './useGameLogSessionExpansion';

function session(id: number): GameLogSession {
    return {
        id,
        created_at: '2026-09-03T00:00:00.000Z',
        duration: 0,
        location: `wrld_test:${id}`,
        worldId: 'wrld_test',
        worldName: 'Test World',
        groupName: '',
        playerDurationRows: [],
        events: []
    };
}

describe('useGameLogSessionExpansion', () => {
    afterEach(cleanup);

    it('keeps newly loaded sessions collapsed after collapse all', () => {
        const { result, rerender } = renderHook(
            ({ sessions }) => useGameLogSessionExpansion(sessions, true),
            { initialProps: { sessions: [session(1), session(2)] } }
        );

        expect(result.current.allSessionsOpen).toBe(true);
        act(() => result.current.toggleAll());
        expect(result.current.defaultOpen).toBe(false);

        rerender({ sessions: [session(1), session(2), session(3)] });
        expect(result.current.allSessionsOpen).toBe(false);
        expect(result.current.defaultOpen).toBe(false);
        expect(result.current.sessionOpenOverrides.size).toBe(0);

        act(() =>
            result.current.onSessionOpenChange(
                getGameLogSessionKey(session(1)),
                true
            )
        );
        expect(result.current.allSessionsOpen).toBe(false);
        act(() => result.current.toggleAll());
        expect(result.current.defaultOpen).toBe(true);
        expect(result.current.allSessionsOpen).toBe(true);
        expect(result.current.sessionOpenOverrides.size).toBe(0);
    });

    it('expands all when only some sessions are closed', () => {
        const sessions = [session(1), session(2)];
        const { result } = renderHook(() =>
            useGameLogSessionExpansion(sessions, true)
        );

        act(() =>
            result.current.onSessionOpenChange(
                getGameLogSessionKey(sessions[0]),
                false
            )
        );
        expect(result.current.defaultOpen).toBe(true);
        expect(result.current.allSessionsOpen).toBe(false);
        act(() => result.current.toggleAll());
        expect(result.current.allSessionsOpen).toBe(true);
        expect(result.current.sessionOpenOverrides.size).toBe(0);
    });

    it('resets transient expansion when the sessions view is removed', () => {
        const sessions = [session(1), session(2)];
        const { result, rerender } = renderHook(
            ({ active }) => useGameLogSessionExpansion(sessions, active),
            { initialProps: { active: true } }
        );

        act(() => result.current.toggleAll());
        act(() =>
            result.current.onSessionOpenChange(
                getGameLogSessionKey(sessions[0]),
                true
            )
        );
        rerender({ active: false });
        rerender({ active: true });
        expect(result.current.defaultOpen).toBe(true);
        expect(result.current.allSessionsOpen).toBe(true);
        expect(result.current.sessionOpenOverrides.size).toBe(0);
    });
});
