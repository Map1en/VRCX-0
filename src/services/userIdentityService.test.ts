// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recordUserProfile } from '@/domain/users/userFactAccess.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useUserFactsStore } from '@/state/userFactsStore.js';

import { resolveUserByDisplayName } from './userIdentityService.js';

describe('userIdentityService', () => {
    beforeEach(() => {
        useRuntimeStore.getState().resetRuntimeState();
        useFriendRosterStore.getState().resetRoster();
        useUserFactsStore.getState().resetUserFacts();
    });

    it('resolves display names through known facts and friend roster before slower fallbacks', async () => {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserEndpoint: 'api'
        });
        recordUserProfile(
            {
                id: 'usr_known',
                displayName: 'Known User'
            },
            { endpoint: 'api', source: 'profile' }
        );
        useFriendRosterStore.getState().applyFriendPatch({
            userId: 'usr_friend',
            patch: {
                id: 'usr_friend',
                displayName: 'Friend User'
            },
            stateBucket: 'online'
        });

        const repositories = {
            gameLogRepository: {
                getUserIdFromDisplayName: vi.fn()
            },
            vrchatSearchRepository: {
                getUsers: vi.fn()
            }
        };

        await expect(
            resolveUserByDisplayName('Known User', {
                endpoint: 'api',
                repositories
            })
        ).resolves.toMatchObject({
            userId: 'usr_known',
            title: 'Known User',
            source: 'known'
        });
        await expect(
            resolveUserByDisplayName('Friend User', {
                endpoint: 'api',
                repositories
            })
        ).resolves.toMatchObject({
            userId: 'usr_friend',
            title: 'Friend User',
            source: 'friend'
        });
        expect(repositories.gameLogRepository.getUserIdFromDisplayName).not.toHaveBeenCalled();
        expect(repositories.vrchatSearchRepository.getUsers).not.toHaveBeenCalled();
    });

    it('uses game log and search fallbacks and records resolved users as known facts', async () => {
        const repositories = {
            gameLogRepository: {
                getUserIdFromDisplayName: vi
                    .fn()
                    .mockResolvedValueOnce('usr_log')
                    .mockResolvedValueOnce('')
            },
            vrchatSearchRepository: {
                getUsers: vi.fn().mockResolvedValue({
                    json: [
                        {
                            id: 'usr_search',
                            displayName: 'Search User'
                        }
                    ]
                })
            }
        };

        await expect(
            resolveUserByDisplayName('Log User', {
                endpoint: 'api',
                repositories
            })
        ).resolves.toMatchObject({
            userId: 'usr_log',
            title: 'Log User',
            source: 'gameLog'
        });
        await expect(
            resolveUserByDisplayName('Search User', {
                endpoint: 'api',
                repositories
            })
        ).resolves.toMatchObject({
            userId: 'usr_search',
            title: 'Search User',
            source: 'search'
        });

        expect(useUserFactsStore.getState().usersByKey).toMatchObject({
            'api::usr_log': {
                id: 'usr_log',
                displayName: 'Log User'
            },
            'api::usr_search': {
                id: 'usr_search',
                displayName: 'Search User'
            }
        });
    });
});
