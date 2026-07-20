import { describe, expect, it, vi } from 'vitest';

const runtimeState = vi.hoisted(() => ({
    commands: {
        appModerationSyncRefresh: vi.fn(),
        appModerationSyncUpdate: vi.fn()
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: runtimeState.commands
}));

describe('moderationSyncService', () => {
    it('preserves a typed missing-credentials refresh error', async () => {
        runtimeState.commands.appModerationSyncRefresh.mockRejectedValueOnce(
            new Error('Missing Credentials')
        );
        const { refreshModerationSync } =
            await import('./moderationSyncService');

        await expect(
            refreshModerationSync({ userId: 'usr_current', endpoint: '' })
        ).rejects.toMatchObject({
            status: 401,
            endpoint: 'auth/user/playermoderations'
        });
    });

    it('preserves a typed missing-credentials mutation error', async () => {
        runtimeState.commands.appModerationSyncUpdate.mockRejectedValueOnce(
            new Error('Missing Credentials')
        );
        const { updateModerationSync } =
            await import('./moderationSyncService');

        await expect(
            updateModerationSync({
                ownerUserId: 'usr_current',
                targetUserId: 'usr_target',
                type: 'block',
                enabled: false
            })
        ).rejects.toMatchObject({
            status: 401,
            endpoint: 'auth/user/unplayermoderate'
        });
    });
});
