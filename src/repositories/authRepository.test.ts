import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appVrchatAuthSavedSnapshotGet: vi.fn(),
    appVrchatAuthSavedCredentialDelete: vi.fn(),
    appVrchatAuthSessionEnd: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));

import authRepository, {
    deleteSavedCredential,
    endSession
} from './authRepository';

function savedSnapshot(patch: Record<string, unknown> = {}) {
    return {
        lastUserLoggedIn: 'usr_1',
        autoLoginStatus: 'available',
        autoLoginReason: 'available',
        autoLoginDelayEnabled: false,
        autoLoginDelaySeconds: 0,
        savedCredentialsList: [
            {
                user: {
                    id: 'usr_1',
                    displayName: 'User One'
                },
                loginParams: {
                    username: 'user@example.test'
                },
                hasLoginCredentials: true,
                hasCookies: false
            }
        ],
        ...patch
    };
}

describe('authRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        commandMocks.appVrchatAuthSavedSnapshotGet.mockResolvedValue(
            savedSnapshot()
        );
        commandMocks.appVrchatAuthSavedCredentialDelete.mockResolvedValue(
            savedSnapshot({
                lastUserLoggedIn: null,
                savedCredentialsList: []
            })
        );
        commandMocks.appVrchatAuthSessionEnd.mockResolvedValue(
            savedSnapshot({ lastUserLoggedIn: null })
        );
    });

    it('returns the generated snapshot contract without reshaping it', async () => {
        const snapshot = savedSnapshot();
        commandMocks.appVrchatAuthSavedSnapshotGet.mockResolvedValueOnce(
            snapshot
        );

        await expect(authRepository.getSavedAuthSnapshot()).resolves.toBe(
            snapshot
        );
    });

    it('deletes a saved credential and returns the next snapshot', async () => {
        await expect(deleteSavedCredential('usr_2')).resolves.toMatchObject({
            lastUserLoggedIn: null,
            savedCredentialsList: []
        });

        expect(
            commandMocks.appVrchatAuthSavedCredentialDelete
        ).toHaveBeenCalledWith({
            userId: 'usr_2'
        });
    });

    it('ends auth sessions through the single typed command', async () => {
        await endSession({ kind: 'logout' });

        expect(commandMocks.appVrchatAuthSessionEnd).toHaveBeenCalledWith({
            kind: 'logout'
        });
    });

    it('wraps platform command failures with the repository fallback message', async () => {
        commandMocks.appVrchatAuthSavedSnapshotGet.mockRejectedValueOnce(
            new Error('bridge unavailable')
        );

        await expect(authRepository.getSavedAuthSnapshot()).rejects.toThrow(
            'Auth saved snapshot failed: bridge unavailable'
        );
    });
});
