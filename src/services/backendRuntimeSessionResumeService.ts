import { commands } from '@/platform/tauri/bindings';
import type {
    BackendRuntimeFrontendSessionSnapshot,
    BackendRuntimeSnapshot,
    RuntimeAuthScopeSnapshot
} from '@/platform/tauri/bindings';
import { normalizeString } from '@/shared/utils/string';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { recordCurrentUserSnapshot } from './domainIngestionService';
import { bootstrapAuthenticatedSession } from './sessionBootstrapService';

type CurrentUserSnapshot = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function isAuthenticatedBackendRuntime(
    snapshot: BackendRuntimeSnapshot | Record<string, unknown> | null
): snapshot is BackendRuntimeSnapshot {
    return Boolean(
        isRecord(snapshot) &&
        snapshot.phase === 'running' &&
        snapshot.authStatus === 'authenticated' &&
        normalizeString(snapshot.authUserId)
    );
}

function isCurrentAuthenticatedBackendRuntimeUser(userId: string): boolean {
    const snapshot = useRuntimeStore.getState().backendRuntime;
    return Boolean(
        isAuthenticatedBackendRuntime(snapshot) &&
        normalizeString(snapshot.authUserId) === userId
    );
}

function frontendSessionMatchesUser(
    frontendSessionSnapshot: BackendRuntimeFrontendSessionSnapshot | null,
    userId: string
): boolean {
    if (!frontendSessionSnapshot) {
        return true;
    }
    const frontendUserId =
        normalizeString(frontendSessionSnapshot.userId) ||
        normalizeString(
            isRecord(frontendSessionSnapshot.currentUserSnapshot)
                ? frontendSessionSnapshot.currentUserSnapshot.id
                : ''
        );
    return (
        frontendSessionSnapshot.authenticated === true &&
        frontendUserId === userId
    );
}

function authScopeMatchesUser(
    scope: RuntimeAuthScopeSnapshot | null,
    userId: string
): boolean {
    return Boolean(
        scope?.active === true &&
        normalizeString(scope.currentUserId) === userId
    );
}

function buildMinimalCurrentUserSnapshot(
    snapshot: BackendRuntimeSnapshot,
    previousSnapshot: CurrentUserSnapshot | null
): CurrentUserSnapshot {
    const userId = normalizeString(snapshot.authUserId);
    const displayName = normalizeString(snapshot.authDisplayName) || userId;
    if (previousSnapshot && normalizeString(previousSnapshot.id) === userId) {
        return {
            ...previousSnapshot,
            id: userId,
            displayName: previousSnapshot.displayName || displayName
        };
    }
    return {
        id: userId,
        displayName
    };
}

async function getBackendFrontendSessionSnapshot() {
    return commands
        .appGetBackendRuntimeFrontendSessionSnapshot()
        .catch((): null => null);
}

function buildCurrentUserSnapshotForResume({
    runtimeSnapshot,
    frontendSessionSnapshot,
    previousSnapshot
}: {
    runtimeSnapshot: BackendRuntimeSnapshot;
    frontendSessionSnapshot: BackendRuntimeFrontendSessionSnapshot | null;
    previousSnapshot: CurrentUserSnapshot | null;
}): CurrentUserSnapshot {
    const userId = normalizeString(runtimeSnapshot.authUserId);
    const frontendUserSnapshot = isRecord(
        frontendSessionSnapshot?.currentUserSnapshot
    )
        ? frontendSessionSnapshot.currentUserSnapshot
        : null;
    if (
        frontendUserSnapshot &&
        normalizeString(frontendUserSnapshot.id) === userId
    ) {
        return {
            ...frontendUserSnapshot,
            id: userId,
            displayName:
                normalizeString(frontendUserSnapshot.displayName) ||
                normalizeString(runtimeSnapshot.authDisplayName) ||
                userId
        };
    }

    return buildMinimalCurrentUserSnapshot(runtimeSnapshot, previousSnapshot);
}

export async function resumeFrontendSessionFromBackendRuntime(
    snapshot: BackendRuntimeSnapshot | Record<string, unknown> | null
): Promise<boolean> {
    if (!isAuthenticatedBackendRuntime(snapshot)) {
        return false;
    }

    const sessionState = useSessionStore.getState();
    if (
        sessionState.sessionPhase === 'authenticating' ||
        sessionState.sessionPhase === 'bootstrapping'
    ) {
        return false;
    }

    const userId = normalizeString(snapshot.authUserId);
    const [scope, frontendSessionSnapshot] = await Promise.all([
        commands.appRuntimeAuthScopeGet().catch((): null => null),
        getBackendFrontendSessionSnapshot()
    ]);
    const latestSessionState = useSessionStore.getState();
    if (
        latestSessionState.sessionPhase === 'authenticating' ||
        latestSessionState.sessionPhase === 'bootstrapping'
    ) {
        return false;
    }
    if (
        !authScopeMatchesUser(scope, userId) ||
        !isCurrentAuthenticatedBackendRuntimeUser(userId) ||
        !frontendSessionMatchesUser(frontendSessionSnapshot, userId)
    ) {
        return false;
    }

    const currentRuntimeState = useRuntimeStore.getState();
    const endpoint =
        normalizeString(frontendSessionSnapshot?.endpoint) ||
        normalizeString(scope?.endpoint) ||
        normalizeString(currentRuntimeState.auth.currentUserEndpoint);
    const websocket =
        normalizeString(frontendSessionSnapshot?.websocket) ||
        normalizeString(currentRuntimeState.auth.currentUserWebsocket);
    const currentUserSnapshot = buildCurrentUserSnapshotForResume({
        runtimeSnapshot: snapshot,
        frontendSessionSnapshot,
        previousSnapshot: isRecord(currentRuntimeState.auth.currentUserSnapshot)
            ? currentRuntimeState.auth.currentUserSnapshot
            : null
    });
    if (latestSessionState.sessionPhase === 'ready') {
        if (
            normalizeString(currentRuntimeState.auth.currentUserId) !== userId
        ) {
            return false;
        }
        if (
            normalizeString(currentRuntimeState.auth.currentUserEndpoint) ===
                endpoint &&
            normalizeString(currentRuntimeState.auth.currentUserWebsocket) ===
                websocket
        ) {
            return false;
        }
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: userId,
            currentUserDisplayName:
                normalizeString(currentUserSnapshot.displayName) ||
                normalizeString(snapshot.authDisplayName) ||
                userId,
            currentUserEndpoint: endpoint,
            currentUserWebsocket: websocket,
            currentUserSnapshot
        });
        recordCurrentUserSnapshot(currentUserSnapshot, { endpoint });
        return true;
    }

    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: userId,
        currentUserDisplayName:
            normalizeString(currentUserSnapshot.displayName) ||
            normalizeString(snapshot.authDisplayName) ||
            userId,
        currentUserEndpoint: endpoint,
        currentUserWebsocket: websocket,
        currentUserSnapshot
    });
    recordCurrentUserSnapshot(currentUserSnapshot, { endpoint });

    await bootstrapAuthenticatedSession(currentUserSnapshot);
    return true;
}
