import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import userSessionRepository from '@/repositories/userSessionRepository';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

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

async function runAvatarAutoCleanup(userId: string): Promise<boolean> {
    const cleanupSetting = await configRepository.getString(
        'VRCX_avatarAutoCleanup',
        'Off'
    );
    if (cleanupSetting === 'Off') {
        return false;
    }

    const days = Number.parseInt(cleanupSetting, 10);
    if (Number.isNaN(days) || days <= 0) {
        return false;
    }

    const configKey = `lastAvatarCleanupDate_${userId}`;
    const lastCleanupStr = await configRepository.getString(configKey, '');
    const now = new Date();

    if (lastCleanupStr) {
        const lastCleanup = new Date(lastCleanupStr);
        const daysSinceLastCleanup =
            (now.getTime() - lastCleanup.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceLastCleanup < 7) {
            return false;
        }
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    await userSessionRepository.purgeAvatarFeedData(userId, cutoff.toJSON());
    await configRepository.setString(configKey, now.toJSON());
    return true;
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

async function syncBackendFrontendSession(userId: string): Promise<void> {
    const auth = useRuntimeStore.getState().auth;
    const currentUserSnapshot = auth.currentUserSnapshot || { id: userId };
    try {
        await commands.appSyncFrontendAuthenticatedSession(
            userId,
            String(auth.currentUserEndpoint || ''),
            String(auth.currentUserWebsocket || ''),
            currentUserSnapshot
        );
    } catch (error) {
        console.warn(
            'Backend frontend session sync failed during session bootstrap:',
            error
        );
        return;
    }
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

        const avatarCleanupRan = await runAvatarAutoCleanup(userId);

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
        await syncBackendFrontendSession(userId);
        if (gameStateRestored) {
            await requestGameRunningStateRefresh();
        }
        syncStartupServicesTask([
            `Authenticated session is ready for ${displayName}.`,
            avatarCleanupRan
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
