// @ts-nocheck
import { NetworkIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
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
    flags,
    onSubmit
}) {
    const { t } = useTranslation();
    const { open, setOpen, proxyInput, setProxyInput } = state;
    const { isSavingProxySettings } = flags;

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
                    </FieldGroup>
                    <DialogFooter>
                        <Button type="submit" disabled={isSavingProxySettings}>
                            {isSavingProxySettings ? (
                                <>
                                    <Spinner data-icon="inline-start" />
                                    {t('prompt.proxy_settings.restart')}
                                </>
                            ) : (
                                t('prompt.proxy_settings.restart')
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
