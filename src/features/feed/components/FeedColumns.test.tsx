// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
    const translate = (key: string) => key;
    return {
        useTranslation: () => ({ t: translate })
    };
});

vi.mock('./FeedTableParts', () => ({
    FeedDetailCell: () => null,
    FeedUserLink: () => null,
    SortButton: () => null,
    formatTimestampLong: () => '',
    formatTimestampParts: () => ({ date: '', time: '' })
}));

vi.mock('./FeedTypeIndicator', () => ({
    FeedTypeIndicator: () => null
}));

import type { FeedFriendActions, FeedRow, FeedTableMeta } from '../feedTypes';
import { useFeedColumns } from './FeedColumns';

function createActions(): FeedFriendActions {
    return {
        canSendInviteFromFeed: false,
        canBoopFromFeed: false,
        isFeedUserHidden: () => false,
        addFeedHiddenUser: async () => {},
        removeFeedHiddenUser: async () => {},
        canUseFeedFriendLocation: () => false,
        launchFeedFriendLocation: async () => {},
        selfInviteFeedFriendLocation: async () => {},
        sendFeedFriendInvite: async () => {},
        requestFeedFriendInvite: async () => {},
        sendFeedFriendBoop: async () => {},
        openFeedNewInstance: () => {}
    };
}

function createMeta(): FeedTableMeta {
    return {
        actions: createActions(),
        friendLogNamesById: {},
        knownUsersById: {},
        loadingPreviousInstancesKey: '',
        onOpenPreviousInstances: () => {}
    };
}

describe('useFeedColumns', () => {
    it('keeps the columns array reference stable when meta contents change', () => {
        const meta = createMeta();
        const { result, rerender } = renderHook(() => useFeedColumns(meta));
        const initialColumns = result.current;

        meta.friendLogNamesById = { usr_1: 'Alice' };
        meta.loadingPreviousInstancesKey = 'wrld_1';
        meta.actions = createActions();
        rerender();

        expect(result.current).toBe(initialColumns);
    });

    it('reads mutated meta through the displayName accessor', () => {
        const meta = createMeta();
        const { result } = renderHook(() => useFeedColumns(meta));
        const displayName = result.current.find(
            (column) => column.id === 'displayName'
        );
        const row: FeedRow = { userId: 'usr_1' };
        const readDisplayName = () =>
            displayName && 'accessorFn' in displayName
                ? displayName.accessorFn(row, 0)
                : undefined;

        meta.friendLogNamesById = { usr_1: 'Alice' };
        expect(readDisplayName()).toBe('Alice');

        meta.friendLogNamesById = { usr_1: 'Bob' };
        expect(readDisplayName()).toBe('Bob');
    });
});
