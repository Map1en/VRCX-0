import { authRepository } from '@/repositories/index.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

function describeAuthStartupTask(snapshot) {
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
            detail: snapshot.autoLoginReason || 'No saved credentials were detected.'
        };
    }
}

export function applySavedAuthSnapshot(snapshot) {
    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setAuthBootstrap({
        lastUserLoggedIn: snapshot.lastUserLoggedIn,
        savedCredentialCount: snapshot.savedCredentialCount,
        autoLoginStatus: snapshot.autoLoginStatus,
        autoLoginReason: snapshot.autoLoginReason,
        enableCustomEndpoint: snapshot.enableCustomEndpoint,
        autoLoginDelayEnabled: snapshot.autoLoginDelayEnabled,
        autoLoginDelaySeconds: snapshot.autoLoginDelaySeconds
    });

    const task = describeAuthStartupTask(snapshot);
    runtimeStore.setStartupTask('auth', task.status, task.detail);
    return snapshot;
}

export async function refreshSavedAuthSnapshot() {
    const snapshot = await authRepository.getSavedAuthSnapshot();
    return applySavedAuthSnapshot(snapshot);
}

export async function deleteSavedAuthSnapshot(userId) {
    const snapshot = await authRepository.deleteSavedCredential(userId);
    return applySavedAuthSnapshot(snapshot);
}

export async function setSavedAuthCustomEndpointEnabled(value) {
    const snapshot = await authRepository.setCustomEndpointEnabled(value);
    return applySavedAuthSnapshot(snapshot);
}
