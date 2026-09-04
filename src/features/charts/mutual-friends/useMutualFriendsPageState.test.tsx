// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFriendRosterStore } from '@/state/friendRosterStore';

import { MUTUAL_GRAPH_LAYOUT_DEFAULTS } from './mutualFriendsSettings';
import { useMutualFriendsPageState } from './useMutualFriendsPageState';
import { useMutualFriendsSigmaLifecycle } from './useMutualFriendsSigmaLifecycle';

const mocks = vi.hoisted(() => ({
    snapshotData: {
        snapshot: new Map([['usr_a', ['usr_b']]]),
        meta: new Map()
    }
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));
vi.mock('@/services/dialogService', () => ({ openUserDialog: vi.fn() }));
vi.mock('@/services/themeService', () => ({
    getResolvedThemeMode: () => 'dark'
}));
vi.mock('./useMutualFriendsSnapshot', () => ({
    useMutualFriendsSnapshot: () => ({ snapshotData: mocks.snapshotData })
}));
vi.mock('./useMutualFriendsGraphFetch', () => ({
    useMutualFriendsGraphFetch: () => ({})
}));
vi.mock('./useMutualFriendsLayoutSettings', () => ({
    useMutualFriendsLayoutSettings: () => ({
        layoutSettings: MUTUAL_GRAPH_LAYOUT_DEFAULTS
    })
}));
vi.mock('./useMutualFriendsSigmaLifecycle', () => ({
    useMutualFriendsSigmaLifecycle: vi.fn(() => ({
        isLayoutRunning: false,
        setGraphElementRef: () => {}
    }))
}));

describe('mutual friends graph data dependencies', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('localStorage', {
            getItem: () => null,
            setItem: vi.fn()
        });
        mocks.snapshotData.snapshot = new Map([['usr_a', ['usr_b']]]);
        const store = useFriendRosterStore.getState();
        store.resetRoster();
        for (const id of ['usr_a', 'usr_b', 'usr_outside']) {
            store.applyFriendPatch({
                userId: id,
                patch: {
                    id,
                    displayName: id,
                    state: 'online',
                    status: 'active'
                }
            });
        }
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('keeps layout inputs stable on presence changes while updating selected friend details', () => {
        const { result } = renderHook(useMutualFriendsPageState);
        const lifecycle = vi.mocked(useMutualFriendsSigmaLifecycle);
        const initial = lifecycle.mock.calls[0][0];
        act(() => initial.onSelectNode('usr_a'));

        act(() =>
            useFriendRosterStore.getState().applyFriendPatches([
                { userId: 'usr_outside', patch: { status: 'busy' } },
                {
                    userId: 'usr_a',
                    patch: {
                        location: 'wrld_new:123',
                        state: 'active',
                        status: 'busy'
                    }
                }
            ])
        );

        expect(lifecycle.mock.lastCall?.[0].graph).toBe(initial.graph);
        expect(lifecycle.mock.lastCall?.[0].communityIndexById).toBe(
            initial.communityIndexById
        );
        expect(result.current.selection.user).toMatchObject({
            id: 'usr_a',
            location: 'wrld_new:123',
            state: 'active',
            status: 'busy'
        });
    });

    it('still rebuilds graph inputs when names or cached relationships change', () => {
        const view = renderHook(useMutualFriendsPageState);
        const lifecycle = vi.mocked(useMutualFriendsSigmaLifecycle);
        const initial = lifecycle.mock.calls[0][0].graph;

        act(() =>
            useFriendRosterStore.getState().applyFriendPatch({
                userId: 'usr_a',
                patch: { displayName: 'Renamed Friend' }
            })
        );
        const renamed = lifecycle.mock.lastCall?.[0].graph;
        expect(renamed).not.toBe(initial);
        expect(renamed?.nodes.find((node) => node.id === 'usr_a')?.label).toBe(
            'Renamed Friend'
        );

        mocks.snapshotData.snapshot = new Map([
            ['usr_a', ['usr_b', 'usr_outside']]
        ]);
        view.rerender();
        expect(view.result.current.graph.nodeCount).toBe(3);
        expect(view.result.current.graph.edgeCount).toBe(2);
        expect(lifecycle.mock.lastCall?.[0].graph).not.toBe(renamed);
    });

    it('preserves the username and id fallbacks for graph labels', () => {
        useFriendRosterStore.setState(({ friendsById }) => ({
            friendsById: {
                ...friendsById,
                usr_a: {
                    ...friendsById.usr_a,
                    displayName: '',
                    username: 'a_username'
                },
                usr_b: { ...friendsById.usr_b, displayName: '', username: '' }
            }
        }));
        renderHook(useMutualFriendsPageState);
        const graph = vi.mocked(useMutualFriendsSigmaLifecycle).mock.calls[0][0]
            .graph;
        expect(graph.nodes.map((node) => [node.id, node.label])).toEqual([
            ['usr_a', 'a_username'],
            ['usr_b', 'usr_b']
        ]);
    });
});
