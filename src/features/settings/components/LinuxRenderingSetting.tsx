import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type LinuxRenderingSnapshot
} from '@/platform/tauri/bindings';
import { restartApplication } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import { useCriticalTaskStore } from '@/state/criticalTaskStore';
import { Switch } from '@/ui/shadcn/switch';

import { Field } from './SettingsField';

export function LinuxRenderingSetting() {
    const { t } = useTranslation();
    const [snapshot, setSnapshot] = useState<
        LinuxRenderingSnapshot | null | undefined
    >(undefined);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const critical = useCriticalTaskStore(
        (state) => state.activeTasks.length > 0
    );

    useEffect(() => {
        let active = true;
        commands
            .appGetLinuxRendering()
            .then((result) => {
                if (active) setSnapshot(result);
            })
            .catch(() => {
                if (active) setFailed(true);
            });
        return () => {
            active = false;
        };
    }, []);

    async function change(enabled: boolean) {
        setBusy(true);
        setFailed(false);
        try {
            setSnapshot(await commands.appSetLinuxRendering(enabled));
            toast.add({
                title: t('linux_rendering.saved'),
                actionProps: {
                    children: t('linux_rendering.restart_now'),
                    onClick: () => {
                        void restartApplication();
                    }
                }
            });
        } catch {
            setFailed(true);
        } finally {
            setBusy(false);
        }
    }

    if (snapshot === null) return null;
    return (
        <Field
            label={t('linux_rendering.title')}
            description={t('linux_rendering.description')}
            error={failed ? t('linux_rendering.failed') : undefined}
        >
            <Switch
                checked={snapshot?.enabled === true}
                disabled={busy || critical || !snapshot}
                onCheckedChange={(value) => {
                    void change(value);
                }}
            />
        </Field>
    );
}
