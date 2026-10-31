import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { Button } from '@/ui/shadcn/button';

import { Field } from './SettingsField';

export function DeepLinkRegistrationField() {
    const { t } = useTranslation();
    const [registered, setRegistered] = useState<boolean | null>();
    const [repairing, setRepairing] = useState(false);

    useEffect(() => {
        let active = true;

        commands
            .appDeepLinkRegistrationStatus()
            .then((status) => {
                if (active) {
                    setRegistered(status);
                }
            })
            .catch(() => {
                if (active) {
                    setRegistered(false);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    if (registered === undefined || registered === null) {
        return null;
    }

    async function repairRegistration() {
        setRepairing(true);
        try {
            const status = await commands.appDeepLinkRegistrationRepair();
            setRegistered(status);
            if (status) {
                toast.add({
                    type: 'success',
                    title: t(
                        'view.settings.advanced.advanced_ui.behavior.deep_link_repair_success'
                    )
                });
            } else {
                toast.add({
                    type: 'error',
                    title: t(
                        'view.settings.advanced.advanced_ui.behavior.deep_link_repair_failed'
                    )
                });
            }
        } catch (error: unknown) {
            toast.add({
                type: 'error',
                title: error instanceof Error ? error.message : String(error)
            });
        } finally {
            setRepairing(false);
        }
    }

    return (
        <Field
            settingId="advanced.troubleshooting.deep-link-registration"
            label={t(
                'view.settings.advanced.advanced_ui.behavior.deep_link_registration'
            )}
            description={t(
                registered
                    ? 'view.settings.advanced.advanced_ui.behavior.deep_link_registered'
                    : 'view.settings.advanced.advanced_ui.behavior.deep_link_not_registered'
            )}
        >
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={repairing}
                onClick={() => void repairRegistration()}
            >
                {t(
                    'view.settings.advanced.advanced_ui.behavior.deep_link_repair'
                )}
            </Button>
        </Field>
    );
}
