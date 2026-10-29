// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
    FeedFriendActions,
    FeedRow,
    FeedTableInstance
} from '@/components/feed/feedTypes';

vi.mock('@/components/feed/FeedDetailCell', () => ({
    FeedDetailCell: () => <span>detail</span>
}));

vi.mock('@/components/feed/FeedTypeIndicator', () => ({
    FeedTypeIndicator: () => <span>type</span>
}));

vi.mock('@/state/preferencesStore', () => ({
    usePreferencesStore: (
        selector: (state: { tableDensity: 'compact' }) => unknown
    ) => selector({ tableDensity: 'compact' })
}));

vi.mock('./FeedTableParts', () => ({
    FeedExpandedRow: () => <div>expanded detail</div>,
    FeedUserLink: () => <button type="button">user</button>
}));

import { FeedVirtualListShell } from './FeedVirtualListShell';

const actions: FeedFriendActions = {
    canSendInviteFromFeed: false,
    canBoopFromFeed: false,
    isFeedUserHidden: () => false,
    addFeedHiddenUser: async () => undefined,
    removeFeedHiddenUser: async () => undefined,
    canUseFeedFriendLocation: () => false,
    selfInviteFeedFriendLocation: async () => undefined,
    sendFeedFriendInvite: async () => undefined,
    requestFeedFriendInvite: async () => undefined,
    sendFeedFriendBoop: async () => undefined,
    openFeedNewInstance: () => undefined
};

const row: FeedRow = {
    created_at: '2026-09-04T00:00:00.000Z',
    rowId: 1,
    sourceRank: 40,
    statusDescription: 'new',
    previousStatusDescription: 'old',
    type: 'Status',
    userId: 'usr_test'
};

const table = {
    getColumn: (id: string) => ({ id, getSize: () => 120 }),
    getHeaderGroups: () => [{ headers: [] }]
} as unknown as FeedTableInstance;

const onlyType = vi.fn();

const props = {
    actions,
    emptyFilterModel: {
        hasActiveFilters: false,
        onClearFilters: () => undefined
    },
    filterCommands: { onlyType },
    favoritesOnly: false,
    friendLogNamesById: {},
    hasMore: false,
    hasUnloadedLatest: false,
    isFavoritesLoaded: true,
    loadStatus: 'ready',
    loadingOlder: false,
    loadingPreviousInstancesKey: '',
    onLoadOlder: () => undefined,
    onReloadLatest: () => undefined,
    onOpenPreviousInstances: () => undefined,
    onViewingLatestChange: () => undefined,
    resetKey: 'normal',
    rows: [row],
    sourceRows: [row],
    table
} satisfies ComponentProps<typeof FeedVirtualListShell>;

describe('FeedVirtualListShell', () => {
    afterEach(cleanup);

    it('renders the compact summary in time, user, type, detail order', () => {
        const view = render(<FeedVirtualListShell {...props} />);

        const summary = view.container.querySelector(
            '[data-feed-list-summary]'
        );
        expect(summary?.textContent).toMatch(/:\d{2}usertypedetail$/);
    });

    it('renders static labels instead of sortable headers', () => {
        const tableWithSortableDateHeader = {
            ...table,
            getHeaderGroups: () => [
                {
                    headers: [
                        {
                            column: {
                                id: 'created_at',
                                columnDef: {
                                    header: () => (
                                        <button type="button">sort date</button>
                                    )
                                },
                                getIsResizing: () => false,
                                getSize: () => 120
                            },
                            getContext: () => ({
                                table: { setColumnSizing: vi.fn() }
                            })
                        }
                    ]
                }
            ]
        } as unknown as FeedTableInstance;

        render(
            <FeedVirtualListShell
                {...props}
                table={tableWithSortableDateHeader}
            />
        );

        expect(screen.queryByRole('button', { name: 'sort date' })).toBeNull();
        expect(screen.getByText('table.feed.date')).not.toBeNull();
    });

    it('keeps expansion controlled by the row key and ignores nested actions', () => {
        const view = render(<FeedVirtualListShell {...props} />);

        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.feed.actions.expand_entry'
            })
        );
        expect(screen.getByText('expanded detail')).not.toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'user' }));
        expect(screen.getByText('expanded detail')).not.toBeNull();

        view.rerender(
            <FeedVirtualListShell {...props} rows={[]} sourceRows={[]} />
        );
        view.rerender(<FeedVirtualListShell {...props} />);
        expect(screen.queryByText('expanded detail')).toBeNull();
    });

    it('reloads the latest window after newer rows were discarded', () => {
        const onReloadLatest = vi.fn();
        render(
            <FeedVirtualListShell
                {...props}
                hasUnloadedLatest
                onReloadLatest={onReloadLatest}
            />
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.feed.columns.latest'
            })
        );
        expect(onReloadLatest).toHaveBeenCalledOnce();
    });

    it('tells a feed with no history apart from one emptied by filters', () => {
        const onClearFilters = vi.fn();
        const view = render(
            <FeedVirtualListShell {...props} rows={[]} sourceRows={[]} />
        );
        expect(screen.getByText('empty_state.feed_title')).not.toBeNull();
        expect(screen.queryByRole('button')).toBeNull();

        view.rerender(
            <FeedVirtualListShell
                {...props}
                emptyFilterModel={{ hasActiveFilters: true, onClearFilters }}
                rows={[]}
                sourceRows={[]}
            />
        );
        expect(
            screen.getByText(
                'view.feed.empty.no_feed_rows_match_the_current_filters'
            )
        ).not.toBeNull();
        fireEvent.click(
            screen.getByRole('button', {
                name: 'empty_state.clear_search_and_filters'
            })
        );
        expect(onClearFilters).toHaveBeenCalledOnce();
    });

    it('offers type filters from the row context menu', async () => {
        const view = render(<FeedVirtualListShell {...props} />);
        const summary = view.container.querySelector(
            '[data-feed-list-summary]'
        );
        if (!summary) {
            throw new Error('missing summary row');
        }

        fireEvent.contextMenu(summary);
        fireEvent.click(
            await screen.findByRole('menuitem', {
                name: 'table.filter_action.only_type'
            })
        );

        expect(onlyType).toHaveBeenCalledWith('Status');
    });
});
