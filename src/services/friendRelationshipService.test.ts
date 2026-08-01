import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRuntimeStore } from '@/state/runtimeStore';

const commandMocks = vi.hoisted(() => ({
    unfriend: vi.fn(),
    unfriendBatch: vi.fn()
}));
const friendLogMocks = vi.hoisted(() => ({
    signalChanged: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appSocialUnfriend: commandMocks.unfriend,
        appSocialUnfriendBatch: commandMocks.unfriendBatch
    }
}));

vi.mock('@/services/friendLogMutationService', () => ({
    signalFriendLogChanged: friendLogMocks.signalChanged
}));

import { deleteFriend, deleteFriends } from './friendRelationshipService';

describe('friendRelationshipService.deleteFriend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: 'https://api.example.test',
            currentUserSnapshot: {
                friends: ['usr_target']
            }
        });
    });

    it('does not patch a newer account after a late remote response', async () => {
        commandMocks.unfriend.mockImplementation(async () => {
            useRuntimeStore.getState().setAuthBootstrap({
                currentUserId: 'usr_other',
                currentUserEndpoint: 'https://api.example.test',
                currentUserSnapshot: {
                    friends: ['usr_target']
                }
            });
            return {
                status: 'remoteOkLocalFailed',
                targetUserId: 'usr_target',
                localError:
                    'Social mutation authentication scope changed during request.'
            };
        });

        const result = await deleteFriend({
            currentUserId: 'usr_self',
            endpoint: 'https://api.example.test',
            userId: 'usr_target'
        });

        expect(result.stale).toBe(true);
        expect(
            useRuntimeStore.getState().auth.currentUserSnapshot
        ).toMatchObject({
            friends: ['usr_target']
        });
        expect(friendLogMocks.signalChanged).not.toHaveBeenCalled();
    });
});

describe('friendRelationshipService.deleteFriends', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: 'usr_self',
            currentUserEndpoint: 'https://api.example.test',
            currentUserSnapshot: {
                friends: ['usr_a', 'usr_b', 'usr_c'],
                onlineFriends: ['usr_a'],
                activeFriends: ['usr_b'],
                offlineFriends: ['usr_c']
            }
        });
    });

    it('invokes one typed batch and applies only remote-success mirror corrections', async () => {
        commandMocks.unfriendBatch.mockResolvedValue({
            ownerUserId: 'usr_self',
            total: 3,
            succeeded: 2,
            failed: 1,
            localFailed: 1,
            scopeChanged: false,
            items: [
                {
                    userId: 'usr_a',
                    state: 'applied',
                    message: ''
                },
                {
                    userId: 'usr_b',
                    state: 'remoteOkLocalFailed',
                    message: 'local write failed'
                },
                {
                    userId: 'usr_c',
                    state: 'failed',
                    message: 'remote denied'
                }
            ],
            lastError: 'remote denied'
        });

        const result = await deleteFriends({
            expectedEndpoint: 'https://api.example.test',
            expectedOwnerUserId: 'usr_self',
            friends: [
                { id: 'usr_a', displayName: 'Alpha' },
                { id: 'usr_b', displayName: 'Bravo' },
                { id: 'usr_c', displayName: 'Charlie' }
            ]
        });

        expect(commandMocks.unfriendBatch).toHaveBeenCalledWith({
            expectedEndpoint: 'https://api.example.test',
            expectedOwnerUserId: 'usr_self',
            targets: [
                { userId: 'usr_a', displayName: 'Alpha' },
                { userId: 'usr_b', displayName: 'Bravo' },
                { userId: 'usr_c', displayName: 'Charlie' }
            ]
        });
        expect(
            useRuntimeStore.getState().auth.currentUserSnapshot
        ).toMatchObject({
            friends: ['usr_c'],
            onlineFriends: [],
            activeFriends: [],
            offlineFriends: ['usr_c']
        });
        expect(friendLogMocks.signalChanged).toHaveBeenCalledTimes(1);
        expect(result.stale).toBe(false);
    });

    it('does not patch a newly authenticated account mirror', async () => {
        commandMocks.unfriendBatch.mockImplementation(async () => {
            useRuntimeStore.getState().setAuthBootstrap({
                currentUserId: 'usr_other',
                currentUserEndpoint: 'https://api.example.test',
                currentUserSnapshot: {
                    friends: ['usr_a']
                }
            });
            return {
                ownerUserId: 'usr_self',
                total: 1,
                succeeded: 1,
                failed: 0,
                localFailed: 0,
                scopeChanged: false,
                items: [
                    {
                        userId: 'usr_a',
                        state: 'applied',
                        message: ''
                    }
                ],
                lastError: null
            };
        });

        await deleteFriends({
            expectedEndpoint: 'https://api.example.test',
            expectedOwnerUserId: 'usr_self',
            friends: [{ id: 'usr_a' }]
        });

        expect(
            useRuntimeStore.getState().auth.currentUserSnapshot
        ).toMatchObject({
            friends: ['usr_a']
        });
        expect(friendLogMocks.signalChanged).not.toHaveBeenCalled();
    });

    it('treats a backend-reported scope change as stale without message matching', async () => {
        commandMocks.unfriendBatch.mockResolvedValue({
            ownerUserId: 'usr_self',
            total: 2,
            succeeded: 1,
            failed: 1,
            localFailed: 0,
            scopeChanged: true,
            items: [
                {
                    userId: 'usr_a',
                    state: 'applied',
                    message: ''
                },
                {
                    userId: 'usr_b',
                    state: 'notAttempted',
                    message: 'Reworded backend error text.'
                }
            ],
            lastError: 'Reworded backend error text.'
        });

        const result = await deleteFriends({
            expectedEndpoint: 'https://api.example.test',
            expectedOwnerUserId: 'usr_self',
            friends: [{ id: 'usr_a' }, { id: 'usr_b' }]
        });

        expect(result.stale).toBe(true);
        expect(
            useRuntimeStore.getState().auth.currentUserSnapshot
        ).toMatchObject({
            friends: ['usr_a', 'usr_b', 'usr_c']
        });
        expect(friendLogMocks.signalChanged).not.toHaveBeenCalled();
    });

    it('does not patch the same account after its endpoint changes', async () => {
        commandMocks.unfriendBatch.mockImplementation(async () => {
            useRuntimeStore.getState().setAuthBootstrap({
                currentUserId: 'usr_self',
                currentUserEndpoint: 'https://api.other.test',
                currentUserSnapshot: {
                    friends: ['usr_a']
                }
            });
            return {
                ownerUserId: 'usr_self',
                total: 1,
                succeeded: 1,
                failed: 0,
                localFailed: 0,
                scopeChanged: false,
                items: [
                    {
                        userId: 'usr_a',
                        state: 'applied',
                        message: ''
                    }
                ],
                lastError: null
            };
        });

        const result = await deleteFriends({
            expectedEndpoint: 'https://api.example.test',
            expectedOwnerUserId: 'usr_self',
            friends: [{ id: 'usr_a' }]
        });

        expect(result.stale).toBe(true);
        expect(
            useRuntimeStore.getState().auth.currentUserSnapshot
        ).toMatchObject({
            friends: ['usr_a']
        });
        expect(friendLogMocks.signalChanged).not.toHaveBeenCalled();
    });
});
