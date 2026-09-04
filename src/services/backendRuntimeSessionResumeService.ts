import type {
    AuthenticatedSessionProjection,
    AuthenticatedSessionSnapshot
} from '@/platform/tauri/bindings';
import { isRecord } from '@/shared/utils/record';
import { normalizeString } from '@/shared/utils/string';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';

import { beginAuthAttempt, isAuthAttemptSupersededError } from './authAttempt';
import {
    resetCurrentUserRuntimeAuth,
    setSignedOutSessionState
} from './authExecutionService';
import { recordCurrentUserSnapshot } from './domainIngestionService';
import { bootstrapAuthenticatedSession } from './sessionBootstrapService';
import { loadVrchatConfigSnapshot } from './vrchatConfigService';

type CurrentUserSnapshot = Record<string, unknown>;

function isCurrentAuthenticatedSessionProjection(
    projection: AuthenticatedSessionProjection
): boolean {
    const current = useRuntimeStore.getState().authenticatedSession;
    return current.revision === projection.revision;
}

function buildMinimalCurrentUserSnapshot(
    session: AuthenticatedSessionSnapshot,
    previousSnapshot: CurrentUserSnapshot | null
): CurrentUserSnapshot {
    const userId = normalizeString(session.userId);
    const displayName = normalizeString(session.displayName) || userId;
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

async function restoreVrchatConfigSnapshot(): Promise<void> {
    await loadVrchatConfigSnapshot().catch((error: unknown) => {
        console.warn(
            'Failed to restore the VRChat config snapshot from the backend runtime:',
            error
        );
    });
}

async function restoreVrcNotifications(): Promise<void> {
    await useVrcNotificationStore
        .getState()
        .loadForCurrentUser()
        .catch((error: unknown) => {
            console.warn(
                'Failed to restore VRChat notifications for the authenticated session:',
                error
            );
        });
}

function buildCurrentUserSnapshotForResume({
    session,
    previousSnapshot
}: {
    session: AuthenticatedSessionSnapshot;
    previousSnapshot: CurrentUserSnapshot | null;
}): CurrentUserSnapshot {
    const userId = normalizeString(session.userId);
    const projectedUserSnapshot = isRecord(session.currentUserSnapshot)
        ? session.currentUserSnapshot
        : null;
    if (
        projectedUserSnapshot &&
        normalizeString(projectedUserSnapshot.id) === userId
    ) {
        return {
            ...projectedUserSnapshot,
            id: userId,
            displayName:
                normalizeString(projectedUserSnapshot.displayName) ||
                normalizeString(session.displayName) ||
                userId
        };
    }

    return buildMinimalCurrentUserSnapshot(session, previousSnapshot);
}

export async function applyAuthenticatedSessionProjection(
    projection: AuthenticatedSessionProjection
): Promise<boolean> {
    const previousProjectionRevision =
        useRuntimeStore.getState().authenticatedSession.revision;
    if (
        !useRuntimeStore
            .getState()
            .setAuthenticatedSessionProjection(projection)
    ) {
        return false;
    }
    const session = projection.session;
    if (!session) {
        const sessionPhase = useSessionStore.getState().sessionPhase;
        if (
            projection.revision > previousProjectionRevision &&
            sessionPhase !== 'authenticating' &&
            sessionPhase !== 'bootstrapping'
        ) {
            beginAuthAttempt();
            resetCurrentUserRuntimeAuth();
            setSignedOutSessionState();
        }
        return false;
    }
    const sessionState = useSessionStore.getState();
    if (
        sessionState.sessionPhase === 'authenticating' ||
        sessionState.sessionPhase === 'bootstrapping'
    ) {
        return false;
    }

    const userId = normalizeString(session.userId);
    if (!userId || !isCurrentAuthenticatedSessionProjection(projection)) {
        return false;
    }

    const currentRuntimeState = useRuntimeStore.getState();
    const endpoint = normalizeString(session.endpoint);
    const websocket = normalizeString(session.websocket);
    const previousCurrentUserSnapshot = isRecord(
        currentRuntimeState.auth.currentUserSnapshot
    )
        ? currentRuntimeState.auth.currentUserSnapshot
        : null;
    if (sessionState.sessionPhase === 'ready') {
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
        if (
            useSessionStore.getState().sessionPhase !== 'ready' ||
            !isCurrentAuthenticatedSessionProjection(projection)
        ) {
            return false;
        }
        const currentUserSnapshot = buildCurrentUserSnapshotForResume({
            session,
            previousSnapshot: previousCurrentUserSnapshot
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: userId,
            currentUserDisplayName:
                normalizeString(currentUserSnapshot.displayName) ||
                normalizeString(session.displayName) ||
                userId,
            currentUserEndpoint: endpoint,
            currentUserWebsocket: websocket,
            currentUserSnapshot
        });
        recordCurrentUserSnapshot(currentUserSnapshot, { endpoint });
        await restoreVrchatConfigSnapshot();
        await restoreVrcNotifications();
        return true;
    }

    const currentUserSnapshot = buildCurrentUserSnapshotForResume({
        session,
        previousSnapshot: previousCurrentUserSnapshot
    });
    const attempt = beginAuthAttempt();
    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: userId,
        currentUserDisplayName:
            normalizeString(currentUserSnapshot.displayName) ||
            normalizeString(session.displayName) ||
            userId,
        currentUserEndpoint: endpoint,
        currentUserWebsocket: websocket,
        currentUserSnapshot
    });
    recordCurrentUserSnapshot(currentUserSnapshot, { endpoint });
    await restoreVrchatConfigSnapshot();

    try {
        await bootstrapAuthenticatedSession(currentUserSnapshot, attempt);
    } catch (error) {
        if (isAuthAttemptSupersededError(error)) {
            return false;
        }
        throw error;
    }
    await restoreVrcNotifications();
    return true;
}
