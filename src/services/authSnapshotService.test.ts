import { beforeEach, describe, expect, it, vi } from 'vitest';

const repositoryMocks = vi.hoisted(() => ({
    getSavedAuthSnapshot: vi.fn(),
    deleteSavedCredential: vi.fn()
}));

vi.mock('@/repositories/authRepository', () => ({
    default: repositoryMocks
}));

import type { SavedAuthSnapshot } from '@/repositories/authRepository';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    applySavedAuthSnapshot,
    deleteSavedAuthSnapshot,
    refreshSavedAuthSnapshot
} from './authSnapshotService';

function snapshot(patch: Partial<SavedAuthSnapshot> = {}): SavedAuthSnapshot {
    return {
        lastUserLoggedIn: 'usr_1',
        autoLoginStatus: 'available',
        autoLoginReason: 'ready',
        autoLoginDelayEnabled: false,
        autoLoginDelaySeconds: 0,
        savedCredentialsList: [
            {
                user: { id: 'usr_1', displayName: 'User One' },
                loginParams: { username: 'user@example.test' },
                hasLoginCredentials: true,
                hasCookies: false
            }
        ],
        ...patch
    };
}

describe('authSnapshotService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        repositoryMocks.getSavedAuthSnapshot.mockResolvedValue(snapshot());
        repositoryMocks.deleteSavedCredential.mockResolvedValue(
            snapshot({
                lastUserLoggedIn: null,
                savedCredentialsList: [],
                autoLoginStatus: 'missing-last-user',
                autoLoginReason: 'missing'
            })
        );
    });

    it('applies an available saved-auth snapshot to runtime auth and startup state', () => {
        const applied = applySavedAuthSnapshot(snapshot());

        expect(applied).toMatchObject({
            lastUserLoggedIn: 'usr_1',
            autoLoginStatus: 'available'
        });
        expect(useRuntimeStore.getState().auth).toMatchObject({
            lastUserLoggedIn: 'usr_1',
            savedCredentialCount: 1,
            autoLoginStatus: 'available',
            autoLoginReason: 'ready',
            autoLoginDelayEnabled: false,
            autoLoginDelaySeconds: 0
        });
        expect(useRuntimeStore.getState().startup.auth).toMatchObject({
            status: 'pending',
            detail: 'ready'
        });
    });

    it('marks missing saved credentials as a completed auth startup task', () => {
        applySavedAuthSnapshot(
            snapshot({
                autoLoginStatus: 'missing-credentials',
                autoLoginReason: 'no password'
            })
        );

        expect(useRuntimeStore.getState().startup.auth).toMatchObject({
            status: 'completed',
            detail: 'no password'
        });
    });

    it('refreshes and deletes snapshots through authRepository before applying them', async () => {
        await expect(refreshSavedAuthSnapshot()).resolves.toMatchObject({
            lastUserLoggedIn: 'usr_1'
        });
        await expect(deleteSavedAuthSnapshot('usr_1')).resolves.toMatchObject({
            savedCredentialsList: []
        });

        expect(repositoryMocks.getSavedAuthSnapshot).toHaveBeenCalledTimes(1);
        expect(repositoryMocks.deleteSavedCredential).toHaveBeenCalledWith(
            'usr_1'
        );
        expect(useRuntimeStore.getState().auth).toMatchObject({
            lastUserLoggedIn: null,
            savedCredentialCount: 0,
            autoLoginStatus: 'missing-last-user'
        });
    });
});
