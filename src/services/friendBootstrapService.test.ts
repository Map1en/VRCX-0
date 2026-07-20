import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
    recordFriendPatch: vi.fn(),
    getFriendLogCurrent: vi.fn(),
    socialFriendRosterBaselineGet: vi.fn(),
    vrchatUserGet: vi.fn(),
    vrchatFriendStatusGet: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appSocialFriendRosterBaselineGet:
            serviceMocks.socialFriendRosterBaselineGet,
        appVrchatUserGet: serviceMocks.vrchatUserGet,
        appVrchatFriendStatusGet: serviceMocks.vrchatFriendStatusGet
    }
}));

vi.mock('@/repositories/friendLogRepository', () => ({
    default: {
        getFriendLogCurrent: serviceMocks.getFriendLogCurrent
    }
}));

vi.mock('./domainIngestionService', () => ({
    recordFriendPatch: serviceMocks.recordFriendPatch
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

describe('friendBootstrapService startup seed and reconciliation', () => {
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
            currentUserWebsocket: 'wss://ws.example.test',
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
        serviceMocks.vrchatUserGet.mockResolvedValue({
            status: 200,
            data: {}
        });
        serviceMocks.socialFriendRosterBaselineGet.mockResolvedValue({
            stale: false,
            count: 0,
            detail: 'complete',
            snapshot: {
                friendsById: {}
            }
        });
    });

    it('seeds the visible roster before the Rust baseline completes without marking friends loaded', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { useSessionStore } = await import('@/state/sessionStore');
        const { bootstrapFriendRoster } =
            await import('./friendBootstrapService');
        const baseline = deferred<Record<string, unknown>>();
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
                    serviceMocks.socialFriendRosterBaselineGet
                ).toHaveBeenCalledWith(
                    expect.objectContaining({
                        userId: 'usr_self',
                        endpoint: 'https://api.example.test',
                        websocket: 'wss://ws.example.test'
                    })
                );
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

    it('marks friends loaded after the fast roster snapshot', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { useSessionStore } = await import('@/state/sessionStore');
        const { bootstrapFriendRoster } =
            await import('./friendBootstrapService');
        serviceMocks.socialFriendRosterBaselineGet.mockResolvedValue({
            stale: false,
            count: 2,
            detail: 'fast roster',
            snapshot: {
                friendsById: {
                    usr_online: {
                        id: 'usr_online',
                        displayName: 'Online Fast',
                        stateBucket: 'online',
                        platform: 'standalonewindows',
                        location: 'wrld_live:123'
                    },
                    usr_traveling: {
                        id: 'usr_traveling',
                        displayName: 'Traveling Fast',
                        stateBucket: 'online',
                        platform: 'standalonewindows',
                        location: 'traveling'
                    }
                }
            }
        });

        await bootstrapFriendRoster({
            userId: 'usr_self',
            endpoint: 'https://api.example.test',
            currentUserSnapshot: {
                id: 'usr_self',
                friends: ['usr_online', 'usr_traveling', 'usr_missing'],
                offlineFriends: ['usr_missing'],
                activeFriends: [],
                onlineFriends: ['usr_online', 'usr_traveling']
            }
        });

        expect(useSessionStore.getState().isFriendsLoaded).toBe(true);
        expect(useFriendRosterStore.getState()).toMatchObject({
            loadStatus: 'ready',
            detail: 'fast roster',
            friendsById: {
                usr_online: {
                    displayName: 'Online Fast',
                    location: 'wrld_live:123'
                },
                usr_traveling: {
                    displayName: 'Traveling Fast',
                    location: 'traveling'
                }
            }
        });
    });

    it('keeps realtime patches authoritative when refreshing a loaded roster', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { bootstrapFriendRoster } =
            await import('./friendBootstrapService');
        useFriendRosterStore.getState().setRosterSnapshot({
            currentUserId: 'usr_self',
            friendsById: {
                usr_live: {
                    id: 'usr_live',
                    displayName: 'Live Friend',
                    stateBucket: 'online',
                    location: 'wrld_new:456'
                }
            }
        });
        serviceMocks.socialFriendRosterBaselineGet.mockResolvedValue({
            stale: false,
            count: 1,
            detail: 'refreshed',
            snapshot: {
                friendsById: {
                    usr_stale: {
                        id: 'usr_stale',
                        displayName: 'Stale Friend',
                        stateBucket: 'offline'
                    }
                }
            }
        });

        await bootstrapFriendRoster({
            userId: 'usr_self',
            endpoint: 'https://api.example.test',
            websocket: 'wss://ws.example.test',
            currentUserSnapshot: { id: 'usr_self' },
            preserveLoadedState: true
        });

        expect(useFriendRosterStore.getState()).toMatchObject({
            loadStatus: 'ready',
            detail: 'refreshed',
            friendsById: {
                usr_live: {
                    displayName: 'Live Friend',
                    stateBucket: 'online',
                    location: 'wrld_new:456'
                }
            }
        });
        expect(
            useFriendRosterStore.getState().friendsById.usr_stale
        ).toBeUndefined();
    });

    it('skips a superseded refresh without erroring when preserving loaded state', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { bootstrapFriendRoster } =
            await import('./friendBootstrapService');
        useFriendRosterStore.getState().setRosterSnapshot({
            currentUserId: 'usr_self',
            friendsById: {
                usr_live: {
                    id: 'usr_live',
                    displayName: 'Live Friend',
                    stateBucket: 'online'
                }
            }
        });
        serviceMocks.socialFriendRosterBaselineGet.mockResolvedValue({
            stale: true,
            count: 0,
            detail: 'Superseded friend roster baseline.',
            snapshot: null
        });

        const result = await bootstrapFriendRoster({
            userId: 'usr_self',
            endpoint: 'https://api.example.test',
            websocket: 'wss://ws.example.test',
            currentUserSnapshot: { id: 'usr_self' },
            preserveLoadedState: true
        });

        expect(result.stale).toBe(true);
        expect(useFriendRosterStore.getState()).toMatchObject({
            loadStatus: 'ready',
            detail: 'Superseded friend roster baseline.',
            friendsById: {
                usr_live: { displayName: 'Live Friend' }
            }
        });
    });

    it('keeps the seeded roster visible when the Rust baseline fails', async () => {
        const { useFriendRosterStore } =
            await import('@/state/friendRosterStore');
        const { useSessionStore } = await import('@/state/sessionStore');
        const { bootstrapFriendRoster } =
            await import('./friendBootstrapService');
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
        const { bootstrapFriendRoster } =
            await import('./friendBootstrapService');
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
