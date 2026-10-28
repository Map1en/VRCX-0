import { CircleHelpIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HighlightedCodeBlock } from '@/components/HighlightedCodeBlock';
import type {
    NotificationWebhookFormat,
    WebhookDeliveryChannelSnapshot,
    WebhookDeliveryRecord,
    WebhookDeliverySnapshot
} from '@/platform/tauri/bindings';
import { GENERIC_WEBHOOK_FIELDS } from '@/shared/constants/webhook';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { SETTINGS_DEFAULT_VALUES } from '../../settingsFieldState';
import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';

const GENERIC_WEBHOOK_EXAMPLE = `{
  "version": 1,
  "event": "Online",
  "category": "favoriteMovement",
  "title": "Pizza",
  "message": "Pizza is now online",
  "user": {
    "id": "usr_xxx",
    "displayName": "Pizza"
  },
  "location": "The Black Cat public",
  "locationId": "wrld_xxx:123",
  "worldId": "wrld_xxx",
  "worldName": "The Black Cat",
  "timestamp": "2026-06-18T08:30:00Z",
  "localTime": "2026-06-18 17:30:00"
}`;

const DISCORD_WEBHOOK_EXAMPLE = `{
  "content": null,
  "embeds": [
    {
      "title": "Pizza is now online",
      "description": "The Black Cat",
      "thumbnail": {
        "url": "https://api.vrchat.cloud/api/1/file/file_xxx/1/file"
      },
      "timestamp": "2026-06-18T08:30:00Z"
    }
  ]
}`;

const WEBHOOK_FIELD_LABEL_KEYS: Record<string, string> = {
    version: 'field_option_version',
    event: 'field_option_event',
    category: 'field_option_category',
    title: 'field_option_title',
    message: 'field_option_message',
    user: 'field_option_user',
    location: 'field_option_location',
    locationId: 'field_option_location_id',
    worldId: 'field_option_world_id',
    worldName: 'field_option_world_name',
    timestamp: 'field_option_timestamp',
    localTime: 'field_option_local_time'
};

const webhookFormatOptions = [
    [
        'generic',
        'view.settings.notifications.notifications.webhook.format_generic'
    ],
    ['discord', 'Discord']
] satisfies ReadonlyArray<readonly [NotificationWebhookFormat, string]>;

type WebhookPayloadFieldsDialogProps = {
    webhookEnabled: boolean;
    webhookFormat: NotificationWebhookFormat;
    webhookFields: unknown;
    onWebhookFieldsChange(value: string): void;
};

type WebhookSettingsPrefs = Record<string, unknown> & {
    webhookAuthEventsEnabled?: boolean;
    webhookEnabled?: boolean;
    webhookFields?: unknown;
    webhookFormat?: NotificationWebhookFormat;
    webhookUrl?: string;
};

type WebhookSettingsGroupProps = {
    prefs: WebhookSettingsPrefs;
    onWebhookEnabledChange(value: boolean): void;
    onWebhookAuthEventsEnabledChange(value: boolean): void;
    onWebhookUrlCommit(value: string): void;
    onWebhookFormatChange(value: NotificationWebhookFormat): void;
    onWebhookFieldsChange(value: string): void;
    onOpenWebhookNotificationFiltersDialog(): void;
    onTestWebhook(): void;
    deliverySnapshot: WebhookDeliverySnapshot | null;
    deliveryStatusLoading: boolean;
    onRefreshDeliveryStatus(): void;
};

function parseWebhookFields(value: unknown): string[] {
    const raw = String(value || '').trim();
    let parsed: unknown[] = [];
    if (raw.startsWith('[')) {
        try {
            const json = JSON.parse(raw);
            parsed = Array.isArray(json) ? json : [];
        } catch {
            parsed = [];
        }
    } else if (raw) {
        parsed = raw.split(',');
    }
    const selected = parsed
        .map((field) => String(field || '').trim())
        .filter((field) => GENERIC_WEBHOOK_FIELDS.includes(field));
    return selected.length
        ? Array.from(new Set(selected))
        : [...GENERIC_WEBHOOK_FIELDS];
}

function formatWebhookFields(fields: string[]): string {
    return JSON.stringify(
        fields.filter((field) => GENERIC_WEBHOOK_FIELDS.includes(field))
    );
}

function updateWebhookFields(
    fields: string[],
    field: string,
    checked: boolean
): string[] {
    const current = new Set(fields);
    if (checked) {
        current.add(field);
    } else {
        current.delete(field);
    }
    const ordered = GENERIC_WEBHOOK_FIELDS.filter((item) => current.has(item));
    return ordered.length ? ordered : [...GENERIC_WEBHOOK_FIELDS];
}

export function WebhookSettingsGroup({
    prefs,
    onWebhookEnabledChange,
    onWebhookAuthEventsEnabledChange,
    onWebhookUrlCommit,
    onWebhookFormatChange,
    onWebhookFieldsChange,
    onOpenWebhookNotificationFiltersDialog,
    onTestWebhook,
    deliverySnapshot,
    deliveryStatusLoading,
    onRefreshDeliveryStatus
}: WebhookSettingsGroupProps) {
    const { t } = useTranslation();
    const [webhookUrlDraft, setWebhookUrlDraft] = useState<string | null>(null);
    const webhookControlsEnabled =
        Boolean(prefs.webhookEnabled) ||
        Boolean(prefs.webhookAuthEventsEnabled);

    function commitWebhookUrlDraft() {
        if (webhookUrlDraft === null) {
            return;
        }
        onWebhookUrlCommit(webhookUrlDraft);
        setWebhookUrlDraft(null);
    }

    return (
        <SettingsCard
            cardId="notifications.webhook"
            title={t(
                'view.settings.notifications.notifications.webhook.header'
            )}
        >
            <Field
                settingId="notifications.webhook.enabled"
                onReset={() =>
                    onWebhookEnabledChange(
                        SETTINGS_DEFAULT_VALUES.webhookEnabled
                    )
                }
                label={t(
                    'view.settings.notifications.notifications.webhook.enabled'
                )}
            >
                <Switch
                    checked={Boolean(prefs.webhookEnabled)}
                    onCheckedChange={onWebhookEnabledChange}
                />
            </Field>

            <Field
                settingId="notifications.webhook.auth-events"
                onReset={() =>
                    onWebhookAuthEventsEnabledChange(
                        SETTINGS_DEFAULT_VALUES.webhookAuthEventsEnabled
                    )
                }
                label={t(
                    'view.settings.notifications.notifications.webhook.auth_events_enabled'
                )}
                description={t(
                    'view.settings.notifications.notifications.webhook.auth_events_description'
                )}
            >
                <Switch
                    checked={Boolean(prefs.webhookAuthEventsEnabled)}
                    onCheckedChange={onWebhookAuthEventsEnabledChange}
                />
            </Field>

            <Field
                settingId="notifications.webhook.url"
                label={t(
                    'view.settings.notifications.notifications.webhook.url'
                )}
                controlId="settings-webhook-url"
                disabled={!webhookControlsEnabled}
            >
                <Input
                    id="settings-webhook-url"
                    className="w-full max-w-lg"
                    value={webhookUrlDraft ?? prefs.webhookUrl ?? ''}
                    placeholder={t(
                        'view.settings.notifications.notifications.webhook.url_placeholder'
                    )}
                    onChange={(event) => setWebhookUrlDraft(event.target.value)}
                    onBlur={commitWebhookUrlDraft}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            commitWebhookUrlDraft();
                        }
                    }}
                />
            </Field>

            <Field
                settingId="notifications.webhook.format"
                onReset={() =>
                    onWebhookFormatChange(SETTINGS_DEFAULT_VALUES.webhookFormat)
                }
                label={t(
                    'view.settings.notifications.notifications.webhook.format'
                )}
                controlId="settings-webhook-format"
                disabled={!webhookControlsEnabled}
            >
                <Select
                    value={prefs.webhookFormat || 'generic'}
                    items={webhookFormatOptions.map(([value, labelKey]) => ({
                        value,
                        label: value === 'discord' ? 'Discord' : t(labelKey)
                    }))}
                    onValueChange={(value) => {
                        if (value) {
                            onWebhookFormatChange(value);
                        }
                    }}
                >
                    <div className="flex items-center gap-2">
                        <SelectTrigger
                            id="settings-webhook-format"
                            className="w-56"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {webhookFormatOptions.map(
                                    ([value, labelKey]) => (
                                        <SelectItem key={value} value={value}>
                                            {value === 'discord'
                                                ? 'Discord'
                                                : t(labelKey)}
                                        </SelectItem>
                                    )
                                )}
                            </SelectGroup>
                        </SelectContent>
                    </div>
                </Select>
            </Field>

            <Field
                settingId="notifications.webhook.fields"
                label={t(
                    'view.settings.notifications.notifications.webhook.fields'
                )}
                description={t(
                    'view.settings.notifications.notifications.webhook.fields_description'
                )}
            >
                <WebhookPayloadFieldsDialog
                    webhookEnabled={Boolean(prefs.webhookEnabled)}
                    webhookFormat={prefs.webhookFormat || 'generic'}
                    webhookFields={prefs.webhookFields}
                    onWebhookFieldsChange={onWebhookFieldsChange}
                />
            </Field>

            <Field
                settingId="notifications.webhook.filters"
                label={t(
                    'view.settings.notifications.notifications.webhook.notification_filters'
                )}
            >
                <Button
                    type="button"
                    variant="outline"
                    onClick={onOpenWebhookNotificationFiltersDialog}
                >
                    {t('common.actions.configure')}
                </Button>
            </Field>

            <Field
                settingId="notifications.webhook.send-test"
                label={t(
                    'view.settings.notifications.notifications.webhook.send_test'
                )}
            >
                <Button
                    type="button"
                    variant="outline"
                    disabled={
                        !webhookControlsEnabled ||
                        !String(prefs.webhookUrl || '').trim()
                    }
                    onClick={onTestWebhook}
                >
                    {t(
                        'view.settings.notifications.notifications.webhook.send_test'
                    )}
                </Button>
            </Field>

            <Field
                settingId="notifications.webhook.delivery-status"
                label={t(
                    'view.settings.notifications.notifications.webhook.delivery_status'
                )}
            >
                <div className="flex w-full flex-col gap-3">
                    <WebhookDeliveryChannelStatus
                        label={t(
                            'view.settings.notifications.notifications.webhook.delivery_activity'
                        )}
                        snapshot={deliverySnapshot?.notification ?? null}
                    />
                    <WebhookDeliveryChannelStatus
                        label={t(
                            'view.settings.notifications.notifications.webhook.delivery_auth'
                        )}
                        snapshot={deliverySnapshot?.auth ?? null}
                    />
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={deliveryStatusLoading}
                        onClick={onRefreshDeliveryStatus}
                    >
                        {t('common.actions.refresh')}
                    </Button>
                </div>
            </Field>
        </SettingsCard>
    );
}

function WebhookDeliveryChannelStatus({
    label,
    snapshot
}: {
    label: string;
    snapshot: WebhookDeliveryChannelSnapshot | null;
}) {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col gap-1 rounded-md border p-2 text-xs">
            <div className="font-medium">{label}</div>
            <WebhookDeliveryRecordStatus
                label={t(
                    'view.settings.notifications.notifications.webhook.delivery_last_success'
                )}
                record={snapshot?.lastSuccess ?? null}
            />
            <WebhookDeliveryRecordStatus
                label={t(
                    'view.settings.notifications.notifications.webhook.delivery_last_failure'
                )}
                record={snapshot?.lastFailure ?? null}
            />
            <div className="text-muted-foreground">
                {t(
                    'view.settings.notifications.notifications.webhook.delivery_dropped',
                    { count: snapshot?.droppedCount ?? 0 }
                )}
            </div>
        </div>
    );
}

function WebhookDeliveryRecordStatus({
    label,
    record
}: {
    label: string;
    record: WebhookDeliveryRecord | null;
}) {
    const { t } = useTranslation();
    if (!record) {
        return (
            <div className="text-muted-foreground">
                {label}:{' '}
                {t(
                    'view.settings.notifications.notifications.webhook.delivery_never'
                )}
            </div>
        );
    }

    return (
        <div className="text-muted-foreground">
            {label}:{' '}
            {t(
                'view.settings.notifications.notifications.webhook.delivery_record',
                {
                    event: record.event,
                    status:
                        record.status === null
                            ? t(
                                  'view.settings.notifications.notifications.webhook.delivery_no_status'
                              )
                            : `HTTP ${record.status}`,
                    attempts: record.attempts,
                    time: new Date(record.observedAt).toLocaleString()
                }
            )}
        </div>
    );
}

function WebhookPayloadFieldsDialog({
    webhookEnabled,
    webhookFormat,
    webhookFields,
    onWebhookFieldsChange
}: WebhookPayloadFieldsDialogProps) {
    const { t } = useTranslation();
    const selectedWebhookFields = parseWebhookFields(webhookFields);
    const fieldsDisabled = !webhookEnabled || webhookFormat !== 'generic';
    function handleFieldCheckedChange(field: string, checked: boolean) {
        onWebhookFieldsChange(
            formatWebhookFields(
                updateWebhookFields(selectedWebhookFields, field, checked)
            )
        );
    }

    return (
        <Dialog>
            <DialogTrigger
                render={
                    <Button type="button" variant="outline" size="sm">
                        <CircleHelpIcon data-icon="inline-start" />
                        {t('common.actions.configure')}
                    </Button>
                }
            />
            <DialogContent className="flex max-h-[calc(100vh-4rem)] min-h-0 flex-col sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        {t(
                            'view.settings.notifications.notifications.webhook.examples_title'
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'view.settings.notifications.notifications.webhook.examples_description'
                        )}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex min-h-0 flex-col gap-4 overflow-auto">
                    <section className="flex min-w-0 flex-col gap-3 rounded-md border p-3">
                        <div className="flex flex-col gap-1">
                            <div className="text-sm font-medium">
                                {t(
                                    'view.settings.notifications.notifications.webhook.fields'
                                )}
                            </div>
                            <div className="text-muted-foreground text-sm">
                                {t(
                                    'view.settings.notifications.notifications.webhook.fields_dialog_note'
                                )}
                            </div>
                            {fieldsDisabled ? (
                                <div className="text-muted-foreground text-sm">
                                    {t(
                                        'view.settings.notifications.notifications.webhook.fields_disabled_note'
                                    )}
                                </div>
                            ) : null}
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {GENERIC_WEBHOOK_FIELDS.map((field) => (
                                <label
                                    key={field}
                                    className="flex min-h-9 items-center gap-2 text-sm"
                                >
                                    <Checkbox
                                        checked={selectedWebhookFields.includes(
                                            field
                                        )}
                                        disabled={fieldsDisabled}
                                        onCheckedChange={(checked) => {
                                            handleFieldCheckedChange(
                                                field,
                                                Boolean(checked)
                                            );
                                        }}
                                    />
                                    <span
                                        className={
                                            fieldsDisabled
                                                ? 'text-muted-foreground'
                                                : undefined
                                        }
                                    >
                                        {t(
                                            `view.settings.notifications.notifications.webhook.${WEBHOOK_FIELD_LABEL_KEYS[field]}`
                                        )}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </section>

                    <div className="grid gap-3 lg:grid-cols-2">
                        <WebhookExampleBlock
                            title={t(
                                'view.settings.notifications.notifications.webhook.generic_example'
                            )}
                            value={GENERIC_WEBHOOK_EXAMPLE}
                        />
                        <WebhookExampleBlock
                            title={t(
                                'view.settings.notifications.notifications.webhook.discord_example'
                            )}
                            value={DISCORD_WEBHOOK_EXAMPLE}
                        />
                    </div>

                    <div className="flex flex-col gap-2 text-sm">
                        <div className="font-medium">
                            {t(
                                'view.settings.notifications.notifications.webhook.fields_title'
                            )}
                        </div>
                        <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5">
                            <li>
                                {t(
                                    'view.settings.notifications.notifications.webhook.comments_note'
                                )}
                            </li>
                            <li>
                                {t(
                                    'view.settings.notifications.notifications.webhook.field_event'
                                )}
                            </li>
                            <li>
                                {t(
                                    'view.settings.notifications.notifications.webhook.field_title_message'
                                )}
                            </li>
                            <li>
                                {t(
                                    'view.settings.notifications.notifications.webhook.field_user'
                                )}
                            </li>
                            <li>
                                {t(
                                    'view.settings.notifications.notifications.webhook.field_location'
                                )}
                            </li>
                            <li>
                                {t(
                                    'view.settings.notifications.notifications.webhook.field_timestamp'
                                )}
                            </li>
                            <li>
                                {t(
                                    'view.settings.notifications.notifications.webhook.field_discord'
                                )}
                            </li>
                        </ul>
                    </div>

                    <div className="flex flex-col gap-2 text-sm">
                        <div className="font-medium">
                            {t(
                                'view.settings.notifications.notifications.webhook.delivery_contract_title'
                            )}
                        </div>
                        <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5">
                            <li>
                                {t(
                                    'view.settings.notifications.notifications.webhook.delivery_contract_http'
                                )}
                            </li>
                            <li>
                                {t(
                                    'view.settings.notifications.notifications.webhook.delivery_contract_auth'
                                )}
                            </li>
                            <li>
                                {t(
                                    'view.settings.notifications.notifications.webhook.delivery_contract_queue'
                                )}
                            </li>
                            <li>
                                {t(
                                    'view.settings.notifications.notifications.webhook.delivery_contract_secret'
                                )}
                            </li>
                        </ul>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function WebhookExampleBlock({
    title,
    value
}: {
    title: string;
    value: string;
}) {
    return (
        <section className="flex min-w-0 flex-col gap-2">
            <div className="text-sm font-medium">{title}</div>
            <HighlightedCodeBlock
                code={value}
                language="json"
                size="sm"
                contentClassName="max-h-80"
            />
        </section>
    );
}
