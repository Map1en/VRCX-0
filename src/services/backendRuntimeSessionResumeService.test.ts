import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    AuthenticatedSessionProjection,
    AuthenticatedSessionSnapshot
} from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    recordCurrentUserSnapshot: vi.fn(),
    resetDomainFacts: vi.fn(),
    bootstrapAuthenticatedSession: vi.fn(),
    loadVrchatConfigSnapshot: vi.fn(),
    resetVrchatConfigSnapshot: vi.fn()
}));

vi.mock('./domainIngestionService', () => ({
    recordCurrentUserSnapshot: mocks.recordCurrentUserSnapshot,
    resetDomainFacts: mocks.resetDomainFacts
}));

vi.mock('./sessionBootstrapService', () => ({
    bootstrapAuthenticatedSession: mocks.bootstrapAuthenticatedSession
}));

vi.mock('./vrchatConfigService', () => ({
    loadVrchatConfigSnapshot: mocks.loadVrchatConfigSnapshot,
    resetVrchatConfigSnapshot: mocks.resetVrchatConfigSnapshot
}));

import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';

import { AuthAttemptSupersededError } from './authAttempt';
import { applyAuthenticatedSessionProjection } from './backendRuntimeSessionResumeService';

const USER_ID = 'usr_owner';
const ENDPOINT = 'https://api.vrchat.cloud/api/1';
const WEBSOCKET = 'wss://pipeline.vrchat.cloud';

function authenticatedSession(
    patch: Partial<AuthenticatedSessionSnapshot> = {}
): AuthenticatedSessionSnapshot {
    return {
        authScopeGeneration: 3,
        userId: USER_ID,
        displayName: 'Frontend User',
        endpoint: ENDPOINT,
        websocket: WEBSOCKET,
        currentUserSnapshot: {
            id: USER_ID,
            displayName: 'Frontend User',
            username: 'frontend_user'
        },
        ...patch
    };
}

function sessionProjection(
    session: AuthenticatedSessionSnapshot | null = authenticatedSession(),
    revision = 3
): AuthenticatedSessionProjection {
    return { revision, session };
}

describe('backendRuntimeSessionResumeService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        mocks.bootstrapAuthenticatedSession.mockResolvedValue(undefined);
        mocks.loadVrchatConfigSnapshot.mockResolvedValue({});
    });

    it('rejects a projection without an authenticated session', async () => {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: USER_ID,
            currentUserEndpoint: ENDPOINT,
            currentUserWebsocket: WEBSOCKET
        });
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            sessionPhase: 'ready'
        });

        await expect(
            applyAuthenticatedSessionProjection(sessionProjection(null))
        ).resolves.toBe(false);

        expect(useRuntimeStore.getState().auth.currentUserId).toBeNull();
        expect(useSessionStore.getState()).toMatchObject({
            isLoggedIn: false,
            sessionPhase: 'signed_out'
        });
        expect(mocks.recordCurrentUserSnapshot).not.toHaveBeenCalled();
        expect(mocks.bootstrapAuthenticatedSession).not.toHaveBeenCalled();
    });

    it('does not let a transitional clear supersede an active frontend login', async () => {
        useSessionStore.getState().setSessionPhase('authenticating');

        await expect(
            applyAuthenticatedSessionProjection(sessionProjection(null))
        ).resolves.toBe(false);

        expect(useSessionStore.getState().sessionPhase).toBe('authenticating');
    });

    it('rejects an older projection after a newer revision was applied', async () => {
        useRuntimeStore
            .getState()
            .setAuthenticatedSessionProjection(sessionProjection(null, 4));

        await expect(
            applyAuthenticatedSessionProjection(
                sessionProjection(authenticatedSession(), 3)
            )
        ).resolves.toBe(false);

        expect(mocks.recordCurrentUserSnapshot).not.toHaveBeenCalled();
        expect(mocks.bootstrapAuthenticatedSession).not.toHaveBeenCalled();
    });

    it('does not resume while the frontend is authenticating', async () => {
        useSessionStore.getState().setSessionPhase('authenticating');

        await expect(
            applyAuthenticatedSessionProjection(sessionProjection())
        ).resolves.toBe(false);
        expect(mocks.recordCurrentUserSnapshot).not.toHaveBeenCalled();
        expect(mocks.bootstrapAuthenticatedSession).not.toHaveBeenCalled();
    });

    it('retries the same projection after frontend authentication finishes', async () => {
        const projection = sessionProjection();
        useSessionStore.getState().setSessionPhase('authenticating');

        await expect(
            applyAuthenticatedSessionProjection(projection)
        ).resolves.toBe(false);
        useSessionStore.getState().setSessionPhase('authenticated');

        await expect(
            applyAuthenticatedSessionProjection(projection)
        ).resolves.toBe(true);
        expect(mocks.bootstrapAuthenticatedSession).toHaveBeenCalledTimes(1);
    });

    it('keeps a ready frontend session unchanged when its connection already matches', async () => {
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: USER_ID,
            currentUserDisplayName: 'Current User',
            currentUserEndpoint: ENDPOINT,
            currentUserWebsocket: WEBSOCKET,
            currentUserSnapshot: {
                id: USER_ID,
                displayName: 'Current User'
            }
        });
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            sessionPhase: 'ready'
        });

        await expect(
            applyAuthenticatedSessionProjection(sessionProjection())
        ).resolves.toBe(false);

        expect(useRuntimeStore.getState().auth.currentUserDisplayName).toBe(
            'Current User'
        );
        expect(mocks.recordCurrentUserSnapshot).not.toHaveBeenCalled();
        expect(mocks.bootstrapAuthenticatedSession).not.toHaveBeenCalled();
    });

    it('updates only the ready session mirror when its backend connection changes', async () => {
        const nextEndpoint = 'https://api.example.test/api/1';
        const nextWebsocket = 'wss://pipeline.example.test';
        const nextAuthenticatedSession = authenticatedSession({
            endpoint: nextEndpoint,
            websocket: nextWebsocket
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserId: USER_ID,
            currentUserDisplayName: 'Current User',
            currentUserEndpoint: ENDPOINT,
            currentUserWebsocket: WEBSOCKET
        });
        useSessionStore.getState().setSessionState({
            isLoggedIn: true,
            sessionPhase: 'ready'
        });

        await expect(
            applyAuthenticatedSessionProjection(
                sessionProjection(nextAuthenticatedSession)
            )
        ).resolves.toBe(true);

        expect(useRuntimeStore.getState().auth).toMatchObject({
            currentUserId: USER_ID,
            currentUserDisplayName: 'Frontend User',
            currentUserEndpoint: nextEndpoint,
            currentUserWebsocket: nextWebsocket,
            currentUserSnapshot: nextAuthenticatedSession.currentUserSnapshot
        });
        expect(mocks.recordCurrentUserSnapshot).toHaveBeenCalledWith(
            nextAuthenticatedSession.currentUserSnapshot,
            { endpoint: nextEndpoint }
        );
        expect(mocks.loadVrchatConfigSnapshot).toHaveBeenCalledTimes(1);
        expect(mocks.bootstrapAuthenticatedSession).not.toHaveBeenCalled();
    });

    it('bootstraps a matching backend session when the frontend is not ready', async () => {
        const loadNotifications = vi
            .spyOn(useVrcNotificationStore.getState(), 'loadForCurrentUser')
            .mockResolvedValue([]);
        useSessionStore.getState().setSessionPhase('authenticated');

        await expect(
            applyAuthenticatedSessionProjection(sessionProjection())
        ).resolves.toBe(true);

        expect(useRuntimeStore.getState().auth).toMatchObject({
            currentUserId: USER_ID,
            currentUserDisplayName: 'Frontend User',
            currentUserEndpoint: ENDPOINT,
            currentUserWebsocket: WEBSOCKET,
            currentUserSnapshot: authenticatedSession().currentUserSnapshot
        });
        expect(mocks.recordCurrentUserSnapshot).toHaveBeenCalledWith(
            authenticatedSession().currentUserSnapshot,
            { endpoint: ENDPOINT }
        );
        expect(mocks.loadVrchatConfigSnapshot).toHaveBeenCalledTimes(1);
        expect(mocks.bootstrapAuthenticatedSession).toHaveBeenCalledWith(
            authenticatedSession().currentUserSnapshot,
            expect.any(Number)
        );
        expect(loadNotifications).toHaveBeenCalledOnce();
    });

    it('returns false when bootstrap is superseded by a newer auth attempt', async () => {
        mocks.bootstrapAuthenticatedSession.mockRejectedValueOnce(
            new AuthAttemptSupersededError()
        );

        await expect(
            applyAuthenticatedSessionProjection(sessionProjection())
        ).resolves.toBe(false);

        expect(mocks.recordCurrentUserSnapshot).toHaveBeenCalledTimes(1);
        expect(mocks.bootstrapAuthenticatedSession).toHaveBeenCalledTimes(1);
    });
});
