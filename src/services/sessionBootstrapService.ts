import { commands } from '@/platform/tauri/bindings';
import userSessionRepository from '@/repositories/userSessionRepository';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { applyAuthenticatedRuntimePhaseSnapshot } from './authenticatedRuntimeService';
import { isHostCapabilityAvailable } from './hostCapabilityService';
import { showSQLiteErrorDialog } from './sqliteErrorDialogService';
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

function normalizeBootstrapError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
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

async function startBackendAuthenticatedRuntime(userId: string): Promise<void> {
    const auth = useRuntimeStore.getState().auth;
    const currentUserSnapshot = auth.currentUserSnapshot || { id: userId };
    applyAuthenticatedRuntimePhaseSnapshot(
        await commands.appAuthenticatedRuntimeSessionStart(
            userId,
            String(auth.currentUserEndpoint || ''),
            String(auth.currentUserWebsocket || ''),
            currentUserSnapshot
        )
    );
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
    user: AuthenticatedUser | null | undefined
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

    sessionStore.setSessionState({
        isLoggedIn: false,
        isFriendsLoaded: false,
        isFavoritesLoaded: false,
        sessionPhase: 'bootstrapping'
    });
    runtimeStore.setStartupTask(
        'services',
        'running',
        `Preparing session data for ${displayName}.`
    );

    try {
        await userSessionRepository.ensureUserTables(userId);
        runtimeStore.setStartupTask(
            'services',
            'running',
            `Per-user tables are ready for ${displayName}. Applying startup maintenance.`
        );
        const maintenance =
            await commands.appAuthenticatedSessionMaintenanceRun();

        runtimeStore.setStartupTask(
            'services',
            'running',
            `Per-user tables are ready for ${displayName}. Restoring host game state.`
        );

        const gameStateRestored = await requestGameRunningStateRefresh();

        sessionStore.setSessionState({
            isLoggedIn: true,
            isFriendsLoaded: false,
            isFavoritesLoaded: false,
            sessionPhase: 'ready'
        });
        await startBackendAuthenticatedRuntime(userId);
        if (gameStateRestored) {
            await requestGameRunningStateRefresh();
        }
        syncStartupServicesTask([
            `Authenticated session is ready for ${displayName}.`,
            maintenance.avatarCleanup.state === 'ran'
                ? 'Avatar cleanup ran.'
                : 'Avatar cleanup was not needed.',
            gameStateRestored
                ? 'Host game state restore was requested.'
                : 'Host game state restore is unavailable in the current host.'
        ]);
    } catch (error) {
        sessionStore.setSessionState({
            isLoggedIn: false,
            isFriendsLoaded: false,
            isFavoritesLoaded: false,
            sessionPhase: 'error'
        });
        runtimeStore.setStartupTask(
            'services',
            'error',
            normalizeBootstrapError(error).message
        );
        await showSQLiteErrorDialog(error);
        throw normalizeBootstrapError(error);
    }
}
