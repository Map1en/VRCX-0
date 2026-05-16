import { describe, expect, it, vi } from 'vitest';

const backendState = vi.hoisted(() => ({
    app: {
        BackendModerationRefresh: vi.fn(),
        BackendModerationUpdate: vi.fn()
    }
}));

const authRecoveryState = vi.hoisted(() => ({
    handleRuntimeAuthFailure: vi.fn()
}));

vi.mock('@/platform/index.js', () => ({
    backend: {
        app: backendState.app
    }
}));

vi.mock('./authSessionRecoveryService.js', () => ({
    handleRuntimeAuthFailure: authRecoveryState.handleRuntimeAuthFailure
}));

describe('backendModerationService', () => {
    it('routes refresh missing credentials through runtime auth recovery', async () => {
        backendState.app.BackendModerationRefresh.mockRejectedValueOnce(
            new Error('Missing Credentials')
        );
        const { refreshBackendModerations } = await import(
            './backendModerationService.js'
        );

        await expect(
            refreshBackendModerations({ userId: 'usr_current', endpoint: '' })
        ).rejects.toMatchObject({
            status: 401,
            endpoint: 'auth/user/playermoderations'
        });
        expect(authRecoveryState.handleRuntimeAuthFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 401,
                endpoint: 'auth/user/playermoderations'
            })
        );
    });

    it('routes mutation missing credentials through runtime auth recovery', async () => {
        backendState.app.BackendModerationUpdate.mockRejectedValueOnce(
            new Error('Missing Credentials')
        );
        const { updateBackendModeration } = await import(
            './backendModerationService.js'
        );

        await expect(
            updateBackendModeration({
                ownerUserId: 'usr_current',
                targetUserId: 'usr_target',
                type: 'block',
                enabled: false
            })
        ).rejects.toMatchObject({
            status: 401,
            endpoint: 'auth/user/unplayermoderate'
        });
        expect(authRecoveryState.handleRuntimeAuthFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 401,
                endpoint: 'auth/user/unplayermoderate'
            })
        );
    });
});
