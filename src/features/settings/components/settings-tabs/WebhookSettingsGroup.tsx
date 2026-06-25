import { CircleHelpIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

import { Field, SettingsGroup } from '../SettingsField';

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

const WEBHOOK_PAYLOAD_FIELDS: Array<[string, string]> = [
    ['version', 'field_option_version'],
    ['event', 'field_option_event'],
    ['category', 'field_option_category'],
    ['title', 'field_option_title'],
    ['message', 'field_option_message'],
    ['user', 'field_option_user'],
    ['location', 'field_option_location'],
    ['locationId', 'field_option_location_id'],
    ['worldId', 'field_option_world_id'],
    ['worldName', 'field_option_world_name'],
    ['timestamp', 'field_option_timestamp'],
    ['localTime', 'field_option_local_time']
];

const DEFAULT_WEBHOOK_FIELDS = WEBHOOK_PAYLOAD_FIELDS.map(([field]) => field);

type WebhookPayloadFieldsDialogProps = {
    webhookEnabled: boolean;
    webhookFormat: string;
    webhookFields: unknown;
    onWebhookFieldsChange(value: string): void;
};

type WebhookSettingsGroupProps = {
    prefs: any;
    onWebhookEnabledChange(value: boolean): void;
    onWebhookUrlDraftChange(value: string): void;
    onWebhookUrlBlur(value: string): void;
    onWebhookFormatChange(value: string): void;
    onWebhookFieldsChange(value: string): void;
    onOpenWebhookNotificationFiltersDialog(): void;
    onTestWebhook(): void;
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
        .filter((field) => DEFAULT_WEBHOOK_FIELDS.includes(field));
    return selected.length
        ? Array.from(new Set(selected))
        : DEFAULT_WEBHOOK_FIELDS;
}

function formatWebhookFields(fields: string[]): string {
    return JSON.stringify(
        fields.filter((field) => DEFAULT_WEBHOOK_FIELDS.includes(field))
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
    const ordered = DEFAULT_WEBHOOK_FIELDS.filter((item) => current.has(item));
    return ordered.length ? ordered : [...DEFAULT_WEBHOOK_FIELDS];
}

export function WebhookSettingsGroup({
    prefs,
    onWebhookEnabledChange,
    onWebhookUrlDraftChange,
    onWebhookUrlBlur,
    onWebhookFormatChange,
    onWebhookFieldsChange,
    onOpenWebhookNotificationFiltersDialog,
    onTestWebhook
}: WebhookSettingsGroupProps) {
    const { t } = useTranslation();

    return (
        <SettingsGroup
            title={t(
                'view.settings.notifications.notifications.webhook.header'
            )}
        >
            <Field
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
                label={t(
                    'view.settings.notifications.notifications.webhook.url'
                )}
                controlId="settings-webhook-url"
            >
                <Input
                    id="settings-webhook-url"
                    className="w-full max-w-lg"
                    value={prefs.webhookUrl || ''}
                    disabled={!prefs.webhookEnabled}
                    placeholder={t(
                        'view.settings.notifications.notifications.webhook.url_placeholder'
                    )}
                    onChange={(event: any) =>
                        onWebhookUrlDraftChange(event.target.value)
                    }
                    onBlur={(event: any) =>
                        onWebhookUrlBlur(event.target.value)
                    }
                />
            </Field>

            <Field
                label={t(
                    'view.settings.notifications.notifications.webhook.format'
                )}
                controlId="settings-webhook-format"
            >
                <Select
                    value={prefs.webhookFormat || 'generic'}
                    disabled={!prefs.webhookEnabled}
                    onValueChange={onWebhookFormatChange}
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
                                <SelectItem value="generic">
                                    {t(
                                        'view.settings.notifications.notifications.webhook.format_generic'
                                    )}
                                </SelectItem>
                                <SelectItem value="discord">
                                    {t(
                                        'view.settings.notifications.notifications.webhook.format_discord'
                                    )}
                                </SelectItem>
                            </SelectGroup>
                        </SelectContent>
                    </div>
                </Select>
            </Field>

            <Field
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
                label={t(
                    'view.settings.notifications.notifications.webhook.notification_filters'
                )}
            >
                <Button
                    type="button"
                    variant="outline"
                    disabled={!prefs.webhookEnabled}
                    onClick={onOpenWebhookNotificationFiltersDialog}
                >
                    {t('common.actions.configure')}
                </Button>
            </Field>

            <Field
                label={t(
                    'view.settings.notifications.notifications.webhook.send_test'
                )}
            >
                <Button
                    type="button"
                    variant="outline"
                    disabled={
                        !prefs.webhookEnabled ||
                        !String(prefs.webhookUrl || '').trim()
                    }
                    onClick={onTestWebhook}
                >
                    {t(
                        'view.settings.notifications.notifications.webhook.send_test'
                    )}
                </Button>
            </Field>
        </SettingsGroup>
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
            <DialogTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                    <CircleHelpIcon data-icon="inline-start" />
                    {t('common.actions.configure')}
                </Button>
            </DialogTrigger>
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
                            {WEBHOOK_PAYLOAD_FIELDS.map(([field, labelKey]) => (
                                <label
                                    key={field}
                                    className="flex min-h-9 items-center gap-2 text-sm"
                                >
                                    <Checkbox
                                        checked={selectedWebhookFields.includes(
                                            field
                                        )}
                                        disabled={fieldsDisabled}
                                        onCheckedChange={(checked: any) => {
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
                                            `view.settings.notifications.notifications.webhook.${labelKey}`
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
                </div>
            </DialogContent>
        </Dialog>
    );
}

function WebhookExampleBlock({ title, value }: any) {
    return (
        <section className="flex min-w-0 flex-col gap-2">
            <div className="text-sm font-medium">{title}</div>
            <pre className="bg-muted/30 max-h-80 overflow-auto rounded-md border p-3 text-xs leading-relaxed">
                <code>{value}</code>
            </pre>
        </section>
    );
}
