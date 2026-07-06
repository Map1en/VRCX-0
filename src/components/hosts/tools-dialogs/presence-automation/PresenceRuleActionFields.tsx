import { useTranslation } from 'react-i18next';

import { userStatusLabel } from '@/shared/utils/userStatus';
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

import { statusOptions } from '../toolsDialogUtils';

const I18N_ROOT = 'view.tools.social_automation';

type PresenceRuleActionFieldsProps = {
    idPrefix: string;
    disabled?: boolean;
    status?: string;
    statusDescriptionEnabled: boolean;
    statusDescription: string;
    onStatusChange: (status: string) => void;
    onStatusDescriptionEnabledChange: (enabled: boolean) => void;
    onStatusDescriptionChange: (statusDescription: string) => void;
};

export function PresenceRuleActionFields({
    idPrefix,
    disabled,
    status,
    statusDescriptionEnabled,
    statusDescription,
    onStatusChange,
    onStatusDescriptionEnabledChange,
    onStatusDescriptionChange
}: PresenceRuleActionFieldsProps) {
    const { t } = useTranslation();
    const statusId = `${idPrefix}-status-action`;
    const statusDescriptionSwitchId = `${idPrefix}-status-description-action`;
    const statusDescriptionInputId = `${idPrefix}-status-description-input`;

    return (
        <FieldSet
            className="rounded-md border p-3"
            disabled={disabled}
            data-disabled={disabled}
        >
            <FieldLegend variant="label">
                {t(`${I18N_ROOT}.status`)}
            </FieldLegend>
            <FieldGroup className="grid items-start gap-3 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <Field>
                    <FieldLabel htmlFor={statusId}>
                        {t(`${I18N_ROOT}.status`)}
                    </FieldLabel>
                    <Select
                        value={status || 'no-change'}
                        disabled={disabled}
                        onValueChange={(value) => onStatusChange(value ?? '')}
                        items={[
                            {
                                value: 'no-change',
                                label: t(`${I18N_ROOT}.do_not_change`)
                            },
                            ...statusOptions.map((statusOption) => ({
                                value: statusOption,
                                label: userStatusLabel(statusOption, t)
                            }))
                        ]}
                    >
                        <SelectTrigger id={statusId}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="no-change">
                                    {t(`${I18N_ROOT}.do_not_change`)}
                                </SelectItem>
                                {statusOptions.map((statusOption) => (
                                    <SelectItem
                                        key={statusOption}
                                        value={statusOption}
                                    >
                                        {userStatusLabel(statusOption, t)}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>
                <Field className="min-w-0">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                            <FieldLabel htmlFor={statusDescriptionSwitchId}>
                                {t(`${I18N_ROOT}.signature`)}
                            </FieldLabel>
                        </div>
                        <Switch
                            id={statusDescriptionSwitchId}
                            checked={statusDescriptionEnabled}
                            disabled={disabled}
                            onCheckedChange={onStatusDescriptionEnabledChange}
                        />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                        <Input
                            id={statusDescriptionInputId}
                            className="min-w-0"
                            value={statusDescription}
                            maxLength={32}
                            disabled={disabled || !statusDescriptionEnabled}
                            placeholder={t(
                                'view.settings.general.automation.status_description_placeholder'
                            )}
                            aria-label={t(`${I18N_ROOT}.signature`)}
                            onChange={(event) =>
                                onStatusDescriptionChange(event.target.value)
                            }
                        />
                        <FieldDescription className="text-right text-xs">
                            {statusDescription.length}/32
                        </FieldDescription>
                    </div>
                </Field>
            </FieldGroup>
        </FieldSet>
    );
}
