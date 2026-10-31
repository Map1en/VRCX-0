import {
    commands,
    type RuntimeOperationStatus
} from '@/platform/tauri/bindings';
import authRepository, {
    type SavedAuthSnapshot
} from '@/repositories/authRepository';
import { useRuntimeStore } from '@/state/runtimeStore';

type AuthStartupTask = {
    status: RuntimeOperationStatus;
    detail: string;
};

function describeAuthStartupTask(snapshot: SavedAuthSnapshot): AuthStartupTask {
    switch (snapshot.autoLoginStatus) {
        case 'available':
            return {
                status: 'pending',
                detail: snapshot.autoLoginReason
            };
        case 'missing-last-user':
        case 'missing-credentials':
            return {
                status: 'completed',
                detail: snapshot.autoLoginReason
            };
        default:
            return {
                status: 'completed',
                detail:
                    snapshot.autoLoginReason ||
                    'No saved credentials were detected.'
            };
    }
}

let cachedAuthSnapshot: SavedAuthSnapshot | null = null;

export function applySavedAuthSnapshot(
    snapshot: SavedAuthSnapshot
): SavedAuthSnapshot {
    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setAuthBootstrap({
        lastUserLoggedIn: snapshot.lastUserLoggedIn,
        savedCredentialCount: snapshot.savedCredentialsList.length,
        autoLoginStatus: snapshot.autoLoginStatus,
        autoLoginReason: snapshot.autoLoginReason,
        autoLoginDelayEnabled: snapshot.autoLoginDelayEnabled,
        autoLoginDelaySeconds: snapshot.autoLoginDelaySeconds
    });

    const task = describeAuthStartupTask(snapshot);
    runtimeStore.setStartupTask('auth', task.status, task.detail);
    cachedAuthSnapshot = snapshot;
    return snapshot;
}

export async function refreshSavedAuthSnapshot() {
    const snapshot = await authRepository.getSavedAuthSnapshot();
    return applySavedAuthSnapshot(snapshot);
}

export function getCachedAuthSnapshot(): SavedAuthSnapshot | null {
    return cachedAuthSnapshot;
}

export async function clearSavedPassword(userId: string) {
    return applySavedAuthSnapshot(
        await commands.appVrchatAuthSavedPasswordClear({ userId })
    );
}

export async function deleteSavedAuthSnapshot(userId: string) {
    const snapshot = await authRepository.deleteSavedCredential(userId);
    return applySavedAuthSnapshot(snapshot);
}
