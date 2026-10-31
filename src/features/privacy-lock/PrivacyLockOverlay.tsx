import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { LockIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
    DeviceLoginQrCode,
    DeviceLoginWaitingStatus
} from '@/components/device-login/DeviceLoginQr';
import { StatusDot } from '@/components/layout/status-bar/StatusBarParts';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands, type PrivacyLockOutcome } from '@/platform/tauri/bindings';
import { logoutWithoutConfirmation } from '@/services/authExecutionService';
import { getCachedAuthSnapshot } from '@/services/authSnapshotService';
import { startBackgroundModeForCurrentSession } from '@/services/backgroundModeService';
import { userImage } from '@/services/entityMediaService';
import {
    clearPrivacyLockPassword,
    unlockPrivacyLock,
    waitPrivacyLockDeviceVerification
} from '@/services/privacyLockService';
import { usePrivacyLockPhase } from '@/state/privacyLockPhase';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import { Field, FieldError, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { LockCodeInput } from './LockCodeInput';
import { privacyLockOutcomeMessage } from './privacyLockOutcomeMessage';

const LAYER_CLASS = 'vrcx-0-app-overlay fixed z-[10000]';

export function PrivacyLockOverlay() {
    const phase = usePrivacyLockPhase();
    const covering = phase === 'pending' || phase === 'locked';

    return (
        <DialogPrimitive.Root
            open={covering}
            modal="trap-focus"
            disablePointerDismissal
        >
            <DialogPrimitive.Portal>
                <DialogPrimitive.Backdrop
                    className={`${LAYER_CLASS} bg-background/60 supports-backdrop-filter:backdrop-blur-lg`}
                />
                <DialogPrimitive.Popup
                    data-vrcx-0-surface="privacy-lock"
                    className={`${LAYER_CLASS} flex items-center justify-center overflow-y-auto p-6 outline-none`}
                    onKeyDown={(event) => {
                        event.stopPropagation();
                    }}
                >
                    {phase === 'locked' ? <LockedPanel /> : <Spinner />}
                </DialogPrimitive.Popup>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

function LockedPanel() {
    const { t } = useTranslation();
    const currentUser = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const websocketConnected = useRuntimeStore(
        (state) => state.transport.websocketConnected
    );
    const serversHealthy = useRuntimeStore(
        (state) =>
            !state.vrcStatus.indicator || state.vrcStatus.indicator === 'none'
    );
    const [recovering, setRecovering] = useState(false);
    const [pendingAction, setPendingAction] = useState<
        'background' | 'logout' | null
    >(null);
    const [actionError, setActionError] = useState('');
    const avatarUrl = userImage(currentUser, 128);

    async function runAction(
        action: 'background' | 'logout',
        run: () => Promise<unknown>
    ) {
        setPendingAction(action);
        setActionError('');
        try {
            await run();
        } catch (error) {
            setActionError(
                userFacingErrorMessage(error, t('privacy_lock.error.failed'))
            );
        } finally {
            setPendingAction(null);
        }
    }

    return (
        <div className="bg-popover/80 text-popover-foreground ring-foreground/10 flex w-full max-w-xs flex-col items-center gap-5 rounded-2xl p-6 shadow-lg ring-1">
            <Avatar className="size-16">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
                <AvatarFallback>
                    <LockIcon className="text-muted-foreground size-6" />
                </AvatarFallback>
            </Avatar>
            <DialogPrimitive.Title className="text-base font-medium">
                {t('privacy_lock.locked_title')}
            </DialogPrimitive.Title>
            {recovering ? (
                <RecoverPanel onBack={() => setRecovering(false)} />
            ) : (
                <UnlockForm onForgot={() => setRecovering(true)} />
            )}
            <DialogPrimitive.Description className="text-muted-foreground flex w-full items-center justify-center gap-3 text-xs">
                <span className="flex items-center gap-1.5">
                    <StatusDot active={serversHealthy} />
                    {t('status_bar.servers')}
                </span>
                <span className="flex items-center gap-1.5">
                    <StatusDot active={websocketConnected} />
                    {t('status_bar.realtime_connection')}
                </span>
            </DialogPrimitive.Description>
            <div className="flex justify-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pendingAction !== null}
                    onClick={() =>
                        void runAction(
                            'background',
                            startBackgroundModeForCurrentSession
                        )
                    }
                >
                    {pendingAction === 'background' ? (
                        <Spinner data-icon="inline-start" />
                    ) : null}
                    {t('privacy_lock.action.background_mode')}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pendingAction !== null}
                    onClick={() =>
                        void runAction('logout', logoutWithoutConfirmation)
                    }
                >
                    {pendingAction === 'logout' ? (
                        <Spinner data-icon="inline-start" />
                    ) : null}
                    {t('privacy_lock.action.logout')}
                </Button>
            </div>
            {actionError ? (
                <p className="text-destructive text-center text-xs">
                    {actionError}
                </p>
            ) : null}
        </div>
    );
}

function useLockSubmit(run: (value: string) => Promise<PrivacyLockOutcome>) {
    const { t } = useTranslation();
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    async function submit(value: string): Promise<boolean> {
        if (!value || submitting) {
            return false;
        }
        setSubmitting(true);
        setError('');
        try {
            const outcome = await run(value);
            if (outcome.status === 'ok') {
                return true;
            }
            setError(privacyLockOutcomeMessage(t, outcome));
        } catch (failure) {
            setError(
                userFacingErrorMessage(failure, t('privacy_lock.error.failed'))
            );
        } finally {
            setSubmitting(false);
        }
        return false;
    }

    return { error, clearError: () => setError(''), submitting, submit };
}

function UnlockForm({ onForgot }: { onForgot: () => void }) {
    const { t } = useTranslation();
    const [code, setCode] = useState('');
    const { error, clearError, submitting, submit } =
        useLockSubmit(unlockPrivacyLock);

    return (
        <div className="flex w-full flex-col items-center gap-3">
            <Field
                className="items-center text-center"
                data-invalid={Boolean(error) || undefined}
            >
                <FieldLabel htmlFor="privacy-lock-code" className="sr-only">
                    {t('privacy_lock.field.password')}
                </FieldLabel>
                <LockCodeInput
                    id="privacy-lock-code"
                    value={code}
                    autoFocus
                    disabled={submitting}
                    invalid={Boolean(error)}
                    onChange={(value) => {
                        setCode(value);
                        clearError();
                    }}
                    onComplete={(value) => {
                        void submit(value).then((unlocked) => {
                            if (!unlocked) {
                                setCode('');
                            }
                        });
                    }}
                />
                <FieldError>{error}</FieldError>
            </Field>
            <Button
                type="button"
                variant="link"
                className="text-muted-foreground h-auto p-0 text-xs"
                onClick={onForgot}
            >
                {t('privacy_lock.action.forgot')}
            </Button>
        </div>
    );
}

function RecoverPanel({ onBack }: { onBack: () => void }) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const hasSavedPassword = Boolean(
        getCachedAuthSnapshot()?.savedCredentialsList.find(
            (credential) => credential.user.id === currentUserId
        )?.hasLoginCredentials
    );
    const [method, setMethod] = useState<'password' | 'qr'>(
        hasSavedPassword ? 'password' : 'qr'
    );

    return (
        <div className="flex w-full flex-col items-center gap-3">
            <Tabs
                className="w-full"
                value={method}
                onValueChange={(value) =>
                    setMethod(value === 'qr' ? 'qr' : 'password')
                }
            >
                <TabsList className="w-full">
                    <TabsTrigger value="password">
                        {t('privacy_lock.recover.method_password')}
                    </TabsTrigger>
                    <TabsTrigger value="qr">
                        {t('privacy_lock.recover.method_qr')}
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="password" className="pt-2">
                    {hasSavedPassword ? (
                        <RecoverForm />
                    ) : (
                        <p className="text-muted-foreground text-center text-xs">
                            {t('privacy_lock.recover.password_unavailable')}
                        </p>
                    )}
                </TabsContent>
                <TabsContent value="qr" className="pt-2">
                    {method === 'qr' ? <QrRecoverForm /> : null}
                </TabsContent>
            </Tabs>
            <Button
                type="button"
                variant="link"
                className="text-muted-foreground h-auto p-0 text-xs"
                onClick={onBack}
            >
                {t('privacy_lock.action.back')}
            </Button>
        </div>
    );
}

function QrRecoverForm() {
    const { t } = useTranslation();
    const [round, setRound] = useState(0);
    const [pending, setPending] = useState<{
        verificationUrl: string;
        expiresAt: number;
    } | null>(null);
    const [phase, setPhase] = useState<
        'starting' | 'waiting' | 'expired' | 'failed'
    >('starting');
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        setPending(null);
        setPhase('starting');

        async function verify() {
            const start = await commands.appPrivacyLockDeviceVerifyStart();
            if (!active) {
                return;
            }
            if (start.status !== 'pending') {
                setError(
                    start.status === 'failed'
                        ? start.reason
                        : t('privacy_lock.error.no_session')
                );
                setPhase('failed');
                return;
            }
            setPending(start);
            setPhase('waiting');
            const outcome = await waitPrivacyLockDeviceVerification(
                start.attemptId
            );
            if (
                !active ||
                outcome.status === 'ok' ||
                outcome.status === 'cancelled'
            ) {
                return;
            }
            if (outcome.status === 'deviceCodeExpired') {
                setPhase('expired');
                return;
            }
            setError(privacyLockOutcomeMessage(t, outcome));
            if (outcome.status === 'accountMismatch') {
                setRound((value) => value + 1);
                return;
            }
            setPhase('failed');
        }

        verify().catch((failure: unknown) => {
            if (active) {
                setError(
                    userFacingErrorMessage(
                        failure,
                        t('privacy_lock.error.failed')
                    )
                );
                setPhase('failed');
            }
        });
        return () => {
            active = false;
        };
    }, [round, t]);

    useEffect(
        () => () => {
            void commands.appPrivacyLockDeviceVerifyCancel();
        },
        []
    );

    function retry() {
        setError('');
        setRound((value) => value + 1);
    }

    return (
        <div className="flex w-full flex-col items-center gap-3">
            {phase === 'waiting' && pending ? (
                <>
                    <DeviceLoginQrCode
                        value={pending.verificationUrl}
                        size={164}
                    />
                    <p className="text-muted-foreground text-center text-xs">
                        {t('privacy_lock.recover.qr_description')}
                    </p>
                    <DeviceLoginWaitingStatus
                        expiresAt={pending.expiresAt}
                        className="w-full text-xs"
                    />
                </>
            ) : null}
            {phase === 'starting' ? <Spinner className="my-8" /> : null}
            {phase === 'expired' ? (
                <>
                    <p className="text-muted-foreground text-center text-xs">
                        {t('device_login.expired_title')}
                    </p>
                    <Button type="button" className="w-full" onClick={retry}>
                        {t('device_login.refresh')}
                    </Button>
                </>
            ) : null}
            {phase === 'failed' ? (
                <Button type="button" className="w-full" onClick={retry}>
                    {t('device_login.retry')}
                </Button>
            ) : null}
            {error ? (
                <p className="text-destructive text-center text-xs">{error}</p>
            ) : null}
        </div>
    );
}

function RecoverForm() {
    const { t } = useTranslation();
    const [password, setPassword] = useState('');
    const { error, clearError, submitting, submit } = useLockSubmit(
        clearPrivacyLockPassword
    );

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        void submit(password).then((cleared) => {
            if (!cleared) {
                setPassword('');
            }
        });
    }

    return (
        <form className="flex w-full flex-col gap-3" onSubmit={handleSubmit}>
            <p className="text-muted-foreground text-center text-xs">
                {t('privacy_lock.recover.description')}
            </p>
            <Field data-invalid={Boolean(error) || undefined}>
                <FieldLabel
                    htmlFor="privacy-lock-account-password"
                    className="sr-only"
                >
                    {t('privacy_lock.field.account_password')}
                </FieldLabel>
                <Input
                    id="privacy-lock-account-password"
                    type="password"
                    autoComplete="off"
                    autoFocus
                    aria-invalid={Boolean(error) || undefined}
                    disabled={submitting}
                    placeholder={t('privacy_lock.field.account_password')}
                    value={password}
                    onChange={(event) => {
                        setPassword(event.target.value);
                        clearError();
                    }}
                />
                <FieldError>{error}</FieldError>
            </Field>
            <Button
                type="submit"
                className="w-full"
                disabled={submitting || !password}
            >
                {submitting ? <Spinner data-icon="inline-start" /> : null}
                {t('privacy_lock.action.clear_and_unlock')}
            </Button>
        </form>
    );
}
