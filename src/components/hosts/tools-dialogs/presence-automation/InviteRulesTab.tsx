import { InfoIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { InviteMessagePicker } from '@/components/dialogs/invite-message/InviteMessagePicker';
import { userStatusLabel } from '@/shared/utils/userStatus';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
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
    const allowedStatusOptions = statusOptions.map((status) => ({
        value: status,
        label: userStatusLabel(status, t)
    }));
    const autoAcceptEnabled = values.autoAcceptInviteRequests !== 'Off';
    const selectedFavoritesOnly =
        values.autoAcceptInviteRequests === 'Selected Favorites';
    const parsedMessageSlot = Number.parseInt(
        values.autoAcceptInviteMessageSlot,
        10
    );
    const messageSlot = Number.isInteger(parsedMessageSlot)
        ? parsedMessageSlot
        : null;

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
                    <InviteMessagePicker
                        currentUserId={getCurrentUserId()}
                        endpoint={getEndpoint()}
                        value={messageSlot}
                        disabled={loading || !autoAcceptEnabled}
                        onChange={(slot) => {
                            onSaveValue(
                                'autoAcceptInviteMessageSlot',
                                slot === null ? '' : String(slot)
                            );
                        }}
                    />
                </div>
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
