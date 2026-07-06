import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appVrchatInstanceJoin: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appVrchatInstanceJoin: mocks.appVrchatInstanceJoin
    }
}));

import {
    openInstanceInGame,
    sendSelfInviteToInstance
} from './instanceActionService';

describe('instanceActionService', () => {
    beforeEach(() => {
        mocks.appVrchatInstanceJoin.mockReset();
    });

    it('opens an instance through the backend join action in open-only mode', async () => {
        mocks.appVrchatInstanceJoin.mockResolvedValue({ status: 'opened' });

        await expect(
            openInstanceInGame(
                'wrld_test:12345~hidden(usr_owner)',
                'tok123',
                'https://api.vrchat.cloud/api/1'
            )
        ).resolves.toBe(true);

        expect(mocks.appVrchatInstanceJoin).toHaveBeenCalledWith({
            location: 'wrld_test:12345~hidden(usr_owner)',
            shortName: 'tok123',
            endpoint: 'https://api.vrchat.cloud/api/1',
            mode: 'openOnly'
        });
    });

    it('reports open-only backend failures as a false open result', async () => {
        mocks.appVrchatInstanceJoin.mockResolvedValue({
            status: 'failed',
            reason: 'launch pipe unavailable'
        });

        await expect(
            openInstanceInGame('wrld_test:12345', '', '')
        ).resolves.toBe(false);
    });

    it('sends self invites through the backend join action in self-invite-only mode', async () => {
        mocks.appVrchatInstanceJoin.mockResolvedValue({
            status: 'selfInvited'
        });

        await expect(
            sendSelfInviteToInstance(
                'wrld_test:12345~hidden(usr_owner)',
                'tok123',
                ''
            )
        ).resolves.toBeUndefined();

        expect(mocks.appVrchatInstanceJoin).toHaveBeenCalledWith({
            location: 'wrld_test:12345~hidden(usr_owner)',
            shortName: 'tok123',
            endpoint: '',
            mode: 'selfInviteOnly'
        });
    });
});
