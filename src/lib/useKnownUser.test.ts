// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type RuntimeAuthState = {
    auth: {
        currentUserEndpoint: string;
        currentUserId: string;
        currentUserSnapshot: null;
    };
};

const runtimeState: RuntimeAuthState = {
    auth: {
        currentUserEndpoint: 'https://api.vrchat.cloud',
        currentUserId: '',
        currentUserSnapshot: null
    }
};

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: (selector: (state: RuntimeAuthState) => unknown) =>
        selector(runtimeState)
}));

import { useUserFactsStore } from '@/state/userFactsStore';

import { useKnownUserFacts } from './useKnownUser';

const endpoint = runtimeState.auth.currentUserEndpoint;

function replaceFact(userId: string, displayName: string) {
    act(() => {
        useUserFactsStore.getState().replaceUserFacts([
            {
                id: userId,
                endpoint,
                displayName
            }
        ]);
    });
}

describe('useKnownUserFacts', () => {
    beforeEach(() => {
        useUserFactsStore.getState().resetUserFacts();
    });

    it('resolves facts for the requested user ids', () => {
        replaceFact('usr_1', 'Alice');
        const userIds = ['usr_1', 'usr_2'];
        const { result } = renderHook(() => useKnownUserFacts(userIds));

        expect(result.current.usr_1?.displayName).toBe('Alice');
        expect(result.current.usr_2).toBeUndefined();
    });

    it('does not re-render when unrelated user facts change', () => {
        replaceFact('usr_1', 'Alice');
        const userIds = ['usr_1'];
        let renderCount = 0;
        const { result } = renderHook(() => {
            renderCount += 1;
            return useKnownUserFacts(userIds);
        });

        replaceFact('usr_other', 'Someone');

        expect(renderCount).toBe(1);
        expect(result.current.usr_1?.displayName).toBe('Alice');
    });

    it('re-renders when a requested user fact changes', () => {
        replaceFact('usr_1', 'Alice');
        const userIds = ['usr_1'];
        const { result } = renderHook(() => useKnownUserFacts(userIds));

        replaceFact('usr_1', 'Alicia');

        expect(result.current.usr_1?.displayName).toBe('Alicia');
    });
});
