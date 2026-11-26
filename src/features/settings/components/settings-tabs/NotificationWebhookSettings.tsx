import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import {
    commands,
    type NotificationWebhookFormat,
    type WebhookDeliverySnapshot
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { usePreferencesStore } from '@/state/preferencesStore';

import { useSettingsPageSection } from '../../SettingsPageStateContext';
import { WebhookSettingsGroup } from './WebhookSettingsGroup';

export function NotificationWebhookSettings() {
    const { t } = useTranslation();
    const {
        setWebhookNotificationsDialogOpen,
        saveStringPreference,
        saveBoolPreference
    } = useSettingsPageSection('notifications');
    const prefs = usePreferencesStore(
        useShallow((state) => ({
            webhookEnabled: state.webhookEnabled,
            webhookAuthEventsEnabled: state.webhookAuthEventsEnabled,
            webhookPauseWithDoNotDisturb: state.webhookPauseWithDoNotDisturb,
            webhookUrl: state.webhookUrl,
            webhookFormat: state.webhookFormat,
            webhookFields: state.webhookFields
        }))
    );
    const [webhookDeliverySnapshot, setWebhookDeliverySnapshot] =
        useState<WebhookDeliverySnapshot | null>(null);
    const [webhookDeliveryLoading, setWebhookDeliveryLoading] = useState(true);

    const refreshWebhookDeliveryStatus = useCallback(
        async (showError: boolean) => {
            setWebhookDeliveryLoading(true);
            try {
                setWebhookDeliverySnapshot(
                    await commands.appWebhookDeliverySnapshotGet()
                );
            } catch (error: unknown) {
                if (showError) {
                    toast.add({
                        type: 'error',
                        title:
                            error instanceof Error
                                ? error.message
                                : String(error)
                    });
                }
            } finally {
                setWebhookDeliveryLoading(false);
            }
        },
        []
    );

    useEffect(() => {
        void refreshWebhookDeliveryStatus(false);
    }, [refreshWebhookDeliveryStatus]);

    function saveWebhookEnabled(checked: boolean) {
        saveBoolPreference('webhookEnabled', 'webhookEnabled', checked);
    }

    function saveWebhookAuthEventsEnabled(checked: boolean) {
        saveBoolPreference(
            'webhookAuthEventsEnabled',
            'webhookAuthEventsEnabled',
            checked
        );
    }

    function saveWebhookPauseWithDoNotDisturb(checked: boolean) {
        saveBoolPreference(
            'webhookPauseWithDoNotDisturb',
            'webhookPauseWithDoNotDisturb',
            checked
        );
    }

    function saveWebhookUrl(value: string) {
        saveStringPreference('webhookUrl', 'webhookUrl', value);
    }

    function saveWebhookFormat(value: NotificationWebhookFormat) {
        saveStringPreference('webhookFormat', 'webhookFormat', value);
    }

    function saveWebhookFields(value: string) {
        saveStringPreference('webhookFields', 'webhookFields', value);
    }

    function openWebhookNotificationFilters() {
        setWebhookNotificationsDialogOpen(true);
    }

    function sendTestWebhook() {
        const webhookFormat =
            prefs.webhookFormat === 'discord' ? 'discord' : 'generic';
        commands
            .appWebhookSendTest(
                String(prefs.webhookUrl || ''),
                webhookFormat,
                String(prefs.webhookFields || '')
            )
            .then((outcome) => {
                toast.add({
                    type: 'success',
                    title: t(
                        'view.settings.notifications.notifications.webhook.test_sent',
                        { status: outcome.status }
                    )
                });
            })
            .catch((error: unknown) => {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error ? error.message : String(error)
                });
            });
    }

    return (
        <WebhookSettingsGroup
            prefs={prefs}
            onWebhookEnabledChange={saveWebhookEnabled}
            onWebhookAuthEventsEnabledChange={saveWebhookAuthEventsEnabled}
            onWebhookPauseWithDoNotDisturbChange={
                saveWebhookPauseWithDoNotDisturb
            }
            onWebhookUrlCommit={saveWebhookUrl}
            onWebhookFormatChange={saveWebhookFormat}
            onWebhookFieldsChange={saveWebhookFields}
            onOpenWebhookNotificationFiltersDialog={
                openWebhookNotificationFilters
            }
            onTestWebhook={sendTestWebhook}
            deliverySnapshot={webhookDeliverySnapshot}
            deliveryStatusLoading={webhookDeliveryLoading}
            onRefreshDeliveryStatus={() => {
                void refreshWebhookDeliveryStatus(true);
            }}
        />
    );
}
