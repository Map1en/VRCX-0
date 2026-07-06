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
import type { PresenceOption } from './presenceAutomationDialogUtils';

const I18N_ROOT = 'view.tools.social_automation';

export type InviteRulesTabValues = {
    autoAcceptInviteGroups: string[];
    autoAcceptInviteRequests: string;
};

type ConfigValueType = 'array' | 'bool' | 'string';

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
                            idPrefix="autoAcceptInviteGroups"
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
            <Alert>
                <InfoIcon data-icon="inline-start" />
                <AlertDescription>
                    {t(`${I18N_ROOT}.automatic_replies_note`)}
                </AlertDescription>
            </Alert>
        </FieldGroup>
    );
}
