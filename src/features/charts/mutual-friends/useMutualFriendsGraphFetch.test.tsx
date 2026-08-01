// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    bootstrapFriendRoster: vi.fn(),
    cancelMutualGraphFetch: vi.fn(),
    startMutualGraphFetch: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

vi.mock('sonner', () => ({
    toast: {
        error: mocks.toastError,
        info: mocks.toastInfo
    }
}));

vi.mock('@/services/friendBootstrapService', () => ({
    bootstrapFriendRoster: mocks.bootstrapFriendRoster
}));

vi.mock('@/services/mutualGraphFetchService', () => ({
    cancelMutualGraphFetch: mocks.cancelMutualGraphFetch,
    startMutualGraphFetch: mocks.startMutualGraphFetch
}));

import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { useMutualFriendsGraphFetch } from './useMutualFriendsGraphFetch';

const ENDPOINT = 'https://api.example.test';
const WEBSOCKET = 'wss://pipeline.example.test';

function renderGraphFetch() {
    return renderHook(() =>
        useMutualFriendsGraphFetch({
            currentUserId: 'usr_self',
            reloadSnapshot: vi.fn(),
            setDetail: vi.fn()
        })
    );
}

function setLoadedFriendRoster(): void {
    useFriendRosterStore.getState().setRosterSnapshot({
        currentUserId: 'usr_self',
        friendsById: {
            usr_friend: {
                id: 'usr_friend',
                displayName: 'Friend',
                stateBucket: 'offline'
            }
        }
    });
}

describe('useMutualFriendsGraphFetch', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useFriendRosterStore.getState().resetRoster();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: ENDPOINT,
            currentUserWebsocket: WEBSOCKET,
            currentUserSnapshot: {
                id: 'usr_self'
            }
        });
        mocks.startMutualGraphFetch.mockResolvedValue(undefined);
    });

    it('loads the friend roster before starting an empty mutual graph fetch', async () => {
        mocks.bootstrapFriendRoster.mockImplementation(async () => {
            setLoadedFriendRoster();
        });
        const { result } = renderGraphFetch();

        await act(async () => {
            await result.current.handleFetchGraph();
        });

        expect(mocks.bootstrapFriendRoster).toHaveBeenCalledWith({
            userId: 'usr_self',
            endpoint: ENDPOINT,
            websocket: WEBSOCKET,
            currentUserSnapshot: {
                id: 'usr_self'
            }
        });
        expect(mocks.startMutualGraphFetch).toHaveBeenCalledWith({
            ownerUserId: 'usr_self',
            endpoint: ENDPOINT,
            friendIds: ['usr_friend']
        });
        expect(
            mocks.bootstrapFriendRoster.mock.invocationCallOrder[0]
        ).toBeLessThan(mocks.startMutualGraphFetch.mock.invocationCallOrder[0]);
    });

    it('starts immediately when the friend roster is already available', async () => {
        setLoadedFriendRoster();
        const roster = useFriendRosterStore.getState();
        expect(roster.orderedFriendIds).toEqual(['usr_friend']);
        const { result } = renderGraphFetch();

        await act(async () => {
            await result.current.handleFetchGraph();
        });

        expect(mocks.bootstrapFriendRoster).not.toHaveBeenCalled();
        expect(mocks.startMutualGraphFetch).toHaveBeenCalledWith({
            ownerUserId: 'usr_self',
            endpoint: ENDPOINT,
            friendIds: ['usr_friend']
        });
    });

    it('starts only once when friend loading is requested twice', async () => {
        let finishBootstrap = () => undefined;
        mocks.bootstrapFriendRoster.mockReturnValue(
            new Promise<void>((resolve) => {
                finishBootstrap = () => {
                    setLoadedFriendRoster();
                    resolve();
                };
            })
        );
        const { result } = renderGraphFetch();
        let firstFetch = Promise.resolve();
        let secondFetch = Promise.resolve();

        act(() => {
            firstFetch = result.current.handleFetchGraph();
            secondFetch = result.current.handleFetchGraph();
        });

        expect(mocks.bootstrapFriendRoster).toHaveBeenCalledTimes(1);

        await act(async () => {
            finishBootstrap();
            await Promise.all([firstFetch, secondFetch]);
        });

        expect(mocks.startMutualGraphFetch).toHaveBeenCalledTimes(1);
    });

    it('drops an old bootstrap failure after the account changes', async () => {
        mocks.bootstrapFriendRoster.mockImplementation(async () => {
            useRuntimeStore.getState().setAuthBootstrap({
                currentUserId: 'usr_other',
                currentUserEndpoint: 'https://other.example.test',
                currentUserWebsocket: 'wss://other.example.test'
            });
            throw new Error('stale bootstrap');
        });
        const { result } = renderGraphFetch();

        await act(async () => {
            await result.current.handleFetchGraph();
        });

        expect(mocks.startMutualGraphFetch).not.toHaveBeenCalled();
        expect(mocks.toastError).not.toHaveBeenCalled();
    });
});
