// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInstanceUserRow } from '@/domain/instances/instanceRoster';

const mocks = vi.hoisted(() => ({
    getInstance: vi.fn(),
    recordGameRuntimePresence: vi.fn(),
    recordKnownUsers: vi.fn(),
    recordLocationHintsFromInstances: vi.fn()
}));

vi.mock('@/repositories/vrchatInstanceRepository', () => ({
    default: { getInstance: mocks.getInstance }
}));

vi.mock('@/services/domainIngestionService', () => ({
    recordGameRuntimePresence: mocks.recordGameRuntimePresence,
    recordKnownUsers: mocks.recordKnownUsers,
    recordLocationHintsFromInstances: mocks.recordLocationHintsFromInstances
}));

import {
    enrichLocationUsersWithProfiles,
    useUserDialogLocationPanel
} from './useUserDialogLocationPanel';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('enrichLocationUsersWithProfiles', () => {
    it('uses the friend roster image without loading the remote profile', async () => {
        const loadUserProfile = vi.fn();
        const users = [
            createInstanceUserRow({
                id: 'usr_friend',
                displayName: 'Friend'
            })
        ];

        const enriched = await enrichLocationUsersWithProfiles({
            friendsById: {
                usr_friend: {
                    id: 'usr_friend',
                    displayName: 'Friend',
                    currentAvatarThumbnailImageUrl:
                        'https://example.test/friend.webp'
                }
            },
            knownUsersById: new Map(),
            loadUserProfile,
            users
        });

        expect(loadUserProfile).not.toHaveBeenCalled();
        expect(enriched[0].currentAvatarThumbnailImageUrl).toBe(
            'https://example.test/friend.webp'
        );
    });

    it('loads a missing image for a nonfriend', async () => {
        const loadUserProfile = vi.fn().mockResolvedValue({
            id: 'usr_nonfriend',
            displayName: 'Nonfriend',
            currentAvatarThumbnailImageUrl:
                'https://example.test/nonfriend.webp'
        });
        const users = [
            createInstanceUserRow({
                id: 'usr_nonfriend',
                displayName: 'Nonfriend'
            })
        ];

        const enriched = await enrichLocationUsersWithProfiles({
            friendsById: {},
            knownUsersById: new Map(),
            loadUserProfile,
            users
        });

        expect(loadUserProfile).toHaveBeenCalledWith({
            userId: 'usr_nonfriend'
        });
        expect(enriched[0].currentAvatarThumbnailImageUrl).toBe(
            'https://example.test/nonfriend.webp'
        );
    });
});

describe('useUserDialogLocationPanel', () => {
    it('allows inviting from the current invite-plus instance', () => {
        const currentLocation =
            'wrld_hidden:12345~hidden(usr_owner)~region(use)';
        const gameState = {
            currentDestination: '',
            currentLocation,
            currentLocationPlayerIds: [],
            currentLocationPlayers: [],
            currentLocationStartedAt: null,
            currentWorldId: 'wrld_hidden',
            currentWorldName: 'Hidden World',
            isGameRunning: true
        };
        const groupInstancesState = {};
        const friendsById = {};
        const { result } = renderHook(() =>
            useUserDialogLocationPanel({
                currentEndpoint: 'https://api.example.test',
                currentUserId: 'usr_self',
                currentUserSnapshot: null,
                gameState,
                groupInstancesState,
                friendsById,
                presenceLocation: '',
                profile: null,
                reloadToken: 0
            })
        );

        expect(result.current.currentInviteLocation).toBe(currentLocation);
        expect(result.current.canInviteFromCurrentLocation).toBe(true);
    });

    it('reuses the active location request across profile-only rerenders', async () => {
        mocks.getInstance.mockResolvedValue({
            json: {
                id: 'wrld_test:12345',
                userCount: 1
            }
        });
        const profile = {
            id: 'usr_target',
            location: 'wrld_test:12345'
        };
        const { rerender } = renderHook(
            ({ friendsById, profile, reloadToken }) =>
                useUserDialogLocationPanel({
                    currentEndpoint: 'https://api.example.test',
                    currentUserId: 'usr_self',
                    currentUserSnapshot: null,
                    gameState: null,
                    groupInstancesState: {},
                    friendsById,
                    presenceLocation: 'wrld_test:12345',
                    profile,
                    reloadToken
                }),
            {
                initialProps: {
                    friendsById: {},
                    profile,
                    reloadToken: 0
                }
            }
        );

        await waitFor(() => {
            expect(mocks.getInstance).toHaveBeenCalledOnce();
        });

        await act(async () => {
            rerender({
                friendsById: {},
                profile: { ...profile },
                reloadToken: 0
            });
            await Promise.resolve();
        });

        expect(mocks.getInstance).toHaveBeenCalledOnce();

        rerender({
            friendsById: {},
            profile: { ...profile },
            reloadToken: 1
        });

        await waitFor(() => {
            expect(mocks.getInstance).toHaveBeenCalledTimes(2);
        });
    });
});
