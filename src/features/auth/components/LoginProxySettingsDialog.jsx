import { NetworkIcon } from 'lucide-react';

import {
    DEFAULT_ENDPOINT_DOMAIN,
    DEFAULT_WEBSOCKET_DOMAIN
} from '@/repositories/vrchatAuthRepository.js';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

export function LoginProxySettingsDialog({
    state,
    loginForm,
    setLoginForm,
    flags,
    onSubmit,
    onCustomEndpointToggle,
    onCancelAutoLogin
}) {
    const { t } = useTranslation();
    const { open, setOpen, proxyInput, setProxyInput } = state;
    const { isSavingProxySettings, isUpdatingEndpointSetting, isAuthBusy } = flags;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('view.login.proxy_settings')}</DialogTitle>
                    <DialogDescription>
                        {t('view.login.proxy_description')}
                    </DialogDescription>
                </DialogHeader>
                <form className="flex flex-col gap-4" onSubmit={onSubmit}>
                    <FieldGroup>
                        <Field>
                            <FieldLabel htmlFor="react-login-proxy">
                                <NetworkIcon className="size-4" />
                                {t('status_bar.proxy')}
                            </FieldLabel>
                            <Input
                                id="react-login-proxy"
                                disabled={isSavingProxySettings}
                                placeholder="127.0.0.1:7890"
                                value={proxyInput}
                                onChange={(event) =>
                                    setProxyInput(event.target.value)
                                }
                            />
                        </Field>
                        <Field orientation="horizontal" className="w-auto">
                            <Checkbox
                                id="react-login-dev-endpoint"
                                checked={loginForm.enableCustomEndpoint}
                                disabled={
                                    isSavingProxySettings ||
                                    isUpdatingEndpointSetting ||
                                    isAuthBusy
                                }
                                onCheckedChange={(checked) =>
                                    void onCustomEndpointToggle(checked)
                                }
                            />
                            <FieldLabel htmlFor="react-login-dev-endpoint">
                                {t('view.login.field.devEndpoint')}
                            </FieldLabel>
                        </Field>
                        {loginForm.enableCustomEndpoint ? (
                            <FieldGroup className="grid gap-4 md:grid-cols-2">
                                <Field>
                                    <FieldLabel htmlFor="react-login-endpoint">
                                        {t('view.login.field.endpoint')}
                                    </FieldLabel>
                                    <Input
                                        id="react-login-endpoint"
                                        disabled={
                                            isSavingProxySettings || isAuthBusy
                                        }
                                        placeholder={DEFAULT_ENDPOINT_DOMAIN}
                                        value={loginForm.endpoint}
                                        onChange={(event) => {
                                            onCancelAutoLogin(
                                                t(
                                                    'view.auth.auto_login.skipped_form_changed'
                                                )
                                            );
                                            setLoginForm((current) => ({
                                                ...current,
                                                endpoint: event.target.value
                                            }));
                                        }}
                                    />
                                </Field>
                                <Field>
                                    <FieldLabel htmlFor="react-login-websocket">
                                        {t('view.login.field.websocket')}
                                    </FieldLabel>
                                    <Input
                                        id="react-login-websocket"
                                        disabled={
                                            isSavingProxySettings || isAuthBusy
                                        }
                                        placeholder={DEFAULT_WEBSOCKET_DOMAIN}
                                        value={loginForm.websocket}
                                        onChange={(event) => {
                                            onCancelAutoLogin(
                                                t(
                                                    'view.auth.auto_login.skipped_form_changed'
                                                )
                                            );
                                            setLoginForm((current) => ({
                                                ...current,
                                                websocket: event.target.value
                                            }));
                                        }}
                                    />
                                </Field>
                            </FieldGroup>
                        ) : null}
                    </FieldGroup>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={isSavingProxySettings}
                            onClick={() => setOpen(false)}
                        >
                            {t('prompt.proxy_settings.close')}
                        </Button>
                        <Button type="submit" disabled={isSavingProxySettings}>
                            {isSavingProxySettings ? (
                                <>
                                    <Spinner data-icon="inline-start" />
                                    {t('common.actions.save')}
                                </>
                            ) : (
                                t('common.actions.save')
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
