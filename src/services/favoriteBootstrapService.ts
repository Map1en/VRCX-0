import { backend } from '@/platform/index.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import { notifyBackendVrchatAuthFailure } from './backendVrchatErrorService.js';
import { syncStartupServicesTask } from './startupServicesStatus.js';

const activeHydrations = new Map<string, Promise<unknown>>();

function normalizeUserId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function getDisplayName(user: Record<string, any> | null | undefined) {
    return user?.displayName || user?.username || user?.id || '';
}

function favoriteBootstrapKey(userId: unknown, endpoint = '') {
    return `${normalizeUserId(userId)}\u0000${String(endpoint || '')}`;
}

function isCurrentFavoriteBootstrapTarget(userId: string, endpoint = '') {
    const runtimeState = useRuntimeStore.getState();
    const sessionState = useSessionStore.getState();

    return (
        runtimeState.auth.currentUserId === userId &&
        runtimeState.auth.currentUserEndpoint === String(endpoint || '') &&
        sessionState.isLoggedIn &&
        sessionState.sessionPhase === 'ready'
    );
}

async function runFavoriteBootstrap({
    userId,
    endpoint = '',
    currentUserSnapshot
}) {
    const normalizedUserId = normalizeUserId(userId || currentUserSnapshot?.id);
    if (!normalizedUserId) {
        throw new Error(
            'Favorites hydration requires an authenticated user id.'
        );
    }

    const displayName = getDisplayName(currentUserSnapshot) || normalizedUserId;
    const friendRosterById = useFriendRosterStore.getState().friendsById;

    useFavoriteStore
        .getState()
        .setFavoritesLoading(
            normalizedUserId,
            `Loading favorites baseline for ${displayName}.`
        );
    useSessionStore.getState().setFavoritesLoaded(false);
    useRuntimeStore
        .getState()
        .setStartupTask(
            'services',
            'running',
            `Loading favorites baseline for ${displayName}.`
        );

    const result = await backend.app
        .BackendFavoritesBaselineGet({
            userId: normalizedUserId,
            endpoint,
            currentUserSnapshot,
            friendRosterById
        })
        .catch((error) => {
            notifyBackendVrchatAuthFailure(
                error,
                endpoint,
                'favorites baseline'
            );
            throw error;
        });
    const snapshot = result.snapshot as any;

    if (result.stale || !snapshot) {
        if (isCurrentFavoriteBootstrapTarget(normalizedUserId, endpoint)) {
            throw new Error(
                `Favorites baseline was stale for ${normalizedUserId}.`
            );
        }

        return {
            userId: normalizedUserId,
            stale: true,
            count: result.count ?? 0
        };
    }

    if (!isCurrentFavoriteBootstrapTarget(normalizedUserId, endpoint)) {
        return {
            userId: normalizedUserId,
            stale: true,
            count: result.count ?? 0
        };
    }

    useFavoriteStore.getState().setFavoritesSnapshot(snapshot);
    useSessionStore.getState().setFavoritesLoaded(true);
    syncStartupServicesTask([String(snapshot.detail || '')]);

    return {
        userId: normalizedUserId,
        stale: false,
        count: result.count ?? 0
    };
}

export function bootstrapFavorites(options) {
    const normalizedUserId = normalizeUserId(
        options?.userId || options?.currentUserSnapshot?.id
    );
    const currentUserSnapshot =
        options?.currentUserSnapshot &&
        typeof options.currentUserSnapshot === 'object'
            ? options.currentUserSnapshot
            : null;

    if (!normalizedUserId || !currentUserSnapshot) {
        return Promise.reject(
            new Error('Favorites hydration requires an authenticated user id.')
        );
    }

    const activeKey = favoriteBootstrapKey(normalizedUserId, options?.endpoint);
    if (activeHydrations.has(activeKey)) {
        return activeHydrations.get(activeKey);
    }

    const promise = runFavoriteBootstrap({
        ...options,
        userId: normalizedUserId,
        currentUserSnapshot
    })
        .catch((error) => {
            if (
                isCurrentFavoriteBootstrapTarget(
                    normalizedUserId,
                    options?.endpoint
                )
            ) {
                useRuntimeStore
                    .getState()
                    .setStartupTask(
                        'services',
                        'error',
                        error instanceof Error ? error.message : String(error)
                    );
                useFavoriteStore
                    .getState()
                    .setFavoritesError(
                        error instanceof Error ? error.message : String(error)
                    );
                useSessionStore.getState().setFavoritesLoaded(false);
            }

            throw error;
        })
        .finally(() => {
            activeHydrations.delete(activeKey);
        });

    activeHydrations.set(activeKey, promise);
    return promise;
}
