import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { SavedAuthSnapshot } from '@/repositories/authRepository';
import { executeReactAutoLogin } from '@/services/authAutoLoginService';
import { useRuntimeStore } from '@/state/runtimeStore';

import { getLoginErrorMessage as getErrorMessage } from './loginDisplay';

type LoginAutoLoginOptions = {
    activeSavedUserId: string;
    applySnapshot: (snapshot: SavedAuthSnapshot) => void;
    databaseReady: boolean;
    isLoading: boolean;
    isSubmitting: boolean;
    snapshot: SavedAuthSnapshot | null;
};

function getAutoLoginSnapshotKey(snapshot: SavedAuthSnapshot | null): string {
    const userId =
        typeof snapshot?.lastUserLoggedIn === 'string'
            ? snapshot.lastUserLoggedIn
            : '';
    if (!snapshot || !userId) {
        return '';
    }
    const savedCredential = snapshot.savedCredentials?.[userId];

    return JSON.stringify({
        userId,
        username: savedCredential?.loginParams?.username || '',
        hasCookies: Boolean(savedCredential?.hasCookies),
        hasSavedCredential: Boolean(savedCredential),
        autoLoginStatus: snapshot.autoLoginStatus,
        autoLoginDelayEnabled: Boolean(snapshot.autoLoginDelayEnabled),
        autoLoginDelaySeconds: snapshot.autoLoginDelaySeconds || 0
    });
}

export function useLoginAutoLogin({
    activeSavedUserId,
    applySnapshot,
    databaseReady,
    isLoading,
    isSubmitting,
    snapshot
}: LoginAutoLoginOptions) {
    const { t } = useTranslation();
    const backendRuntimeSnapshotHydrated = useRuntimeStore(
        (state) => state.shell.backendRuntimeSnapshotHydrated
    );
    const autoLoginSuppressedKeyRef = useRef('');
    const autoLoginInFlightKeyRef = useRef('');
    const autoLoginAbortRef = useRef<AbortController | null>(null);
    const isAutoLoginStartBlocked =
        !databaseReady ||
        !backendRuntimeSnapshotHydrated ||
        isSubmitting ||
        Boolean(activeSavedUserId);

    function cancelPendingAutoLogin(): void {
        const controller = autoLoginAbortRef.current;
        if (controller) {
            if (autoLoginInFlightKeyRef.current) {
                autoLoginSuppressedKeyRef.current =
                    autoLoginInFlightKeyRef.current;
            }
            controller.abort();
            autoLoginAbortRef.current = null;
            autoLoginInFlightKeyRef.current = '';
        }
    }

    useEffect(() => {
        const shouldAttemptCookieRestore = Boolean(snapshot?.lastUserLoggedIn);
        const shouldAttemptSavedCredentialFallback =
            snapshot?.autoLoginStatus === 'available';

        if (
            isLoading ||
            isAutoLoginStartBlocked ||
            (!shouldAttemptCookieRestore &&
                !shouldAttemptSavedCredentialFallback)
        ) {
            return undefined;
        }

        const userId = snapshot?.lastUserLoggedIn;
        const autoLoginSnapshotKey = getAutoLoginSnapshotKey(snapshot);
        if (
            !userId ||
            !autoLoginSnapshotKey ||
            autoLoginSuppressedKeyRef.current === autoLoginSnapshotKey ||
            autoLoginInFlightKeyRef.current === autoLoginSnapshotKey
        ) {
            return undefined;
        }

        autoLoginInFlightKeyRef.current = autoLoginSnapshotKey;
        const controller = new AbortController();
        autoLoginAbortRef.current = controller;
        let active = true;

        executeReactAutoLogin(snapshot, {
            signal: controller.signal
        })
            .then((result) => {
                if (!active) {
                    return;
                }

                autoLoginAbortRef.current = null;
                if (autoLoginInFlightKeyRef.current === autoLoginSnapshotKey) {
                    autoLoginInFlightKeyRef.current = '';
                }
                if (result.status !== 'skipped') {
                    autoLoginSuppressedKeyRef.current = autoLoginSnapshotKey;
                }

                if (result.snapshot) {
                    applySnapshot(result.snapshot);
                }
            })
            .catch((error: unknown) => {
                if (!active) {
                    return;
                }

                autoLoginAbortRef.current = null;
                if (autoLoginInFlightKeyRef.current === autoLoginSnapshotKey) {
                    autoLoginInFlightKeyRef.current = '';
                }
                autoLoginSuppressedKeyRef.current = autoLoginSnapshotKey;
                toast.error(
                    getErrorMessage(
                        error,
                        t('view.auth.toast.automatic_login_failed_unexpectedly')
                    )
                );
            });

        return () => {
            active = false;
            controller.abort();
            if (autoLoginAbortRef.current === controller) {
                autoLoginAbortRef.current = null;
            }
            if (autoLoginInFlightKeyRef.current === autoLoginSnapshotKey) {
                autoLoginInFlightKeyRef.current = '';
            }
        };
    }, [isAutoLoginStartBlocked, isLoading, snapshot, t]);

    useEffect(
        () => () => {
            autoLoginAbortRef.current?.abort();
            autoLoginInFlightKeyRef.current = '';
        },
        []
    );

    return { cancelPendingAutoLogin };
}
