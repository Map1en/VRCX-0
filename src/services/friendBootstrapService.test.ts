import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
    recordFriendPatch: vi.fn(),
    recordFriendRosterFacts: vi.fn(),
    getFriendLogCurrent: vi.fn(),
    socialFriendRosterBaselineGet: vi.fn(),
    notifyRuntimeVrchatAuthFailure: vi.fn()
}));

vi.mock('@/platform/tauri/client', () => ({
    tauriClient: {
        app: {
            SocialFriendRosterBaselineGet:
                serviceMocks.socialFriendRosterBaselineGet
        }
    }
}));

vi.mock('@/repositories/friendLogRepository', () => ({
    default: {
        getFriendLogCurrent: serviceMocks.getFriendLogCurrent
    }
}));

vi.mock('./domainIngestionService', () => ({
    recordFriendPatch: serviceMocks.recordFriendPatch,
    recordFriendRosterFacts: serviceMocks.recordFriendRosterFacts
}));

vi.mock('./vrchatAuthErrorService', () => ({
    notifyRuntimeVrchatAuthFailure:
        serviceMocks.notifyRuntimeVrchatAuthFailure
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });
    return { promise, resolve, reject };
}

describe('friendBootstrapService snapshot state sync', () => {
    beforeEach(async () => {
        vi.clearAllMocks();

        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { useRuntimeStore } = await import('@/state/runtimeStore');
        const { useSessionStore } = await import('@/state/sessionStore');

        useFriendRosterStore.getState().resetRoster();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: 'https://api.example.test',
            currentUserSnapshot: {
                id: 'usr_self'
            }
        });
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            isFriendsLoaded: true,
            sessionPhase: 'ready'
        });
        serviceMocks.getFriendLogCurrent.mockResolvedValue([]);
        serviceMocks.socialFriendRosterBaselineGet.mockResolvedValue({
            stale: false,
            count: 0,
            detail: 'complete',
            snapshot: {
                friendsById: {}
            }
        });
    });

    it('uses a complete current-user bucket snapshot as roster state authority', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { syncFriendRosterStateFromCurrentUserSnapshot } = await import(
            './friendBootstrapService'
        );

        useFriendRosterStore.getState().applyFriendPatches([
            {
                userId: 'usr_friend',
                stateBucket: 'online',
                patch: {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    state: 'online',
                    location: 'wrld_live:123'
                }
            }
        ]);

        syncFriendRosterStateFromCurrentUserSnapshot(
            {
                id: 'usr_self',
                friends: ['usr_friend'],
                offlineFriends: ['usr_friend'],
                activeFriends: [],
                onlineFriends: []
            },
            'snapshot refresh'
        );

        const state = useFriendRosterStore.getState();
        expect(state.onlineIds).toEqual([]);
        expect(state.offlineIds).toEqual(['usr_friend']);
        expect(state.friendsById.usr_friend).toMatchObject({
            state: 'offline',
            stateBucket: 'offline',
            location: 'wrld_live:123'
        });
        expect(serviceMocks.recordFriendPatch).toHaveBeenLastCalledWith(
            expect.objectContaining({
                userId: 'usr_friend',
                stateBucket: 'offline',
                patch: expect.objectContaining({
                    state: 'offline'
                })
            })
        );
    });

    it('ignores partial current-user bucket snapshots', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { syncFriendRosterStateFromCurrentUserSnapshot } = await import(
            './friendBootstrapService'
        );

        useFriendRosterStore.getState().applyFriendPatches([
            {
                userId: 'usr_friend',
                stateBucket: 'online',
                patch: {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    state: 'online'
                }
            }
        ]);

        const synced = syncFriendRosterStateFromCurrentUserSnapshot(
            {
                id: 'usr_self',
                friends: ['usr_friend']
            },
            'partial snapshot refresh'
        );

        const state = useFriendRosterStore.getState();
        expect(synced).toBe(false);
        expect(state.onlineIds).toEqual(['usr_friend']);
        expect(state.offlineIds).toEqual([]);
        expect(serviceMocks.recordFriendPatch).not.toHaveBeenCalled();
    });

    it('seeds the visible roster before the Rust baseline completes without marking friends loaded', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { useSessionStore } = await import('@/state/sessionStore');
        const { bootstrapFriendRoster } = await import(
            './friendBootstrapService'
        );
        const baseline = deferred<Record<string, any>>();
        serviceMocks.getFriendLogCurrent.mockResolvedValue([
            {
                userId: 'usr_online',
                displayName: 'Online Cache',
                trustLevel: 'Trusted User',
                friendNumber: 1
            },
            {
                userId: 'usr_active',
                displayName: 'Active Cache',
                trustLevel: 'Known User',
                friendNumber: 2
            },
            {
                userId: 'usr_deleted',
                displayName: 'Deleted Cache',
                trustLevel: 'Visitor',
                friendNumber: 3
            }
        ]);
        serviceMocks.socialFriendRosterBaselineGet.mockReturnValue(
            baseline.promise
        );

        const run = bootstrapFriendRoster({
            userId: 'usr_self',
            endpoint: 'https://api.example.test',
            currentUserSnapshot: {
                id: 'usr_self',
                displayName: 'Self',
                friends: ['usr_online', 'usr_active', 'usr_offline'],
                offlineFriends: ['usr_offline'],
                activeFriends: ['usr_active'],
                onlineFriends: ['usr_online']
            }
        });

        let seedError: unknown = null;
        try {
            await vi.waitFor(() => {
                expect(
                    serviceMocks.socialFriendRosterBaselineGet
                ).toHaveBeenCalled();
                expect(
                    useFriendRosterStore.getState().orderedFriendIds
                ).toEqual(['usr_online', 'usr_active', 'usr_offline']);
            });
        } catch (error) {
            seedError = error;
        }

        const seededState = useFriendRosterStore.getState();
        const seededFriendsLoaded = useSessionStore.getState().isFriendsLoaded;

        baseline.resolve({
            stale: false,
            count: 3,
            detail: 'complete baseline',
            snapshot: {
                friendsById: {
                    usr_online: {
                        id: 'usr_online',
                        displayName: 'Online Final',
                        stateBucket: 'online',
                        location: 'wrld_live:123'
                    }
                }
            }
        });

        await run;

        if (seedError) {
            throw seedError;
        }

        expect(seededState).toMatchObject({
            loadStatus: 'running',
            onlineIds: ['usr_online'],
            activeIds: ['usr_active'],
            offlineIds: ['usr_offline'],
            friendsById: {
                usr_online: {
                    displayName: 'Online Cache',
                    stateBucket: 'online',
                    $trustLevel: 'Trusted User'
                },
                usr_active: {
                    displayName: 'Active Cache',
                    stateBucket: 'active',
                    $trustLevel: 'Known User'
                },
                usr_offline: {
                    displayName: 'usr_offline',
                    stateBucket: 'offline'
                }
            }
        });
        expect(seededState.friendsById.usr_deleted).toBeUndefined();
        expect(seededFriendsLoaded).toBe(false);

        expect(useFriendRosterStore.getState()).toMatchObject({
            loadStatus: 'ready',
            detail: 'complete baseline',
            orderedFriendIds: ['usr_online'],
            friendsById: {
                usr_online: {
                    displayName: 'Online Final',
                    location: 'wrld_live:123'
                }
            }
        });
        expect(useSessionStore.getState().isFriendsLoaded).toBe(true);
    });

    it('keeps the seeded roster visible when the Rust baseline fails', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { useSessionStore } = await import('@/state/sessionStore');
        const { bootstrapFriendRoster } = await import(
            './friendBootstrapService'
        );
        serviceMocks.getFriendLogCurrent.mockResolvedValue([
            {
                userId: 'usr_online',
                displayName: 'Online Cache',
                trustLevel: 'Trusted User',
                friendNumber: 1
            }
        ]);
        serviceMocks.socialFriendRosterBaselineGet.mockRejectedValue(
            new Error('baseline failed')
        );

        await expect(
            bootstrapFriendRoster({
                userId: 'usr_self',
                endpoint: 'https://api.example.test',
                currentUserSnapshot: {
                    id: 'usr_self',
                    friends: ['usr_online'],
                    offlineFriends: [],
                    activeFriends: [],
                    onlineFriends: ['usr_online']
                }
            })
        ).rejects.toThrow('baseline failed');

        expect(useFriendRosterStore.getState()).toMatchObject({
            loadStatus: 'error',
            detail: 'baseline failed',
            orderedFriendIds: ['usr_online'],
            onlineIds: ['usr_online'],
            friendsById: {
                usr_online: {
                    displayName: 'Online Cache',
                    stateBucket: 'online'
                }
            }
        });
        expect(useSessionStore.getState().isFriendsLoaded).toBe(false);
    });

    it('keeps the seeded roster visible when the Rust baseline returns stale', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { useSessionStore } = await import('@/state/sessionStore');
        const { bootstrapFriendRoster } = await import(
            './friendBootstrapService'
        );
        serviceMocks.getFriendLogCurrent.mockResolvedValue([
            {
                userId: 'usr_active',
                displayName: 'Active Cache',
                trustLevel: 'Known User',
                friendNumber: 1
            }
        ]);
        serviceMocks.socialFriendRosterBaselineGet.mockResolvedValue({
            stale: true,
            count: 0,
            detail: 'stale baseline'
        });

        await expect(
            bootstrapFriendRoster({
                userId: 'usr_self',
                endpoint: 'https://api.example.test',
                currentUserSnapshot: {
                    id: 'usr_self',
                    friends: ['usr_active'],
                    offlineFriends: [],
                    activeFriends: ['usr_active'],
                    onlineFriends: []
                }
            })
        ).rejects.toThrow('Friend roster baseline was stale for usr_self.');

        expect(useFriendRosterStore.getState()).toMatchObject({
            loadStatus: 'error',
            detail: 'Friend roster baseline was stale for usr_self.',
            orderedFriendIds: ['usr_active'],
            activeIds: ['usr_active'],
            friendsById: {
                usr_active: {
                    displayName: 'Active Cache',
                    stateBucket: 'active'
                }
            }
        });
        expect(useSessionStore.getState().isFriendsLoaded).toBe(false);
    });
});
