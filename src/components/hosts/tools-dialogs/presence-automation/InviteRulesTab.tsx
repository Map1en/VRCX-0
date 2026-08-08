import { InfoIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet
} from '@/ui/shadcn/field';
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

import { normalizeAutoAcceptMode } from '../toolsDialogUtils';
import { CompactCheckList } from './AutomationRuleLayout';
import {
    dayOptions,
    type InviteMessageReplySettings,
    type PresenceOption
} from './presenceAutomationDialogUtils';

const I18N_ROOT = 'view.tools.social_automation';

export type InviteRulesTabValues = {
    autoAcceptInviteGroups: string[];
    autoAcceptInviteRequests: string;
    autoInviteMessageReplies: InviteMessageReplySettings;
};

type ConfigValueType = 'array' | 'bool' | 'json' | 'string';

type InviteRulesTabProps = {
    groupOptions: PresenceOption[];
    loading: boolean;
    onSaveValue: (
        key: keyof InviteRulesTabValues,
        value: unknown,
        type?: ConfigValueType
    ) => unknown;
    values: InviteRulesTabValues;
};

export function InviteRulesTab({
    values,
    loading,
    groupOptions,
    onSaveValue
}: InviteRulesTabProps) {
    const { t } = useTranslation();
    const autoAcceptEnabled = values.autoAcceptInviteRequests !== 'Off';
    const selectedFavoritesOnly =
        values.autoAcceptInviteRequests === 'Selected Favorites';
    const messageReplies = values.autoInviteMessageReplies;
    const messageSlotOptions = Array.from({ length: 12 }, (_, slot) => ({
        value: String(slot),
        label: t(`${I18N_ROOT}.message_slot_value`, { slot })
    }));
    const scheduleDayOptions = dayOptions.map((option) => ({
        value: String(option.value),
        label: t(option.labelKey)
    }));
    const saveMessageReplies = (patch: Partial<InviteMessageReplySettings>) => {
        onSaveValue(
            'autoInviteMessageReplies',
            { ...messageReplies, ...patch },
            'json'
        );
    };

    return (
        <FieldGroup className="gap-4">
            <FieldSet className="bg-card/40 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <FieldLegend variant="label">
                            {t(
                                `${I18N_ROOT}.auto_send_invites_for_request_invite`
                            )}
                        </FieldLegend>
                        <FieldDescription>
                            {t(`${I18N_ROOT}.auto_send_invites_description`)}
                        </FieldDescription>
                    </div>
                    <Switch
                        checked={autoAcceptEnabled}
                        disabled={loading}
                        aria-label={t(
                            `${I18N_ROOT}.auto_send_invites_for_request_invite`
                        )}
                        onCheckedChange={(checked) => {
                            onSaveValue(
                                'autoAcceptInviteRequests',
                                checked
                                    ? normalizeAutoAcceptMode(
                                          values.autoAcceptInviteRequests
                                      )
                                    : 'Off'
                            );
                        }}
                    />
                </div>
            </FieldSet>
            <FieldSet
                className="bg-card/40 rounded-lg border p-3"
                disabled={loading || !autoAcceptEnabled}
                data-disabled={loading || !autoAcceptEnabled}
            >
                <FieldLegend variant="label">
                    {t(`${I18N_ROOT}.allowlist_mode`)}
                </FieldLegend>
                <FieldDescription>
                    {t(`${I18N_ROOT}.allowlist_mode_description`)}
                </FieldDescription>
                <FieldGroup className={!autoAcceptEnabled ? 'opacity-75' : ''}>
                    <Field data-disabled={loading || !autoAcceptEnabled}>
                        <FieldLabel>
                            {t(`${I18N_ROOT}.allowlist_mode`)}
                        </FieldLabel>
                        <Select
                            value={normalizeAutoAcceptMode(
                                values.autoAcceptInviteRequests
                            )}
                            disabled={loading || !autoAcceptEnabled}
                            items={[
                                {
                                    value: 'All Favorites',
                                    label: t(
                                        `${I18N_ROOT}.all_favorite_friends`
                                    )
                                },
                                {
                                    value: 'Selected Favorites',
                                    label: t(
                                        `${I18N_ROOT}.selected_favorite_groups`
                                    )
                                }
                            ]}
                            onValueChange={(value) => {
                                onSaveValue('autoAcceptInviteRequests', value);
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="All Favorites">
                                        {t(`${I18N_ROOT}.all_favorite_friends`)}
                                    </SelectItem>
                                    <SelectItem value="Selected Favorites">
                                        {t(
                                            `${I18N_ROOT}.selected_favorite_groups`
                                        )}
                                    </SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field
                        data-disabled={
                            loading ||
                            !autoAcceptEnabled ||
                            !selectedFavoritesOnly
                        }
                    >
                        <FieldLabel>
                            {t(`${I18N_ROOT}.selected_favorite_groups_label`)}
                        </FieldLabel>
                        <CompactCheckList
                            values={values.autoAcceptInviteGroups}
                            options={groupOptions}
                            disabled={
                                loading ||
                                !autoAcceptEnabled ||
                                !selectedFavoritesOnly
                            }
                            onChange={(next) => {
                                onSaveValue(
                                    'autoAcceptInviteGroups',
                                    next,
                                    'array'
                                );
                            }}
                        />
                    </Field>
                </FieldGroup>
            </FieldSet>
            <FieldSet className="bg-card/40 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <FieldLegend variant="label">
                            {t(`${I18N_ROOT}.scheduled_invite_messages`)}
                        </FieldLegend>
                        <FieldDescription>
                            {t(
                                `${I18N_ROOT}.scheduled_invite_messages_description`
                            )}
                        </FieldDescription>
                    </div>
                    <Switch
                        checked={messageReplies.enabled}
                        disabled={loading}
                        aria-label={t(`${I18N_ROOT}.scheduled_invite_messages`)}
                        onCheckedChange={(enabled) =>
                            saveMessageReplies({ enabled })
                        }
                    />
                </div>
            </FieldSet>
            <FieldSet
                className="bg-card/40 rounded-lg border p-3"
                disabled={loading || !messageReplies.enabled}
                data-disabled={loading || !messageReplies.enabled}
            >
                <FieldLegend variant="label">
                    {t(`${I18N_ROOT}.invite_message_actions`)}
                </FieldLegend>
                <FieldDescription>
                    {t(`${I18N_ROOT}.invite_message_actions_description`)}
                </FieldDescription>
                <FieldGroup
                    className={!messageReplies.enabled ? 'opacity-75' : ''}
                >
                    <Field>
                        <div className="flex items-center justify-between gap-3">
                            <FieldLabel>
                                {t(`${I18N_ROOT}.reply_to_invite`)}
                            </FieldLabel>
                            <Switch
                                checked={messageReplies.inviteEnabled}
                                disabled={loading || !messageReplies.enabled}
                                aria-label={t(`${I18N_ROOT}.reply_to_invite`)}
                                onCheckedChange={(inviteEnabled) =>
                                    saveMessageReplies({ inviteEnabled })
                                }
                            />
                        </div>
                        <Select
                            value={String(messageReplies.inviteResponseSlot)}
                            disabled={
                                loading ||
                                !messageReplies.enabled ||
                                !messageReplies.inviteEnabled
                            }
                            items={messageSlotOptions}
                            onValueChange={(value) =>
                                saveMessageReplies({
                                    inviteResponseSlot:
                                        Number.parseInt(value || '0', 10) || 0
                                })
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {messageSlotOptions.map((option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value}
                                        >
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field>
                        <div className="flex items-center justify-between gap-3">
                            <FieldLabel>
                                {t(`${I18N_ROOT}.reply_to_request_invite`)}
                            </FieldLabel>
                            <Switch
                                checked={messageReplies.requestInviteEnabled}
                                disabled={loading || !messageReplies.enabled}
                                aria-label={t(
                                    `${I18N_ROOT}.reply_to_request_invite`
                                )}
                                onCheckedChange={(requestInviteEnabled) =>
                                    saveMessageReplies({ requestInviteEnabled })
                                }
                            />
                        </div>
                        <Select
                            value={String(
                                messageReplies.requestInviteResponseSlot
                            )}
                            disabled={
                                loading ||
                                !messageReplies.enabled ||
                                !messageReplies.requestInviteEnabled
                            }
                            items={messageSlotOptions}
                            onValueChange={(value) =>
                                saveMessageReplies({
                                    requestInviteResponseSlot:
                                        Number.parseInt(value || '0', 10) || 0
                                })
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {messageSlotOptions.map((option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value}
                                        >
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field>
                        <FieldLabel>{t(`${I18N_ROOT}.active_days`)}</FieldLabel>
                        <CompactCheckList
                            values={messageReplies.days.map(String)}
                            options={scheduleDayOptions}
                            disabled={loading || !messageReplies.enabled}
                            onChange={(days) =>
                                saveMessageReplies({
                                    days: days
                                        .map((day) => Number.parseInt(day, 10))
                                        .filter((day) => day >= 1 && day <= 7)
                                })
                            }
                        />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field>
                            <FieldLabel htmlFor="invite-message-start">
                                {t(`${I18N_ROOT}.start_time`)}
                            </FieldLabel>
                            <Input
                                id="invite-message-start"
                                type="time"
                                value={messageReplies.start}
                                disabled={loading || !messageReplies.enabled}
                                onChange={(event) =>
                                    saveMessageReplies({
                                        start: event.target.value
                                    })
                                }
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="invite-message-end">
                                {t(`${I18N_ROOT}.end_time`)}
                            </FieldLabel>
                            <Input
                                id="invite-message-end"
                                type="time"
                                value={messageReplies.end}
                                disabled={loading || !messageReplies.enabled}
                                onChange={(event) =>
                                    saveMessageReplies({
                                        end: event.target.value
                                    })
                                }
                            />
                        </Field>
                    </div>
                    <FieldDescription>
                        {t(`${I18N_ROOT}.overnight_schedule_note`)}
                    </FieldDescription>
                </FieldGroup>
            </FieldSet>
            <Alert>
                <InfoIcon data-icon="inline-start" />
                <AlertDescription>
                    {t(`${I18N_ROOT}.automatic_replies_note`)}
                </AlertDescription>
            </Alert>
        </FieldGroup>
    );
}
