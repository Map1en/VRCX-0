// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    loadCurrentInstanceRoster: vi.fn(),
    recordGameRuntimePresence: vi.fn()
}));

vi.mock('@/services/currentInstanceRosterService', () => ({
    loadCurrentInstanceRoster: mocks.loadCurrentInstanceRoster
}));

vi.mock('@/services/domainIngestionService', () => ({
    recordGameRuntimePresence: mocks.recordGameRuntimePresence
}));

import { useCurrentInstanceRoster } from './useCurrentInstanceRoster';

const CURRENT_USER_SNAPSHOT = {
    id: 'usr_self',
    displayName: 'Current User'
};

type Snapshot = Awaited<
    ReturnType<
        typeof import('@/services/currentInstanceRosterService').loadCurrentInstanceRoster
    >
>;

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}

function snapshot(
    location: string,
    displayName: string,
    source: 'runtime' = 'runtime'
): Snapshot {
    return {
        context: {
            createdAt: '2026-08-01T01:00:00.000Z',
            groupName: '',
            location,
            playerCount: 1,
            playerFactsKnown: true,
            source,
            time: 0,
            worldId: 'wrld_test',
            worldName: ''
        },
        players: [
            {
                id: 'usr_self',
                userId: 'usr_self',
                displayName: 'Current User',
                joinedAt: '2026-08-01T01:00:00.000Z',
                joinedAtMs: Date.parse('2026-08-01T01:00:00.000Z')
            },
            {
                id: 'usr_player',
                userId: 'usr_player',
                displayName,
                joinedAt: '2026-08-01T01:00:00.000Z',
                joinedAtMs: Date.parse('2026-08-01T01:00:00.000Z')
            }
        ]
    };
}

function props(location: string) {
    return {
        currentUserEndpoint: 'https://api.vrchat.cloud/api/1',
        currentUserId: 'usr_self',
        currentUserSnapshot: CURRENT_USER_SNAPSHOT,
        isGameRunning: true,
        logLocationSnapshot: null,
        playerListLocation: location,
        playerListStartedAt: '2026-08-01T00:00:00.000Z',
        playerListWorldId: 'wrld_test'
    };
}

describe('useCurrentInstanceRoster', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads on mount and fans the reconstructed roster into domain ingestion', async () => {
        const loadedSnapshot = snapshot('wrld_test:1', 'Player One');
        loadedSnapshot.players[0] = {
            id: 'display:Current User',
            userId: '',
            displayName: 'Current User',
            joinedAt: '2026-08-01T01:00:00.000Z',
            joinedAtMs: Date.parse('2026-08-01T01:00:00.000Z')
        };
        mocks.loadCurrentInstanceRoster.mockResolvedValueOnce(loadedSnapshot);

        const { result } = renderHook(() =>
            useCurrentInstanceRoster({
                ...props('wrld_test:1'),
                refreshRevision: 0,
                tailSyncRevision: '0'
            })
        );

        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

        expect(result.current.playerRows).toEqual([
            expect.objectContaining({
                userId: 'usr_self',
                displayName: 'Current User'
            }),
            expect.objectContaining({ displayName: 'Player One' })
        ]);
        expect(mocks.loadCurrentInstanceRoster).toHaveBeenCalledWith({
            currentLocation: 'wrld_test:1'
        });
        expect(mocks.recordGameRuntimePresence).toHaveBeenCalledWith(
            expect.objectContaining({
                currentLocation: 'wrld_test:1',
                currentLocationPlayers: [
                    expect.objectContaining({ displayName: 'Current User' }),
                    expect.objectContaining({ displayName: 'Player One' })
                ]
            })
        );
    });

    it('refreshes after a game-log event like the original current-instance list', async () => {
        mocks.loadCurrentInstanceRoster
            .mockResolvedValueOnce(snapshot('wrld_test:1', 'Before Join'))
            .mockResolvedValueOnce(snapshot('wrld_test:1', 'After Join'));

        const { rerender, result } = renderHook(
            ({ eventCount }) =>
                useCurrentInstanceRoster({
                    ...props('wrld_test:1'),
                    refreshRevision: eventCount,
                    tailSyncRevision: '0'
                }),
            { initialProps: { eventCount: 0 } }
        );

        await waitFor(() =>
            expect(result.current.playerRows[1]?.displayName).toBe(
                'Before Join'
            )
        );

        rerender({ eventCount: 1 });

        await waitFor(() =>
            expect(result.current.playerRows[1]?.displayName).toBe('After Join')
        );
        expect(mocks.loadCurrentInstanceRoster).toHaveBeenCalledTimes(2);
    });

    it('ignores unrelated profile changes but refreshes when the effective name changes', async () => {
        const loaded = snapshot('wrld_test:1', 'Player One');
        loaded.context.playerFactsKnown = true;
        mocks.loadCurrentInstanceRoster.mockResolvedValue(loaded);
        const { result, rerender } = renderHook(
            ({ displayName, username, statusDescription }) =>
                useCurrentInstanceRoster({
                    ...props('wrld_test:1'),
                    currentUserSnapshot: {
                        id: 'usr_self',
                        displayName,
                        username,
                        statusDescription
                    }
                }),
            {
                initialProps: {
                    displayName: 'Current User',
                    username: 'account',
                    statusDescription: 'before'
                }
            }
        );
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

        rerender({
            displayName: 'Current User',
            username: 'other-account',
            statusDescription: 'after'
        });
        await act(async () => {});
        expect(mocks.loadCurrentInstanceRoster).toHaveBeenCalledTimes(1);
        expect(mocks.recordGameRuntimePresence).toHaveBeenCalledTimes(1);

        rerender({
            displayName: '',
            username: 'Fallback Name',
            statusDescription: 'after'
        });
        await waitFor(() =>
            expect(result.current.playerRows[0]?.displayName).toBe(
                'Fallback Name'
            )
        );
        expect(mocks.loadCurrentInstanceRoster).toHaveBeenCalledTimes(2);
    });

    it('does not let an older location request overwrite the active roster', async () => {
        const oldRequest = deferred<Snapshot>();
        const activeRequest = deferred<Snapshot>();
        mocks.loadCurrentInstanceRoster
            .mockReturnValueOnce(oldRequest.promise)
            .mockReturnValueOnce(activeRequest.promise);

        const { rerender, result } = renderHook(
            ({ location }) =>
                useCurrentInstanceRoster({
                    ...props(location),
                    refreshRevision: 0,
                    tailSyncRevision: '0'
                }),
            { initialProps: { location: 'wrld_test:old' } }
        );

        rerender({ location: 'wrld_test:active' });
        await act(async () => {
            activeRequest.resolve(
                snapshot('wrld_test:active', 'Active Instance')
            );
            await activeRequest.promise;
        });
        await waitFor(() =>
            expect(result.current.playerRows[1]?.displayName).toBe(
                'Active Instance'
            )
        );

        await act(async () => {
            oldRequest.resolve(snapshot('wrld_test:old', 'Stale Instance'));
            await oldRequest.promise;
        });

        expect(result.current.context.location).toBe('wrld_test:active');
        expect(result.current.playerRows[1]?.displayName).toBe(
            'Active Instance'
        );
        expect(mocks.recordGameRuntimePresence).toHaveBeenCalledTimes(1);
    });

    it('does not synthesize the current user outside a real instance', async () => {
        mocks.loadCurrentInstanceRoster.mockResolvedValueOnce({
            context: {
                createdAt: '',
                groupName: '',
                location: 'private',
                playerCount: 0,
                source: 'none',
                time: 0,
                worldId: '',
                worldName: ''
            },
            players: []
        });

        const { result } = renderHook(() =>
            useCurrentInstanceRoster({
                ...props('private'),
                refreshRevision: 0,
                tailSyncRevision: '0'
            })
        );

        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        expect(result.current.playerRows).toEqual([]);
    });

    it('keeps the loaded roster and ready status when a refresh returns the same instance', async () => {
        mocks.loadCurrentInstanceRoster.mockResolvedValue(
            snapshot('wrld_test:1', 'Player One')
        );
        const statuses: string[] = [];
        const { result, rerender } = renderHook(
            ({ revision }: { revision: number }) => {
                const roster = useCurrentInstanceRoster({
                    ...props('wrld_test:1'),
                    refreshRevision: revision,
                    tailSyncRevision: '0'
                });
                statuses.push(roster.loadStatus);
                return roster;
            },
            { initialProps: { revision: 0 } }
        );
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        const { context, playerRows } = result.current;
        statuses.length = 0;

        rerender({ revision: 1 });
        await waitFor(() =>
            expect(mocks.loadCurrentInstanceRoster).toHaveBeenCalledTimes(2)
        );
        await act(async () => {});

        expect(statuses).not.toContain('running');
        expect(result.current.context).toBe(context);
        expect(result.current.playerRows).toBe(playerRows);
        expect(mocks.recordGameRuntimePresence).toHaveBeenCalledTimes(2);
    });

    it('shows loading again when refreshing a different instance', async () => {
        mocks.loadCurrentInstanceRoster.mockResolvedValueOnce(
            snapshot('wrld_test:1', 'Player One')
        );
        const next = deferred<Snapshot>();
        mocks.loadCurrentInstanceRoster.mockReturnValueOnce(next.promise);
        const { result, rerender } = renderHook(
            ({ location }: { location: string }) =>
                useCurrentInstanceRoster({
                    ...props(location),
                    refreshRevision: 0,
                    tailSyncRevision: '0'
                }),
            { initialProps: { location: 'wrld_test:1' } }
        );
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));

        rerender({ location: 'wrld_test:2' });

        expect(result.current.loadStatus).toBe('running');
        await act(async () => {
            next.resolve(snapshot('wrld_test:2', 'Player Two'));
        });
        expect(result.current.loadStatus).toBe('ready');
    });
});
