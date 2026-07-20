import { commands } from '@/platform/tauri/bindings';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { ensureCurrentAuthAttempt, type AuthAttempt } from './authAttempt';
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
    if (gameStateRestored) {
        await requestGameRunningStateRefresh();
        ensureCurrentAuthAttempt(attempt);
    }
    syncStartupServicesTask([
        `Authenticated session is ready for ${displayName}.`,
        gameStateRestored
            ? 'Host game state restore was requested.'
            : 'Host game state restore is unavailable in the current host.'
    ]);
}
