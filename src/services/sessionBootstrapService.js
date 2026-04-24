import { backend } from '@/platform/index.js';
import {
    configRepository,
    userSessionRepository
} from '@/repositories/index.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { syncStartupServicesTask } from './startupServicesStatus.js';
import { showSQLiteErrorDialog } from './sqliteErrorDialogService.js';

function getCurrentUserDisplayName(user) {
    return user?.displayName || user?.username || user?.id || '';
}

function normalizeBootstrapError(error) {
    return error instanceof Error ? error : new Error(String(error));
}

async function runAvatarAutoCleanup(userId) {
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
            (now - lastCleanup) / (1000 * 60 * 60 * 24);
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

async function restoreGameRunningState() {
    try {
        await backend.app.CheckGameRunning();
        return true;
    } catch (error) {
        console.warn(
            'CheckGameRunning is unavailable during session bootstrap:',
            error
        );
        return false;
    }
}

export async function bootstrapAuthenticatedSession(user) {
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

        const gameStateRestored = await restoreGameRunningState();

        sessionStore.setSessionState({
            isLoggedIn: true,
            isFriendsLoaded: false,
            isFavoritesLoaded: false,
            sessionPhase: 'ready'
        });
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
