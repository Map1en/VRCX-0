import {
    commands,
    type SocialFavoritesBaselineOutput
} from '@/platform/tauri/bindings';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { syncStartupServicesTask } from './startupServicesStatus';

type FavoriteSnapshotRecord = Record<string, unknown> & {
    detail?: unknown;
};
type FavoriteBootstrapOptions = {
    userId?: unknown;
    endpoint?: unknown;
    currentUserSnapshot?: unknown;
};
type FavoriteBootstrapResult = {
    userId: string;
    stale: boolean;
    count: number;
};
type ActiveFavoriteHydration = {
    promise: Promise<FavoriteBootstrapResult>;
    invalidated: boolean;
};

const activeHydrations = new Map<string, ActiveFavoriteHydration>();

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function normalizeUserId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function getDisplayName(user: Record<string, unknown> | null | undefined) {
    return (
        normalizeUserId(user?.displayName) ||
        normalizeUserId(user?.username) ||
        normalizeUserId(user?.id)
    );
}

function favoriteBootstrapKey(userId: unknown, endpoint: unknown = '') {
    return `${normalizeUserId(userId)}\u0000${String(endpoint || '')}`;
}

function isCurrentFavoriteBootstrapTarget(
    userId: string,
    endpoint: unknown = ''
) {
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
    currentUserSnapshot,
    isCurrentTarget
}: FavoriteBootstrapOptions & {
    isCurrentTarget: () => boolean;
}): Promise<FavoriteBootstrapResult> {
    const currentSnapshot = isRecord(currentUserSnapshot)
        ? currentUserSnapshot
        : null;
    const normalizedUserId = normalizeUserId(userId || currentSnapshot?.id);
    if (!normalizedUserId) {
        throw new Error(
            'Favorites hydration requires an authenticated user id.'
        );
    }

    const displayName = getDisplayName(currentSnapshot) || normalizedUserId;
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

    const result: SocialFavoritesBaselineOutput =
        await commands.appSocialFavoritesBaselineGet({
            userId: normalizedUserId,
            endpoint: String(endpoint || ''),
            currentUserSnapshot: currentSnapshot,
            friendRosterById
        });
    const snapshot: FavoriteSnapshotRecord | null = isRecord(result.snapshot)
        ? result.snapshot
        : null;

    if (result.stale || !snapshot) {
        if (isCurrentTarget()) {
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

    if (!isCurrentTarget()) {
        return {
            userId: normalizedUserId,
            stale: true,
            count: result.count ?? 0
        };
    }

    const favoriteSnapshot = {
        ...snapshot,
        detail: String(snapshot.detail || '')
    };
    useFavoriteStore.getState().setFavoritesSnapshot(favoriteSnapshot);
    useSessionStore.getState().setFavoritesLoaded(true);
    syncStartupServicesTask([String(snapshot.detail || '')]);

    return {
        userId: normalizedUserId,
        stale: false,
        count: result.count ?? 0
    };
}

export function bootstrapFavorites(
    options: FavoriteBootstrapOptions
): Promise<FavoriteBootstrapResult> {
    const normalizedUserId = normalizeUserId(
        options?.userId ||
            (isRecord(options?.currentUserSnapshot)
                ? options.currentUserSnapshot.id
                : '')
    );
    const currentUserSnapshot = isRecord(options?.currentUserSnapshot)
        ? options.currentUserSnapshot
        : null;

    if (!normalizedUserId || !currentUserSnapshot) {
        return Promise.reject(
            new Error('Favorites hydration requires an authenticated user id.')
        );
    }

    const activeKey = favoriteBootstrapKey(normalizedUserId, options?.endpoint);
    const activeHydration = activeHydrations.get(activeKey);
    if (activeHydration && !activeHydration.invalidated) {
        return activeHydration.promise;
    }

    const hydration: ActiveFavoriteHydration = {
        promise: Promise.resolve({
            userId: normalizedUserId,
            stale: true,
            count: 0
        }),
        invalidated: false
    };
    const isCurrentTarget = () =>
        !hydration.invalidated &&
        isCurrentFavoriteBootstrapTarget(normalizedUserId, options?.endpoint);
    const invalidateIfStale = () => {
        if (
            isCurrentFavoriteBootstrapTarget(
                normalizedUserId,
                options?.endpoint
            )
        ) {
            return;
        }

        hydration.invalidated = true;
        if (activeHydrations.get(activeKey) === hydration) {
            activeHydrations.delete(activeKey);
        }
    };
    const unsubscribeSession = useSessionStore.subscribe(invalidateIfStale);
    const unsubscribeRuntime = useRuntimeStore.subscribe(invalidateIfStale);

    hydration.promise = runFavoriteBootstrap({
        ...options,
        userId: normalizedUserId,
        currentUserSnapshot,
        isCurrentTarget
    })
        .catch((error: unknown) => {
            if (isCurrentTarget()) {
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
            unsubscribeSession();
            unsubscribeRuntime();
            if (activeHydrations.get(activeKey) === hydration) {
                activeHydrations.delete(activeKey);
            }
        });

    activeHydrations.set(activeKey, hydration);
    return hydration.promise;
}
