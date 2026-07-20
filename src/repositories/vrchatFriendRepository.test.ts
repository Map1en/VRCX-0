import { beforeEach, describe, expect, it, vi } from 'vitest';

type FriendsRequest = {
    offline: boolean;
    n: number;
    offset: number;
};

const tauriMock = vi.hoisted(() => ({
    commands: {
        appVrchatFriendsGet: vi.fn()
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: tauriMock.commands }));

import vrchatFriendRepository from './vrchatFriendRepository';

function friendPage(offset: number, count: number) {
    return Array.from({ length: count }, (_, index) => ({
        id: `usr_${offset}_${index}`
    }));
}

describe('vrchatFriendRepository', () => {
    beforeEach(() => {
        vi.mocked(tauriMock.commands.appVrchatFriendsGet).mockReset();
    });

    it('fetches friends past the legacy 7500 offset limit until the first short page', async () => {
        vi.mocked(tauriMock.commands.appVrchatFriendsGet).mockImplementation(
            async (request: FriendsRequest) => ({
                status: 200,
                data:
                    request.offset === 7550
                        ? [{ id: 'usr_after_legacy_limit' }]
                        : friendPage(request.offset, request.n)
            })
        );

        const friends = await vrchatFriendRepository.getAllFriends({
            offline: false
        });

        expect(tauriMock.commands.appVrchatFriendsGet).toHaveBeenLastCalledWith(
            {
                offline: false,
                n: 50,
                offset: 7550
            }
        );
        expect(friends.at(-1)).toEqual({ id: 'usr_after_legacy_limit' });
    });
});
