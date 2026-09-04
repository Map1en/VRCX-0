// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
    FeedFriendActions,
    FeedRow,
    FeedTableInstance
} from '@/components/feed/feedTypes';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/components/feed/FeedDetailCell', () => ({
    FeedDetailCell: () => <span>detail</span>
}));

vi.mock('@/components/feed/FeedLocationLink', () => ({
    FeedLocationLink: () => <span>world</span>
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
    FeedUserLink: () => <button type="button">user</button>,
    formatTimestampLong: () => 'long time',
    formatTimestampParts: () => ({ date: 'time', time: '' })
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
    getColumn: () => ({ getSize: () => 120 }),
    getHeaderGroups: () => [{ headers: [] }]
} as unknown as FeedTableInstance;

const props = {
    actions,
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
    sorting: [],
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
        expect(summary?.textContent).toContain('timeusertypedetail');
        expect(summary?.className).toContain(
            'h-[var(--vrcx-0-table-row-height)]'
        );
        expect(summary?.className).not.toContain(
            'min-h-[var(--vrcx-0-table-row-height)]'
        );
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
});
