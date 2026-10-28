import { InfoIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { InviteMessageDialog } from '@/components/dialogs/InviteMessageDialog';
import { userStatusLabel } from '@/shared/utils/userStatus';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet
} from '@/ui/shadcn/field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import {
    getCurrentUserId,
    getEndpoint,
    normalizeAutoAcceptMode,
    statusOptions,
    type AutoAcceptInviteRequestValue
} from '../toolsDialogUtils';
import { CompactCheckList } from './AutomationRuleLayout';
import { useFavoriteFriendGroupOptions } from './useFavoriteFriendGroupOptions';

const I18N_ROOT = 'view.tools.social_automation';

export type InviteRulesTabValues = {
    autoAcceptInviteGroups: string[];
    autoAcceptInviteRequests: AutoAcceptInviteRequestValue;
    autoAcceptInviteStatuses: string[];
    autoAcceptInviteMessageSlot: string;
};

type InviteRulesTabProps = {
    loading: boolean;
    onSaveValue: <K extends keyof InviteRulesTabValues>(
        key: K,
        value: InviteRulesTabValues[K]
    ) => void;
    values: InviteRulesTabValues;
};

export function InviteRulesTab({
    values,
    loading,
    onSaveValue
}: InviteRulesTabProps) {
    const { t } = useTranslation();
    const groupOptions = useFavoriteFriendGroupOptions();
    const [messagePickerOpen, setMessagePickerOpen] = useState(false);
    const allowedStatusOptions = statusOptions.map((status) => ({
        value: status,
        label: userStatusLabel(status, t)
    }));
    const autoAcceptEnabled = values.autoAcceptInviteRequests !== 'Off';
    const selectedFavoritesOnly =
        values.autoAcceptInviteRequests === 'Selected Favorites';
    const messageSlot = values.autoAcceptInviteMessageSlot;

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
                                onSaveValue(
                                    'autoAcceptInviteRequests',
                                    value ?? 'Off'
                                );
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
                                onSaveValue('autoAcceptInviteGroups', next);
                            }}
                        />
                    </Field>
                    <Field data-disabled={loading || !autoAcceptEnabled}>
                        <FieldLabel>
                            {t(`${I18N_ROOT}.allowed_statuses_label`)}
                        </FieldLabel>
                        <CompactCheckList
                            values={values.autoAcceptInviteStatuses}
                            options={allowedStatusOptions}
                            disabled={loading || !autoAcceptEnabled}
                            onChange={(next) => {
                                onSaveValue('autoAcceptInviteStatuses', next);
                            }}
                        />
                        <FieldDescription>
                            {t(`${I18N_ROOT}.allowed_statuses_description`)}
                        </FieldDescription>
                    </Field>
                </FieldGroup>
            </FieldSet>
            <FieldSet
                className="bg-card/40 rounded-lg border p-3"
                disabled={loading || !autoAcceptEnabled}
                data-disabled={loading || !autoAcceptEnabled}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <FieldLegend variant="label">
                            {t(`${I18N_ROOT}.invite_message`)}
                        </FieldLegend>
                        <FieldDescription>
                            {t(`${I18N_ROOT}.invite_message_description`)}
                        </FieldDescription>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <span className="text-muted-foreground text-sm">
                            {messageSlot
                                ? t(`${I18N_ROOT}.invite_message_slot`, {
                                      slot: messageSlot
                                  })
                                : t(`${I18N_ROOT}.invite_message_none`)}
                        </span>
                        {messageSlot ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    onSaveValue(
                                        'autoAcceptInviteMessageSlot',
                                        ''
                                    );
                                }}
                            >
                                {t('common.actions.clear')}
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setMessagePickerOpen(true)}
                        >
                            {t('common.actions.select')}
                        </Button>
                    </div>
                </div>
            </FieldSet>
            <InviteMessageDialog
                open={messagePickerOpen}
                onOpenChange={setMessagePickerOpen}
                currentUserId={getCurrentUserId()}
                endpoint={getEndpoint()}
                messageType="message"
                mode="select"
                allowEdit
                actionLabel={t('common.actions.select')}
                title={t(`${I18N_ROOT}.invite_message_picker_title`)}
                onUse={({ row }) => {
                    onSaveValue(
                        'autoAcceptInviteMessageSlot',
                        String(row.slot)
                    );
                }}
            />
            <Alert>
                <InfoIcon data-icon="inline-start" />
                <AlertDescription>
                    {t(`${I18N_ROOT}.automatic_replies_note`)}
                </AlertDescription>
            </Alert>
        </FieldGroup>
    );
}
