// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), knownUsers: {} }));

vi.mock('@/repositories/vrchatFriendRepository', () => ({
    default: { getUser: mocks.getUser }
}));
vi.mock('@/lib/useKnownUser', () => ({
    useKnownUserFacts: () => mocks.knownUsers
}));

import type { UserProfileRecord } from '@/domain/entities/user';
import { clearEntityQueryCache, queryKeys } from '@/lib/entityQueryCache';
import { queryClient } from '@/lib/queryClient';

import { usePlayerListProfileData } from './usePlayerListProfileData';

function Wrapper({ children }: PropsWithChildren) {
    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
}

afterEach(async () => {
    cleanup();
    await clearEntityQueryCache();
    mocks.getUser.mockReset();
});

describe('usePlayerListProfileData', () => {
    it('reuses normalized query profiles across renders and follows cache updates', async () => {
        mocks.getUser.mockResolvedValue({
            json: {
                id: 'usr_one',
                displayName: 'One',
                tags: ['system_trust_basic'],
                bioLinks: ['https://example.com']
            }
        });
        const props = {
            currentUserId: 'usr_self',
            playerSourceRows: [{ userId: 'usr_one' }]
        };
        const view = renderHook((input) => usePlayerListProfileData(input), {
            initialProps: props,
            wrapper: Wrapper
        });
        await waitFor(() =>
            expect(view.result.current.profilesByUserId.usr_one).toBeDefined()
        );
        const key = queryKeys.user('usr_one');
        const cached = queryClient.getQueryData<UserProfileRecord>(key);
        expect(view.result.current.profilesByUserId.usr_one).toBe(cached);
        view.rerender({
            ...props,
            playerSourceRows: [...props.playerSourceRows]
        });
        expect(view.result.current.profilesByUserId.usr_one).toBe(cached);
        expect(mocks.getUser).toHaveBeenCalledTimes(1);
        act(() => {
            queryClient.setQueryData<UserProfileRecord>(key, (current) =>
                current ? { ...current, statusDescription: 'updated' } : current
            );
        });
        await waitFor(() =>
            expect(
                view.result.current.profilesByUserId.usr_one?.statusDescription
            ).toBe('updated')
        );
        expect(view.result.current.profilesByUserId.usr_one?.bioLinks).toBe(
            cached?.bioLinks
        );
        expect(view.result.current.profilesByUserId.usr_one?.tags).toBe(
            cached?.tags
        );
    });
});
