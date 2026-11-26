// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    gpsFeedEntry,
    onlineFeedEntry
} from '@/components/feed/feedLiveTestEntries';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFeedLiveStore } from '@/state/feedLiveStore';
import type { FeedLiveEntry } from '@/state/feedLiveTypes';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

vi.unmock('react-i18next');

const mocks = vi.hoisted(() => ({
    queryFeedLatest: vi.fn()
}));

vi.mock('@/repositories/feedRepository', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/repositories/feedRepository')>()),
    default: {
        queryFeedLatest: mocks.queryFeedLatest
    }
}));

import { DashboardFeedWidget } from './DashboardFeedWidget';

const initialRuntimeState = useRuntimeStore.getInitialState();
const initialFeedLiveState = useFeedLiveStore.getInitialState();
const initialFavoriteState = useFavoriteStore.getInitialState();
const initialFriendRosterState = useFriendRosterStore.getInitialState();
const initialPreferencesState = usePreferencesStore.getInitialState();
const initialSessionState = useSessionStore.getInitialState();

function setDashboardFeedStoreState({
    currentUserId,
    liveFeedEntries = [],
    liveFeedVersion = 0,
    favoriteFriendIds = [],
    feedPersistenceDisabled = false
}: {
    currentUserId: string;
    liveFeedEntries?: FeedLiveEntry[];
    liveFeedVersion?: number;
    favoriteFriendIds?: string[];
    feedPersistenceDisabled?: boolean;
}) {
    const runtimeState = useRuntimeStore.getState();
    useRuntimeStore.setState({
        auth: { ...runtimeState.auth, currentUserId },
        runtimeEvents: {
            ...runtimeState.runtimeEvents,
            addGameLogEvent: {
                ...runtimeState.runtimeEvents.addGameLogEvent,
                count: 0
            }
        }
    });
    useFeedLiveStore.setState({
        entries: liveFeedEntries,
        patches: [],
        version: liveFeedVersion
    });
    useFavoriteStore.setState({ favoriteFriendIds });
    useFriendRosterStore.setState({ friendsById: {} });
    usePreferencesStore.setState({ feedPersistenceDisabled });
}

describe('DashboardFeedWidget', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
        useRuntimeStore.setState(initialRuntimeState);
        useFeedLiveStore.setState(initialFeedLiveState);
        useFavoriteStore.setState(initialFavoriteState);
        useFriendRosterStore.setState(initialFriendRosterState);
        usePreferencesStore.setState(initialPreferencesState);
        useSessionStore.setState(initialSessionState);
    });

    it('shows the unavailable state without a signed-in user', () => {
        setDashboardFeedStoreState({ currentUserId: '' });

        const html = renderToStaticMarkup(
            <MemoryRouter>
                <DashboardFeedWidget config={{}} configUpdater={null} />
            </MemoryRouter>
        );

        expect(html).toContain('Feed unavailable');
    });

    it('loads the Rust cache and overlays session deltas when persistence is disabled', async () => {
        mocks.queryFeedLatest.mockResolvedValue({ rows: [], maxSequence: 0 });
        setDashboardFeedStoreState({
            currentUserId: 'usr_self',
            liveFeedEntries: [
                {
                    sequence: 1,
                    ownerUserId: 'usr_self',
                    entry: onlineFeedEntry({
                        userId: 'usr_friend',
                        displayName: 'Friend'
                    })
                }
            ],
            liveFeedVersion: 1,
            feedPersistenceDisabled: true
        });

        render(
            <MemoryRouter>
                <DashboardFeedWidget config={{}} configUpdater={null} />
            </MemoryRouter>
        );

        await waitFor(() => expect(mocks.queryFeedLatest).toHaveBeenCalled());

        expect(mocks.queryFeedLatest).toHaveBeenCalledWith({
            userId: 'usr_self',
            filters: [],
            excludedFavoriteUserIds: [],
            locationHiddenUserIds: [],
            favoriteUserIds: [],
            favoritesOnly: false,
            maxRows: 100
        });
        expect(screen.getByText('Friend')).toBeTruthy();
        expect(
            screen.getByRole('img', {
                name: 'Feed history is not being saved'
            })
        ).toBeTruthy();
    });

    it('hides live location changes of hidden friends but keeps their other activity', async () => {
        mocks.queryFeedLatest.mockResolvedValue({ rows: [], maxSequence: 0 });
        setDashboardFeedStoreState({
            currentUserId: 'usr_self',
            liveFeedEntries: [
                {
                    sequence: 1,
                    ownerUserId: 'usr_self',
                    entry: gpsFeedEntry({
                        userId: 'usr_hidden',
                        displayName: 'Hidden Traveler'
                    })
                },
                {
                    sequence: 2,
                    ownerUserId: 'usr_self',
                    entry: onlineFeedEntry({
                        userId: 'usr_hidden',
                        displayName: 'Hidden Online'
                    })
                }
            ],
            liveFeedVersion: 2
        });
        usePreferencesStore.setState({ feedHiddenUsers: ['usr_hidden'] });

        render(
            <MemoryRouter>
                <DashboardFeedWidget config={{}} configUpdater={null} />
            </MemoryRouter>
        );

        await waitFor(() =>
            expect(screen.getByText('Hidden Online')).toBeTruthy()
        );
        expect(mocks.queryFeedLatest).toHaveBeenCalledWith(
            expect.objectContaining({ locationHiddenUserIds: ['usr_hidden'] })
        );
        expect(screen.queryByText('Hidden Traveler')).toBeNull();
    });

    it('limits rows to friends in the selected favorite groups when grouped friends only is on', async () => {
        mocks.queryFeedLatest.mockResolvedValue({ rows: [], maxSequence: 0 });
        setDashboardFeedStoreState({
            currentUserId: 'usr_self',
            liveFeedEntries: [
                {
                    sequence: 1,
                    ownerUserId: 'usr_self',
                    entry: onlineFeedEntry({
                        userId: 'usr_grouped',
                        displayName: 'Grouped Friend'
                    })
                },
                {
                    sequence: 2,
                    ownerUserId: 'usr_self',
                    entry: onlineFeedEntry({
                        userId: 'usr_other',
                        displayName: 'Other Friend'
                    })
                }
            ],
            liveFeedVersion: 2
        });
        useFavoriteStore.setState({
            favoriteFriendGroups: [
                {
                    key: 'group_0',
                    name: 'group_0',
                    displayName: 'Group 0',
                    type: 'friend',
                    visibility: 'private',
                    capacity: 150,
                    count: 1
                },
                {
                    key: 'group_1',
                    name: 'group_1',
                    displayName: 'Group 1',
                    type: 'friend',
                    visibility: 'private',
                    capacity: 150,
                    count: 1
                }
            ],
            groupedFavoriteFriendIdsByGroupKey: {
                group_0: ['usr_grouped'],
                group_1: ['usr_other']
            }
        });
        usePreferencesStore.setState({
            localFavoriteFriendsGroups: ['group_0']
        });
        useSessionStore.setState({ isFavoritesLoaded: true });

        render(
            <MemoryRouter>
                <DashboardFeedWidget
                    config={{ favoritesOnly: true }}
                    configUpdater={null}
                />
            </MemoryRouter>
        );

        await waitFor(() =>
            expect(screen.getByText('Grouped Friend')).toBeTruthy()
        );
        expect(mocks.queryFeedLatest).toHaveBeenCalledWith(
            expect.objectContaining({
                favoriteUserIds: ['usr_grouped'],
                favoritesOnly: true
            })
        );
        expect(screen.queryByText('Other Friend')).toBeNull();
    });

    it('groups compact feed rows by day instead of repeating the date per row', async () => {
        mocks.queryFeedLatest.mockResolvedValue({
            rows: [
                {
                    id: 'feed-1',
                    type: 'Online',
                    created_at: '2026-08-12T11:37:00.000Z',
                    userId: 'usr_one',
                    displayName: 'One'
                },
                {
                    id: 'feed-2',
                    type: 'Offline',
                    created_at: '2026-08-12T10:30:00.000Z',
                    userId: 'usr_two',
                    displayName: 'Two'
                },
                {
                    id: 'feed-3',
                    type: 'Online',
                    created_at: '2026-08-11T09:00:00.000Z',
                    userId: 'usr_three',
                    displayName: 'Three'
                }
            ],
            maxSequence: 3
        });
        setDashboardFeedStoreState({
            currentUserId: 'usr_self',
            favoriteFriendIds: ['usr_one']
        });

        const view = render(
            <MemoryRouter>
                <DashboardFeedWidget config={{}} configUpdater={null} />
            </MemoryRouter>
        );

        await waitFor(() => expect(screen.getByText('Three')).toBeTruthy());

        expect(
            view.container.querySelectorAll('[data-dashboard-widget-day]')
        ).toHaveLength(2);
        expect(
            view.container.querySelector('[aria-label="Favorite"]')
        ).toBeTruthy();
        const statusDots = view.container.querySelectorAll(
            '[data-dashboard-feed-status-dot]'
        );
        expect(statusDots).toHaveLength(2);
        expect(screen.queryByText('Favorite')).toBeNull();
    });
});
