import {
    FlaskConicalIcon,
    NetworkIcon,
    RotateCwIcon,
    SaveIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import {
    Field,
    FieldContent,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldTitle
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';

type ProxySettingsEditorProps = {
    disabled?: boolean;
    enabled: boolean;
    idPrefix: string;
    saving?: boolean;
    server: string;
    testing?: boolean;
    onEnabledChange: (enabled: boolean) => unknown;
    onSave: () => unknown;
    onSaveAndRestart: () => unknown;
    onServerChange: (server: string) => unknown;
    onTest: () => unknown;
};

export function ProxySettingsEditor({
    disabled = false,
    enabled,
    idPrefix,
    saving = false,
    server,
    testing = false,
    onEnabledChange,
    onSave,
    onSaveAndRestart,
    onServerChange,
    onTest
}: ProxySettingsEditorProps) {
    const { t } = useTranslation();
    const busy = disabled || saving || testing;

    return (
        <div className="flex flex-col gap-4">
            <FieldGroup className="gap-4">
                <Field orientation="horizontal">
                    <FieldContent>
                        <FieldTitle>
                            {t('prompt.proxy_settings.enabled')}
                        </FieldTitle>
                        <FieldDescription>
                            {t('prompt.proxy_settings.enabled_description')}
                        </FieldDescription>
                    </FieldContent>
                    <Switch
                        checked={enabled}
                        disabled={busy}
                        onCheckedChange={onEnabledChange}
                    />
                </Field>
                <Field>
                    <FieldLabel htmlFor={`${idPrefix}-proxy-server`}>
                        <NetworkIcon className="size-4" />
                        {t('prompt.proxy_settings.address')}
                    </FieldLabel>
                    <Input
                        id={`${idPrefix}-proxy-server`}
                        disabled={busy}
                        placeholder="127.0.0.1:7890"
                        value={server}
                        onChange={(event) => onServerChange(event.target.value)}
                    />
                    <FieldDescription>
                        {t('prompt.proxy_settings.address_description')}
                    </FieldDescription>
                </Field>
            </FieldGroup>
            <div className="flex flex-wrap justify-end gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={onTest}
                >
                    {testing ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <FlaskConicalIcon data-icon="inline-start" />
                    )}
                    {t('prompt.proxy_settings.test')}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={onSave}
                >
                    {saving ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <SaveIcon data-icon="inline-start" />
                    )}
                    {t('common.actions.save')}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={onSaveAndRestart}
                >
                    {saving ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <RotateCwIcon data-icon="inline-start" />
                    )}
                    {t('prompt.proxy_settings.restart')}
                </Button>
            </div>
        </div>
    );
}
