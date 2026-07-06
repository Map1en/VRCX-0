import { useTranslation } from 'react-i18next';

import { ProxySettingsEditor } from '@/components/proxy/ProxySettingsEditor';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

type LoginProxySettingsDialogProps = {
    enabled: boolean;
    isSaving: boolean;
    isTesting: boolean;
    open: boolean;
    proxyInput: string;
    onOpenChange: (open: boolean) => unknown;
    onProxyEnabledChange: (enabled: boolean) => unknown;
    onProxyInputChange: (value: string) => unknown;
    onSave: () => unknown;
    onSaveAndRestart: () => unknown;
    onTest: () => unknown;
};

export function LoginProxySettingsDialog({
    enabled,
    open,
    proxyInput,
    isSaving,
    isTesting,
    onOpenChange,
    onProxyEnabledChange,
    onProxyInputChange,
    onSave,
    onSaveAndRestart,
    onTest
}: LoginProxySettingsDialogProps) {
    const { t } = useTranslation();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('view.login.proxy_settings')}</DialogTitle>
                    <DialogDescription>
                        {t('view.login.proxy_description')}
                    </DialogDescription>
                </DialogHeader>
                <ProxySettingsEditor
                    enabled={enabled}
                    idPrefix="react-login-proxy"
                    saving={isSaving}
                    server={proxyInput}
                    testing={isTesting}
                    onEnabledChange={onProxyEnabledChange}
                    onSave={onSave}
                    onSaveAndRestart={onSaveAndRestart}
                    onServerChange={onProxyInputChange}
                    onTest={onTest}
                />
            </DialogContent>
        </Dialog>
    );
}
