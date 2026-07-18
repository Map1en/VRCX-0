import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getArray: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: {} }));
vi.mock('./configRepository', () => ({
    default: {
        getArray: mocks.getArray
    }
}));

import { getExplicitLocalFavoriteGroups } from './favoritePersistenceRepository';

describe('favoritePersistenceRepository group realms', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.getArray.mockResolvedValue([]);
    });

    it('unions shared and account friend groups', async () => {
        mocks.getArray.mockImplementation((key: string) => {
            if (key === 'localFavoriteFriendGroups') {
                return Promise.resolve(['Shared', 'Both']);
            }
            if (key === 'localFavoriteFriendGroups:usr_a') {
                return Promise.resolve(['Account', 'Both']);
            }
            return Promise.resolve([]);
        });

        await expect(
            getExplicitLocalFavoriteGroups('friend', ' usr_a ')
        ).resolves.toEqual(['Account', 'Both', 'Shared']);
        expect(mocks.getArray).toHaveBeenCalledWith(
            'localFavoriteFriendGroups',
            []
        );
        expect(mocks.getArray).toHaveBeenCalledWith(
            'localFavoriteFriendGroups:usr_a',
            []
        );
    });

    it('keeps world and avatar group keys global', async () => {
        mocks.getArray.mockResolvedValue(['Global']);

        await expect(
            getExplicitLocalFavoriteGroups('world', 'usr_a')
        ).resolves.toEqual(['Global']);
        expect(mocks.getArray).toHaveBeenCalledTimes(1);
        expect(mocks.getArray).toHaveBeenCalledWith(
            'localFavoriteWorldGroups',
            []
        );
    });
});
