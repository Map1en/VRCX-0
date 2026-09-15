import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { LockIcon } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { StatusDot } from '@/components/layout/status-bar/StatusBarParts';
import type { PrivacyLockOutcome } from '@/platform/tauri/bindings';
import { logoutWithoutConfirmation } from '@/services/authExecutionService';
import { startBackgroundModeForCurrentSession } from '@/services/backgroundModeService';
import { userImage } from '@/services/entityMediaService';
import {
    clearPrivacyLockPassword,
    unlockPrivacyLock
} from '@/services/privacyLockService';
import { usePrivacyLockPhase } from '@/state/privacyLockPhase';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import { Field, FieldError, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

import { LockCodeInput } from './LockCodeInput';
import { privacyLockOutcomeMessage } from './privacyLockOutcomeMessage';

const LAYER_CLASS = 'vrcx-0-app-overlay fixed z-[10000]';

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

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
    const avatarUrl = userImage(currentUser, true, '128');

    async function runAction(
        action: 'background' | 'logout',
        run: () => Promise<unknown>
    ) {
        setPendingAction(action);
        setActionError('');
        try {
            await run();
        } catch (error) {
            setActionError(errorMessage(error, t('privacy_lock.error.failed')));
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
                <RecoverForm onBack={() => setRecovering(false)} />
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
            setError(errorMessage(failure, t('privacy_lock.error.failed')));
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

function RecoverForm({ onBack }: { onBack: () => void }) {
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
            <Button
                type="button"
                variant="link"
                className="text-muted-foreground h-auto p-0 text-xs"
                onClick={onBack}
            >
                {t('privacy_lock.action.back')}
            </Button>
        </form>
    );
}
