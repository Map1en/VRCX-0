import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { PrivacyLockOutcome } from '@/platform/tauri/bindings';
import {
    changePrivacyLockPassword,
    clearPrivacyLockPassword,
    engagePrivacyLock,
    setPrivacyLockPassword
} from '@/services/privacyLockService';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

import { LockCodeInput, LOCK_CODE_LENGTH } from './LockCodeInput';
import { privacyLockOutcomeMessage } from './privacyLockOutcomeMessage';

type DialogView = 'create' | 'change' | 'clear';

const VIEW_COPY = {
    create: {
        title: 'privacy_lock.setup.create_title',
        description: 'privacy_lock.setup.create_description',
        submit: 'privacy_lock.action.set'
    },
    change: {
        title: 'privacy_lock.setup.change_title',
        description: 'privacy_lock.setup.change_description',
        submit: 'privacy_lock.action.change'
    },
    clear: {
        title: 'privacy_lock.setup.clear_title',
        description: 'privacy_lock.setup.clear_description',
        submit: 'privacy_lock.action.clear'
    }
} as const satisfies Record<DialogView, unknown>;

type CodeFieldProps = {
    id: string;
    label: string;
    value: string;
    error?: string;
    disabled: boolean;
    autoFocus?: boolean;
    onChange: (value: string) => void;
};

function LockCodeField({
    id,
    label,
    value,
    error,
    disabled,
    autoFocus,
    onChange
}: CodeFieldProps) {
    return (
        <Field
            className="items-center text-center"
            data-invalid={Boolean(error) || undefined}
        >
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <LockCodeInput
                id={id}
                value={value}
                disabled={disabled}
                autoFocus={autoFocus}
                invalid={Boolean(error)}
                onChange={onChange}
            />
            <FieldError>{error}</FieldError>
        </Field>
    );
}

export function PrivacyLockPasswordDialog({
    open,
    engageAfterSetup,
    onClose
}: {
    open: boolean;
    engageAfterSetup: boolean;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const hasPassword = useRuntimeStore(
        (state) => state.privacyLock.hasPassword
    );
    const [view, setView] = useState<DialogView | null>(null);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [accountPassword, setAccountPassword] = useState('');
    const [errors, setErrors] = useState<{
        current?: string;
        next?: string;
        confirm?: string;
        account?: string;
        form?: string;
    }>({});
    const [submitting, setSubmitting] = useState(false);
    const activeView: DialogView = view ?? (hasPassword ? 'change' : 'create');

    function resetForm(nextView: DialogView | null) {
        setView(nextView);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setAccountPassword('');
        setErrors({});
    }

    function handleOpenChange(nextOpen: boolean) {
        if (nextOpen || submitting) {
            return;
        }
        resetForm(null);
        onClose();
    }

    function validateNewPassword(): boolean {
        const nextErrors: typeof errors = {};
        if (newPassword.length !== LOCK_CODE_LENGTH) {
            nextErrors.next = t('privacy_lock.error.incomplete', {
                count: LOCK_CODE_LENGTH
            });
        }
        if (confirmPassword !== newPassword) {
            nextErrors.confirm = t('privacy_lock.error.mismatch');
        }
        if (
            activeView === 'change' &&
            currentPassword.length !== LOCK_CODE_LENGTH
        ) {
            nextErrors.current = t('privacy_lock.error.current_required');
        }
        setErrors(nextErrors);
        return Object.keys(nextErrors).length === 0;
    }

    async function submit(run: () => Promise<PrivacyLockOutcome>) {
        setSubmitting(true);
        setErrors({});
        try {
            const outcome = await run();
            if (outcome.status !== 'ok') {
                const message = privacyLockOutcomeMessage(t, outcome);
                if (outcome.status === 'wrongPassword') {
                    setErrors(
                        activeView === 'clear'
                            ? { account: message }
                            : { current: message }
                    );
                    return;
                }
                setErrors({ form: message });
                return;
            }
            return outcome;
        } catch (error) {
            setErrors({
                form:
                    error instanceof Error
                        ? error.message
                        : t('privacy_lock.error.failed')
            });
        } finally {
            setSubmitting(false);
        }
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting) {
            return;
        }
        if (activeView === 'clear') {
            if (!accountPassword) {
                setErrors({
                    account: t('privacy_lock.error.account_password_required')
                });
                return;
            }
            const outcome = await submit(() =>
                clearPrivacyLockPassword(accountPassword)
            );
            if (outcome) {
                toast.add({
                    type: 'success',
                    title: t('privacy_lock.toast.cleared')
                });
                resetForm(null);
                onClose();
            }
            return;
        }
        if (!validateNewPassword()) {
            return;
        }
        const outcome = await submit(() =>
            activeView === 'change'
                ? changePrivacyLockPassword(currentPassword, newPassword)
                : setPrivacyLockPassword(newPassword)
        );
        if (!outcome) {
            return;
        }
        toast.add({
            type: 'success',
            title: t(
                activeView === 'change'
                    ? 'privacy_lock.toast.changed'
                    : 'privacy_lock.toast.set'
            )
        });
        resetForm(null);
        onClose();
        if (activeView === 'create' && engageAfterSetup) {
            await engagePrivacyLock();
        }
    }

    const copy = VIEW_COPY[activeView];

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent showCloseButton={!submitting}>
                <form className="contents" onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{t(copy.title)}</DialogTitle>
                        <DialogDescription>
                            {t(copy.description)}
                        </DialogDescription>
                    </DialogHeader>
                    <FieldGroup className="gap-3">
                        {activeView === 'clear' ? (
                            <Field
                                data-invalid={
                                    Boolean(errors.account) || undefined
                                }
                            >
                                <FieldLabel htmlFor="privacy-lock-dialog-account-password">
                                    {t('privacy_lock.field.account_password')}
                                </FieldLabel>
                                <Input
                                    id="privacy-lock-dialog-account-password"
                                    type="password"
                                    autoComplete="off"
                                    autoFocus
                                    aria-invalid={
                                        Boolean(errors.account) || undefined
                                    }
                                    disabled={submitting}
                                    value={accountPassword}
                                    onChange={(event) => {
                                        setAccountPassword(event.target.value);
                                        setErrors({});
                                    }}
                                />
                                <FieldError>{errors.account}</FieldError>
                            </Field>
                        ) : (
                            <>
                                {activeView === 'change' ? (
                                    <LockCodeField
                                        id="privacy-lock-dialog-current-password"
                                        label={t(
                                            'privacy_lock.field.current_password'
                                        )}
                                        value={currentPassword}
                                        error={errors.current}
                                        disabled={submitting}
                                        autoFocus
                                        onChange={(value) => {
                                            setCurrentPassword(value);
                                            setErrors({});
                                        }}
                                    />
                                ) : null}
                                <LockCodeField
                                    id="privacy-lock-dialog-new-password"
                                    label={t('privacy_lock.field.new_password')}
                                    value={newPassword}
                                    error={errors.next}
                                    disabled={submitting}
                                    autoFocus={activeView === 'create'}
                                    onChange={(value) => {
                                        setNewPassword(value);
                                        setErrors({});
                                    }}
                                />
                                <LockCodeField
                                    id="privacy-lock-dialog-confirm-password"
                                    label={t(
                                        'privacy_lock.field.confirm_password'
                                    )}
                                    value={confirmPassword}
                                    error={errors.confirm}
                                    disabled={submitting}
                                    onChange={(value) => {
                                        setConfirmPassword(value);
                                        setErrors({});
                                    }}
                                />
                            </>
                        )}
                        {errors.form ? (
                            <p className="text-destructive text-xs">
                                {errors.form}
                            </p>
                        ) : null}
                    </FieldGroup>
                    {activeView === 'change' ? (
                        <Button
                            type="button"
                            variant="link"
                            className="text-muted-foreground mx-auto h-auto w-fit p-0 text-xs"
                            disabled={submitting}
                            onClick={() => resetForm('clear')}
                        >
                            {t('privacy_lock.action.clear_link')}
                        </Button>
                    ) : null}
                    {activeView === 'clear' ? (
                        <Button
                            type="button"
                            variant="link"
                            className="text-muted-foreground mx-auto h-auto w-fit p-0 text-xs"
                            disabled={submitting}
                            onClick={() => resetForm('change')}
                        >
                            {t('privacy_lock.action.back')}
                        </Button>
                    ) : null}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={submitting}
                            onClick={() => handleOpenChange(false)}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                        <Button
                            type="submit"
                            variant={
                                activeView === 'clear'
                                    ? 'destructive'
                                    : 'default'
                            }
                            disabled={submitting}
                        >
                            {submitting ? (
                                <Spinner data-icon="inline-start" />
                            ) : null}
                            {t(copy.submit)}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
