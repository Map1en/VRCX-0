import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    controller: vi.fn(),
    hud: vi.fn()
}));

vi.mock('@/components/layout/PageScaffold', () => ({
    PageScaffold: ({ children }: { children: ReactNode }) => (
        <main>{children}</main>
    )
}));

vi.mock('./components/mutual-friends/MutualFriendsHud', () => ({
    MutualFriendsHud: (props: { canFetch: boolean }) => {
        mocks.hud(props);
        return null;
    }
}));

vi.mock('./components/mutual-friends/MutualFriendsLegend', () => ({
    MutualFriendsLegend: () => null
}));

vi.mock('./components/mutual-friends/MutualFriendsNodeCard', () => ({
    MutualFriendsNodeCard: () => null
}));

vi.mock('./components/mutual-friends/MutualFriendsSettingsSheet', () => ({
    MutualFriendsSettingsSheet: () => null
}));

vi.mock('./components/mutual-friends/MutualFriendsStageOverlay', () => ({
    MutualFriendsLayoutBadge: () => null,
    MutualFriendsStageOverlay: () => null
}));

vi.mock('./mutual-friends/useMutualFriendsPageState', () => ({
    useMutualFriendsPageState: mocks.controller
}));

import { MutualFriendsPage } from './MutualFriendsPageImpl';

function controllerValue(currentUserId: string, friendCount: number) {
    const noop = () => undefined;

    return {
        actions: {
            cancelFetch: noop,
            clearFilters: noop,
            clearSelection: noop,
            fetchGraph: noop,
            openNode: noop,
            refreshPage: noop,
            refreshSelectedNode: noop,
            resetLayoutAndHidden: noop,
            setMinDegree: noop,
            setSearchQuery: noop,
            toggleExcludedFriendId: noop,
            toggleFocusedCommunity: noop
        },
        exclusions: {
            excludeSearchQuery: '',
            excludedCount: 0,
            excludedFriendIdSet: new Set<string>(),
            filteredExcludeOptions: [],
            setExcludeSearchQuery: noop
        },
        fetch: {
            fetchProgress: {
                cancelRequested: false,
                isFetching: false,
                processedFriends: 0,
                totalFriends: 0
            }
        },
        graph: {
            baseNodeCount: 0,
            communities: [],
            coverage: {
                friendCount,
                fetchedCount: 0,
                unavailableCount: 0,
                lastFetchedAt: null
            },
            currentUserId,
            detail: '',
            edgeCount: 0,
            friendCount,
            isolatedCounts: { noConnections: 0, unavailable: 0 },
            isLayoutRunning: false,
            nodeCount: 0,
            setGraphElementRef: noop,
            status: 'ready'
        },
        layout: {
            layoutSettings: {},
            setLayoutSetting: noop
        },
        selection: {
            communityIndex: null,
            isRefreshing: false,
            node: null,
            user: null
        },
        view: {
            filters: {
                focusedCommunity: null,
                minDegree: 0,
                searchQuery: ''
            }
        }
    };
}

describe('MutualFriendsPage', () => {
    beforeEach(() => {
        mocks.controller.mockReset();
        mocks.hud.mockReset();
    });

    it('keeps fetch available while a signed-in account has no roster entries yet', () => {
        mocks.controller.mockReturnValue(controllerValue('usr_self', 0));

        renderToStaticMarkup(React.createElement(MutualFriendsPage));

        expect(mocks.hud).toHaveBeenCalledWith(
            expect.objectContaining({ canFetch: true })
        );
    });

    it('keeps fetch unavailable before the signed-in account is known', () => {
        mocks.controller.mockReturnValue(controllerValue('', 0));

        renderToStaticMarkup(React.createElement(MutualFriendsPage));

        expect(mocks.hud).toHaveBeenCalledWith(
            expect.objectContaining({ canFetch: false })
        );
    });
});
