import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { executeReactAutoLogin } from '@/services/authAutoLoginService.js';

import {
    getLoginErrorMessage as getErrorMessage,
    getLoginUserDisplayName as getUserDisplayName
} from './loginDisplay.js';

export function useLoginAutoLogin({
    activeSavedUserId,
    applySnapshot,
    databaseReady,
    isLoading,
    isSubmitting,
    snapshot
}) {
    const { t } = useTranslation();
    const [autoLoginState, setAutoLoginState] = useState({
        status: 'idle',
        remainingSeconds: 0,
        detail: '',
        userId: ''
    });
    const autoLoginSuppressedKeyRef = useRef('');
    const autoLoginAbortRef = useRef(null);
    const isDatabaseBlocked = !databaseReady;
    const isAutoLoginActive =
        autoLoginState.status === 'scheduled' ||
        autoLoginState.status === 'running';
    const isAutoLoginStartBlocked =
        isDatabaseBlocked || isSubmitting || Boolean(activeSavedUserId);
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

    function getAutoLoginSnapshotKey(nextSnapshot = snapshot) {
        const userId = nextSnapshot?.lastUserLoggedIn || '';
        const savedCredential = userId
            ? nextSnapshot?.savedCredentials?.[userId]
            : null;
        if (!userId) {
            return '';
        }

        return JSON.stringify({
            userId,
            endpoint: savedCredential?.loginParams?.endpoint || '',
            username: savedCredential?.loginParams?.username || '',
            hasCookies: Boolean(savedCredential?.cookies),
            hasSavedCredential: Boolean(savedCredential),
            autoLoginStatus: nextSnapshot.autoLoginStatus,
            autoLoginDelayEnabled: Boolean(nextSnapshot.autoLoginDelayEnabled),
            autoLoginDelaySeconds: nextSnapshot.autoLoginDelaySeconds || 0
        });
    }

    function cancelPendingAutoLogin(
        detail = t('view.auth.auto_login.skipped')
    ) {
        const controller = autoLoginAbortRef.current;
        if (controller) {
            controller.abort();
            autoLoginAbortRef.current = null;
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
        setAutoLoginState({
            status: 'idle',
            remainingSeconds: 0,
            detail: '',
            userId: ''
        });
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
            autoLoginSuppressedKeyRef.current === autoLoginSnapshotKey
        ) {
            return undefined;
        }

        autoLoginSuppressedKeyRef.current = autoLoginSnapshotKey;
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
            onCountdown(remainingSeconds) {
                if (!active) {
                    return;
                }

                setAutoLoginState((current) => ({
                    ...current,
                    status: remainingSeconds > 0 ? 'scheduled' : 'running',
                    remainingSeconds,
                    detail:
                        remainingSeconds > 0
                            ? t('view.auth.auto_login.starts_in', {
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
            .then((result) => {
                if (!active) {
                    return;
                }

                autoLoginAbortRef.current = null;
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
                            detail: t('view.auth.auto_login.failed_manual'),
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
            .catch((error) => {
                if (!active) {
                    return;
                }

                autoLoginAbortRef.current = null;
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
                        t(
                            'view.auth.generated_toast.automatic_login_failed_unexpectedly'
                        )
                    )
                );
            });

        return () => {
            active = false;
            controller.abort();
            if (autoLoginAbortRef.current === controller) {
                autoLoginAbortRef.current = null;
            }
        };
    }, [databaseReady, isAutoLoginStartBlocked, isLoading, snapshot, t]);

    useEffect(
        () => () => {
            autoLoginAbortRef.current?.abort();
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
