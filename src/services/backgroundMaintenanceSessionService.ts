import { commands } from '@/platform/tauri/bindings';
import { isRecord } from '@/shared/utils/record';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

type RuntimeAuthSnapshot = {
    currentUserId: string | null;
    currentUserEndpoint: string;
    currentUserWebsocket: string;
    currentUserSnapshot: Record<string, unknown> | null;
};

type RuntimeAuthTarget = {
    currentUserId: string;
    currentUserEndpoint: string;
    currentUserWebsocket: string;
};

type RefreshCurrentUserOptions = {
    expectedUserId?: string;
    expectedEndpoint?: string;
    expectedWebsocket?: string;
};

function getRuntimeAuth(): RuntimeAuthSnapshot {
    const runtimeState = useRuntimeStore.getState();
    return {
        currentUserId: runtimeState.auth.currentUserId,
        currentUserEndpoint: runtimeState.auth.currentUserEndpoint,
        currentUserWebsocket: runtimeState.auth.currentUserWebsocket,
        currentUserSnapshot: isRecord(runtimeState.auth.currentUserSnapshot)
            ? runtimeState.auth.currentUserSnapshot
            : null
    };
}

function normalizeRuntimeAuthValue(value: string | null | undefined) {
    return value?.trim() ?? '';
}

export async function refreshCurrentUser({
    expectedUserId = '',
    expectedEndpoint = '',
    expectedWebsocket = ''
}: RefreshCurrentUserOptions = {}): Promise<boolean | null> {
    const auth = getRuntimeAuth();
    const target: RuntimeAuthTarget = {
        currentUserId: normalizeRuntimeAuthValue(
            expectedUserId || auth.currentUserId
        ),
        currentUserEndpoint: normalizeRuntimeAuthValue(
            expectedEndpoint || auth.currentUserEndpoint
        ),
        currentUserWebsocket: normalizeRuntimeAuthValue(
            expectedWebsocket || auth.currentUserWebsocket
        )
    };

    if (!target.currentUserId) {
        return null;
    }
    if (
        target.currentUserId !==
            normalizeRuntimeAuthValue(auth.currentUserId) ||
        target.currentUserEndpoint !==
            normalizeRuntimeAuthValue(auth.currentUserEndpoint) ||
        target.currentUserWebsocket !==
            normalizeRuntimeAuthValue(auth.currentUserWebsocket)
    ) {
        return null;
    }

    const result = await commands.appCurrentUserRefresh();
    return result.applied;
}

export async function refreshFriendAndFavoriteSnapshots(
    _options: { syncRealtime?: boolean } = {}
) {
    void _options;
    const auth = getRuntimeAuth();
    if (!auth.currentUserId || !auth.currentUserSnapshot) {
        return;
    }

    const result = await commands.appSocialBaselineRefresh();
    const favoritesSnapshot = result.favoritesSnapshot;
    if (!favoritesSnapshot) {
        return;
    }

    const latestAuth = getRuntimeAuth();
    const sessionState = useSessionStore.getState();
    if (
        latestAuth.currentUserId !== auth.currentUserId ||
        latestAuth.currentUserEndpoint !== auth.currentUserEndpoint ||
        !sessionState.isLoggedIn ||
        sessionState.sessionPhase !== 'ready'
    ) {
        return;
    }
    useFavoriteStore.getState().setFavoritesSnapshot(favoritesSnapshot);
    useSessionStore.getState().setFavoritesLoaded(true);
}
