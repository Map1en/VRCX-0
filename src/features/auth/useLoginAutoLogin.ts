import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { executeReactAutoLogin } from '@/services/authAutoLoginService';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    getLoginErrorMessage as getErrorMessage,
    getLoginUserDisplayName as getUserDisplayName
} from './loginDisplay';

type AutoLoginStatus =
    | 'cancelled'
    | 'expired'
    | 'failed'
    | 'idle'
    | 'running'
    | 'scheduled'
    | 'success'
    | 'throttled';

type AutoLoginState = {
    detail: string;
    remainingSeconds: number;
    status: AutoLoginStatus;
    userId: string;
};

export function useLoginAutoLogin({
    activeSavedUserId,
    applySnapshot,
    databaseReady,
    isLoading,
    isSubmitting,
    snapshot
}: any) {
    const { t } = useTranslation();
    const backendRuntimeSnapshotHydrated = useRuntimeStore(
        (state: any) => state.shell.backendRuntimeSnapshotHydrated
    );
    const [autoLoginState, setAutoLoginState] = useState<AutoLoginState>({
        status: 'idle',
        remainingSeconds: 0,
        detail: '',
        userId: ''
    });
    const [autoLoginRetryNonce, setAutoLoginRetryNonce] = useState(0);
    const autoLoginSuppressedKeyRef = useRef('');
    const autoLoginInFlightKeyRef = useRef('');
    const autoLoginAbortRef = useRef<AbortController | null>(null);
    const isDatabaseBlocked = !databaseReady;
    const isAutoLoginActive =
        autoLoginState.status === 'scheduled' ||
        autoLoginState.status === 'running';
    const isAutoLoginStartBlocked =
        isDatabaseBlocked ||
        !backendRuntimeSnapshotHydrated ||
        isSubmitting ||
        Boolean(activeSavedUserId);
    const shouldShowAutoLogin =
        !isLoading &&
        (Boolean(snapshot?.lastUserLoggedIn) ||
            snapshot?.autoLoginStatus === 'available' ||
            autoLoginState.status !== 'idle');
    const autoLoginTarget = snapshot?.savedCredentials?.[
        snapshot?.lastUserLoggedIn
    ]?.user
        ? getUserDisplayName(
              snapshot.savedCredentials[snapshot.lastUserLoggedIn].user
          )
        : snapshot?.lastUserLoggedIn || t('status_bar.game_last_session');
    const autoLoginAlertVariant =
        autoLoginState.status === 'failed' ||
        autoLoginState.status === 'expired'
            ? 'destructive'
            : 'default';

    function getAutoLoginSnapshotKey(nextSnapshot: any = snapshot) {
        const userId = nextSnapshot?.lastUserLoggedIn || '';
        const savedCredential = userId
            ? nextSnapshot?.savedCredentials?.[userId]
            : null;
        if (!userId) {
            return '';
        }

        return JSON.stringify({
            userId,
            username: savedCredential?.loginParams?.username || '',
            hasCookies: Boolean(savedCredential?.hasCookies),
            hasSavedCredential: Boolean(savedCredential),
            autoLoginStatus: nextSnapshot.autoLoginStatus,
            autoLoginDelayEnabled: Boolean(nextSnapshot.autoLoginDelayEnabled),
            autoLoginDelaySeconds: nextSnapshot.autoLoginDelaySeconds || 0
        });
    }

    function cancelPendingAutoLogin(
        detail: string = t('view.auth.auto_login.skipped')
    ) {
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

        setAutoLoginState((current) => {
            if (
                current.status !== 'scheduled' &&
                current.status !== 'running'
            ) {
                return current;
            }

            return {
                ...current,
                status: 'cancelled',
                remainingSeconds: 0,
                detail
            };
        });
    }

    function retryAutoLogin() {
        autoLoginSuppressedKeyRef.current = '';
        autoLoginInFlightKeyRef.current = '';
        setAutoLoginState({
            status: 'idle',
            remainingSeconds: 0,
            detail: '',
            userId: ''
        });
        setAutoLoginRetryNonce((current) => current + 1);
    }

    useEffect(() => {
        const shouldAttemptCookieRestore = Boolean(snapshot?.lastUserLoggedIn);
        const shouldAttemptSavedCredentialFallback =
            snapshot?.autoLoginStatus === 'available';

        if (
            isLoading ||
            isAutoLoginStartBlocked ||
            !databaseReady ||
            (!shouldAttemptCookieRestore &&
                !shouldAttemptSavedCredentialFallback)
        ) {
            return undefined;
        }

        const userId = snapshot?.lastUserLoggedIn;
        const savedCredential = userId
            ? snapshot?.savedCredentials?.[userId]
            : null;
        const autoLoginDisplayName = savedCredential
            ? getUserDisplayName(savedCredential.user)
            : userId;
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

        setAutoLoginState({
            status:
                snapshot.autoLoginDelayEnabled &&
                snapshot.autoLoginDelaySeconds > 0
                    ? 'scheduled'
                    : 'running',
            remainingSeconds:
                snapshot.autoLoginDelayEnabled &&
                snapshot.autoLoginDelaySeconds > 0
                    ? snapshot.autoLoginDelaySeconds
                    : 0,
            detail: savedCredential
                ? t('view.auth.auto_login.preparing_login_for', {
                      name: autoLoginDisplayName
                  })
                : t('view.auth.auto_login.preparing_restore_for', {
                      userId
                  }),
            userId
        });

        executeReactAutoLogin(snapshot, {
            signal: controller.signal,
            onCountdown(remainingSeconds: number) {
                if (!active) {
                    return;
                }

                setAutoLoginState((current) => ({
                    ...current,
                    status: remainingSeconds > 0 ? 'scheduled' : 'running',
                    remainingSeconds,
                    detail:
                        remainingSeconds > 0
                            ? t('message.auto_login_delay_countdown', {
                                  seconds: remainingSeconds
                              })
                            : savedCredential
                              ? t('view.auth.auto_login.authenticating', {
                                    name: autoLoginDisplayName
                                })
                              : t(
                                    'view.auth.auto_login.restoring_session_for',
                                    {
                                        name: autoLoginDisplayName
                                    }
                                )
                }));
            }
        })
            .then((result: any) => {
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

                switch (result.status) {
                    case 'success':
                        setAutoLoginState({
                            status: 'success',
                            remainingSeconds: 0,
                            detail: savedCredential
                                ? t('view.auth.auto_login.logged_in_as', {
                                      name: autoLoginDisplayName
                                  })
                                : t(
                                      'view.auth.auto_login.restored_session_for',
                                      {
                                          name: autoLoginDisplayName
                                      }
                                  ),
                            userId
                        });
                        break;
                    case 'cancelled':
                        setAutoLoginState({
                            status: 'cancelled',
                            remainingSeconds: 0,
                            detail: t(
                                'view.auth.auto_login.skipped_before_request'
                            ),
                            userId
                        });
                        break;
                    case 'throttled':
                        setAutoLoginState({
                            status: 'throttled',
                            remainingSeconds: 0,
                            detail: t('view.auth.auto_login.throttled'),
                            userId
                        });
                        break;
                    case 'expired':
                        setAutoLoginState({
                            status: 'expired',
                            remainingSeconds: 0,
                            detail: t('view.auth.auto_login.expired'),
                            userId
                        });
                        break;
                    case 'failed':
                        setAutoLoginState({
                            status: 'failed',
                            remainingSeconds: 0,
                            detail: getErrorMessage(
                                result.error,
                                t('view.auth.auto_login.failed_manual')
                            ),
                            userId
                        });
                        break;
                    default:
                        setAutoLoginState({
                            status: 'idle',
                            remainingSeconds: 0,
                            detail: '',
                            userId: ''
                        });
                        break;
                }
            })
            .catch((error: any) => {
                if (!active) {
                    return;
                }

                autoLoginAbortRef.current = null;
                if (autoLoginInFlightKeyRef.current === autoLoginSnapshotKey) {
                    autoLoginInFlightKeyRef.current = '';
                }
                autoLoginSuppressedKeyRef.current = autoLoginSnapshotKey;
                setAutoLoginState({
                    status: 'failed',
                    remainingSeconds: 0,
                    detail: getErrorMessage(
                        error,
                        t('view.auth.auto_login.failed_unexpectedly')
                    ),
                    userId
                });
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
    }, [
        autoLoginRetryNonce,
        backendRuntimeSnapshotHydrated,
        databaseReady,
        isAutoLoginStartBlocked,
        isLoading,
        snapshot,
        t
    ]);

    useEffect(
        () => () => {
            autoLoginAbortRef.current?.abort();
            autoLoginInFlightKeyRef.current = '';
        },
        []
    );

    return {
        autoLoginAlertVariant,
        autoLoginState,
        autoLoginTarget,
        cancelPendingAutoLogin,
        isAutoLoginActive,
        retryAutoLogin,
        shouldShowAutoLogin
    };
}
