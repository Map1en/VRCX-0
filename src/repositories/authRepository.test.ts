import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appVrchatAuthSavedSnapshotGet: vi.fn(),
    appVrchatAuthSavedCredentialDelete: vi.fn(),
    appVrchatAuthLogoutRecord: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));

import authRepository, {
    deleteSavedCredential,
    getSavedCredential,
    getSavedCredentialsMap,
    recordLogout
} from './authRepository';

function savedSnapshot(patch: Record<string, unknown> = {}) {
    return {
        lastUserLoggedIn: 'usr_1',
        savedCredentialCount: 1,
        autoLoginStatus: 'available',
        autoLoginReason: 'available',
        autoLoginDelayEnabled: false,
        autoLoginDelaySeconds: 0,
        savedCredentials: {
            usr_1: {
                user: {
                    id: 'usr_1',
                    displayName: 'User One'
                },
                loginParams: {
                    username: 'user@example.test'
                },
                hasLoginCredentials: true
            }
        },
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
            savedSnapshot({ lastUserLoggedIn: null, savedCredentialCount: 0 })
        );
        commandMocks.appVrchatAuthLogoutRecord.mockResolvedValue(
            savedSnapshot({ lastUserLoggedIn: null })
        );
    });

    it('extracts saved credential maps and single credential records from the saved snapshot', async () => {
        await expect(getSavedCredentialsMap()).resolves.toEqual(
            savedSnapshot().savedCredentials
        );
        await expect(getSavedCredential('usr_1')).resolves.toMatchObject({
            user: {
                id: 'usr_1',
                displayName: 'User One'
            },
            hasLoginCredentials: true
        });
        await expect(getSavedCredential('')).resolves.toBeNull();
        expect(
            commandMocks.appVrchatAuthSavedSnapshotGet
        ).toHaveBeenCalledTimes(2);
    });

    it('falls back to an empty saved credential map when the snapshot shape is missing', async () => {
        commandMocks.appVrchatAuthSavedSnapshotGet.mockResolvedValueOnce(
            savedSnapshot({ savedCredentials: null })
        );

        await expect(authRepository.getSavedCredentialsMap()).resolves.toEqual(
            {}
        );
    });

    it('normalizes saved credential delete input and returns the next snapshot', async () => {
        await expect(deleteSavedCredential('usr_2')).resolves.toMatchObject({
            lastUserLoggedIn: null,
            savedCredentialCount: 0
        });

        expect(
            commandMocks.appVrchatAuthSavedCredentialDelete
        ).toHaveBeenCalledWith({
            userId: 'usr_2'
        });
    });

    it('records logout with boolean-normalized options and explicit cookies', async () => {
        await recordLogout('usr_1', {
            clearLastUserLoggedIn: 1,
            cookies: null
        });

        expect(commandMocks.appVrchatAuthLogoutRecord).toHaveBeenCalledWith({
            userOrUserId: 'usr_1',
            clearLastUserLoggedIn: true,
            cookies: null
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
