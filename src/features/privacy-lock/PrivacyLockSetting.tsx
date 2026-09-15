import { useTranslation } from 'react-i18next';

import { Field } from '@/features/settings/components/SettingsField';
import { openPrivacyLockDialog } from '@/state/privacyLockDialogStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';

export function PrivacyLockSetting() {
    const { t } = useTranslation();
    const hasPassword = useRuntimeStore(
        (state) => state.privacyLock.hasPassword
    );

    return (
        <Field
            label={t('privacy_lock.settings.label')}
            description={t('privacy_lock.settings.description')}
        >
            <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-muted-foreground text-xs">
                    {t(
                        hasPassword
                            ? 'privacy_lock.settings.status_set'
                            : 'privacy_lock.settings.status_unset'
                    )}
                </span>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openPrivacyLockDialog()}
                >
                    {t(
                        hasPassword
                            ? 'privacy_lock.action.change'
                            : 'privacy_lock.action.set'
                    )}
                </Button>
            </div>
        </Field>
    );
}
