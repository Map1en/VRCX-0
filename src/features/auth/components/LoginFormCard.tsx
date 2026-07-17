import { ArrowLeftIcon } from 'lucide-react';
import type { Dispatch, FormEventHandler, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

type LoginFormState = {
    password: string;
    saveCredentials: boolean;
    username: string;
};

type LoginErrors = {
    password: string;
    username: string;
};

type LoginFormCardProps = {
    busy: boolean;
    loginErrors: LoginErrors;
    loginForm: LoginFormState;
    onBackToSavedAccounts: () => void;
    onCancelAutoLogin: () => void;
    onOpenForgotPassword: () => void;
    onOpenRegister: () => void;
    onSubmit: FormEventHandler<HTMLFormElement>;
    setLoginErrors: Dispatch<SetStateAction<LoginErrors>>;
    setLoginForm: Dispatch<SetStateAction<LoginFormState>>;
    showBackToSavedAccounts: boolean;
    submitting: boolean;
};

export function LoginFormCard({
    busy,
    submitting,
    loginForm,
    loginErrors,
    setLoginForm,
    setLoginErrors,
    onSubmit,
    onCancelAutoLogin,
    onBackToSavedAccounts,
    onOpenRegister,
    onOpenForgotPassword,
    showBackToSavedAccounts
}: LoginFormCardProps) {
    const { t } = useTranslation();

    return (
        <Card className="flex flex-1 flex-col gap-3 pt-2">
            <CardHeader>
                {showBackToSavedAccounts ? (
                    <Button
                        type="button"
                        variant="link"
                        className="text-muted-foreground h-auto w-fit p-0 text-xs"
                        onClick={onBackToSavedAccounts}
                    >
                        <ArrowLeftIcon data-icon="inline-start" />
                        {t('view.login.backToSavedAccounts')}
                    </Button>
                ) : null}
                <CardTitle className="text-center">
                    {t('view.login.login')}
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
                <form
                    className="flex flex-1 flex-col gap-4"
                    onSubmit={onSubmit}
                >
                    <FieldGroup className="gap-3">
                        <Field data-invalid={Boolean(loginErrors.username)}>
                            <FieldLabel htmlFor="react-login-username">
                                {t('view.login.field.username')}
                            </FieldLabel>
                            <Input
                                id="react-login-username"
                                aria-invalid={
                                    Boolean(loginErrors.username) || undefined
                                }
                                autoComplete="username"
                                disabled={busy}
                                placeholder={t(
                                    'view.login.placeholder.account'
                                )}
                                value={loginForm.username}
                                onChange={(event) => {
                                    onCancelAutoLogin();
                                    setLoginForm((current) => ({
                                        ...current,
                                        username: event.target.value
                                    }));
                                    if (loginErrors.username) {
                                        setLoginErrors((current) => ({
                                            ...current,
                                            username: ''
                                        }));
                                    }
                                }}
                            />
                            <FieldError>{loginErrors.username}</FieldError>
                        </Field>
                        <Field data-invalid={Boolean(loginErrors.password)}>
                            <FieldLabel htmlFor="react-login-password">
                                {t('view.login.field.password')}
                            </FieldLabel>
                            <Input
                                id="react-login-password"
                                aria-invalid={
                                    Boolean(loginErrors.password) || undefined
                                }
                                type="password"
                                autoComplete="current-password"
                                disabled={busy}
                                placeholder={t(
                                    'view.login.placeholder.password'
                                )}
                                value={loginForm.password}
                                onChange={(event) => {
                                    onCancelAutoLogin();
                                    setLoginForm((current) => ({
                                        ...current,
                                        password: event.target.value
                                    }));
                                    if (loginErrors.password) {
                                        setLoginErrors((current) => ({
                                            ...current,
                                            password: ''
                                        }));
                                    }
                                }}
                            />
                            <FieldError>{loginErrors.password}</FieldError>
                        </Field>
                    </FieldGroup>

                    <div className="flex flex-wrap items-center justify-end gap-4">
                        <Field orientation="horizontal" className="w-auto">
                            <Checkbox
                                id="react-login-save-credentials"
                                checked={loginForm.saveCredentials}
                                disabled={busy}
                                onCheckedChange={(checked) => {
                                    onCancelAutoLogin();
                                    setLoginForm((current) => ({
                                        ...current,
                                        saveCredentials: checked === true
                                    }));
                                }}
                            />
                            <FieldLabel htmlFor="react-login-save-credentials">
                                {t('view.login.field.saveCredentials')}
                            </FieldLabel>
                        </Field>
                    </div>

                    <Button
                        type="submit"
                        size="lg"
                        className="mt-auto w-full"
                        disabled={busy}
                    >
                        {submitting ? (
                            <>
                                <Spinner data-icon="inline-start" />
                                {t('view.login.signingIn')}
                            </>
                        ) : (
                            t('view.login.login')
                        )}
                    </Button>
                </form>
                <div className="text-muted-foreground flex items-center justify-center gap-2 text-xs">
                    <Button
                        type="button"
                        variant="link"
                        className="text-muted-foreground h-auto p-0 text-xs"
                        onClick={onOpenRegister}
                    >
                        {t('view.login.register')}
                    </Button>
                    <span aria-hidden="true">·</span>
                    <Button
                        type="button"
                        variant="link"
                        className="text-muted-foreground h-auto p-0 text-xs"
                        onClick={onOpenForgotPassword}
                    >
                        {t('view.login.forgotPassword')}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
