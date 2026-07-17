import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMock = vi.hoisted(() => ({
    commands: {
        appIngestUserFacts: vi.fn()
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: tauriMock.commands }));

import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useUserFactsStore } from '@/state/userFactsStore';

import { resolveUserByDisplayName } from './userIdentityService';

type ResolveOptions = NonNullable<
    Parameters<typeof resolveUserByDisplayName>[1]
>;
type IdentityRepositories = NonNullable<ResolveOptions['repositories']>;

type IngestedEntry = {
    user?: { id?: string };
};

function ingestedEntryFor(userId: string) {
    return tauriMock.commands.appIngestUserFacts.mock.calls
        .flatMap((call) => (Array.isArray(call[0]) ? call[0] : []))
        .find((entry: IngestedEntry) => entry.user?.id === userId);
}

describe('userIdentityService', () => {
    beforeEach(() => {
        tauriMock.commands.appIngestUserFacts.mockReset();
        tauriMock.commands.appIngestUserFacts.mockResolvedValue(undefined);
        useRuntimeStore.getState().resetRuntimeState();
        useFriendRosterStore.getState().resetRoster();
        useUserFactsStore.getState().resetUserFacts();
    });

    it('resolves display names through known facts and friend roster before slower fallbacks', async () => {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserEndpoint: 'api'
        });
        useUserFactsStore.getState().replaceUserFacts([
            {
                id: 'usr_known',
                endpoint: 'api',
                displayName: 'Known User'
            }
        ]);
        useFriendRosterStore.getState().applyFriendPatch({
            userId: 'usr_friend',
            patch: {
                id: 'usr_friend',
                displayName: 'Friend User'
            },
            stateBucket: 'online'
        });

        const getUserIdFromDisplayName = vi.fn();
        const getUsers = vi.fn();
        const repositories: IdentityRepositories = {
            gameLogRepository: {
                getUserIdFromDisplayName
            },
            vrchatSearchRepository: {
                getUsers
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
        expect(getUserIdFromDisplayName).not.toHaveBeenCalled();
        expect(getUsers).not.toHaveBeenCalled();
    });

    it('uses game log and search fallbacks and ingests resolved users to Rust', async () => {
        const repositories: IdentityRepositories = {
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

        expect(ingestedEntryFor('usr_log')).toMatchObject({
            user: {
                id: 'usr_log',
                displayName: 'Log User'
            }
        });
        expect(ingestedEntryFor('usr_search')).toMatchObject({
            user: {
                id: 'usr_search',
                displayName: 'Search User'
            }
        });
    });
});
