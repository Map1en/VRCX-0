import { commands } from '@/platform/tauri/bindings';
import gameLogPersistenceRepository from '@/repositories/gameLogPersistenceRepository';
import { useInstanceJoinHistoryStore } from '@/state/instanceJoinHistoryStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { ensureCurrentAuthAttempt, type AuthAttempt } from './authAttempt';
import { restoreRuntimeGameLogProjectionFromPersistence } from './gameLogIngestService';
import { isHostCapabilityAvailable } from './hostCapabilityService';
import { syncStartupServicesTask } from './startupServicesStatus';

type AuthenticatedUser = Record<string, unknown> & {
    id?: unknown;
    displayName?: unknown;
    username?: unknown;
};

function getCurrentUserDisplayName(
    user: AuthenticatedUser | null | undefined
): string {
    return String(user?.displayName || user?.username || user?.id || '');
}

async function requestGameRunningStateRefresh(): Promise<boolean> {
    if (!isHostCapabilityAvailable('gameProcessMonitor')) {
        return false;
    }

    try {
        await commands.appCheckGameRunning();
        return true;
    } catch (error) {
        console.warn(
            'CheckGameRunning is unavailable during session bootstrap:',
            error
        );
        return false;
    }
}

async function refreshGroupInstances(): Promise<void> {
    try {
        await commands.appRuntimeGroupInstancesRefresh();
    } catch (error) {
        console.warn(
            'Group instances refresh failed after session bootstrap:',
            error
        );
    }
}

async function loadInstanceJoinHistory(userId: string): Promise<void> {
    try {
        const history =
            await gameLogPersistenceRepository.getInstanceJoinHistory(userId);
        useInstanceJoinHistoryStore.getState().setInstanceJoinHistory(history);
    } catch (error) {
        console.warn(
            'Instance join history is unavailable during session bootstrap:',
            error
        );
    }
}

export async function bootstrapAuthenticatedSession(
    user: AuthenticatedUser | null | undefined,
    attempt: AuthAttempt
): Promise<void> {
    const userId =
        typeof user?.id === 'string'
            ? user.id.trim()
            : String(user?.id ?? '').trim();
    if (!userId) {
        throw new Error('Session bootstrap requires an authenticated user id.');
    }

    const displayName = getCurrentUserDisplayName(user) || userId;
    const runtimeStore = useRuntimeStore.getState();
    const sessionStore = useSessionStore.getState();

    ensureCurrentAuthAttempt(attempt);
    sessionStore.setSessionState({
        isLoggedIn: false,
        isFriendsLoaded: false,
        isFavoritesLoaded: false,
        sessionPhase: 'bootstrapping'
    });
    runtimeStore.setStartupTask(
        'services',
        'running',
        `Preparing the interface for ${displayName}.`
    );

    const gameStateRestored = await requestGameRunningStateRefresh();
    ensureCurrentAuthAttempt(attempt);
    sessionStore.setSessionState({
        isLoggedIn: true,
        isFriendsLoaded: false,
        isFavoritesLoaded: false,
        sessionPhase: 'ready'
    });
    await refreshGroupInstances();
    ensureCurrentAuthAttempt(attempt);
    await loadInstanceJoinHistory(userId);
    ensureCurrentAuthAttempt(attempt);
    if (gameStateRestored) {
        await requestGameRunningStateRefresh();
        ensureCurrentAuthAttempt(attempt);
        await restoreRuntimeGameLogProjectionFromPersistence().catch(
            (error: unknown) => {
                console.warn(
                    'Current GameLog roster restore failed during session bootstrap:',
                    error
                );
            }
        );
        ensureCurrentAuthAttempt(attempt);
    }
    syncStartupServicesTask([
        `Authenticated session is ready for ${displayName}.`,
        gameStateRestored
            ? 'Host game state restore was requested.'
            : 'Host game state restore is unavailable in the current host.'
    ]);
}
