import { useTranslation } from 'react-i18next';

import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Field,
    FieldContent,
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
import { Textarea } from '@/ui/shadcn/textarea';

import { statusOptions, updateArrayValue } from './toolsDialogUtils';

export function ToolTextarea({ value, rows = 15 }: any) {
    return (
        <Textarea
            readOnly
            rows={rows}
            value={value}
            className="font-mono text-xs"
            onClick={(event: any) => event.currentTarget.select()}
        />
    );
}

export function CheckRow({
    id,
    label,
    description,
    checked,
    disabled,
    onCheckedChange
}: any) {
    return (
        <Field
            orientation="horizontal"
            data-disabled={disabled}
            className="rounded-md border p-3"
        >
            <Checkbox
                id={id}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(value: any) =>
                    onCheckedChange(Boolean(value))
                }
            />
            <FieldContent>
                <FieldLabel htmlFor={id}>{label}</FieldLabel>
                {description ? (
                    <FieldDescription>{description}</FieldDescription>
                ) : null}
            </FieldContent>
        </Field>
    );
}

export function MultiCheckList({
    idPrefix,
    values,
    options,
    disabled,
    onChange
}: any) {
    return (
        <FieldGroup
            data-slot="checkbox-group"
            className="grid gap-2 sm:grid-cols-2"
        >
            {options.map((option: any) => (
                <CheckRow
                    key={option.value}
                    id={`${idPrefix}-${option.value}`}
                    label={option.label}
                    checked={values.includes(option.value)}
                    disabled={disabled}
                    onCheckedChange={(checked: any) =>
                        onChange(
                            updateArrayValue(values, option.value, checked)
                        )
                    }
                />
            ))}
        </FieldGroup>
    );
}

export function StatusEditor({
    id,
    label,
    disabled,
    status,
    descEnabled,
    desc,
    onStatusChange,
    onDescEnabledChange,
    onDescChange
}: any) {
    const { t } = useTranslation();
    const descEnabledId = `${id}-description-enabled`;

    return (
        <FieldSet className="rounded-md border p-3" disabled={disabled}>
            <FieldLegend variant="label">{label}</FieldLegend>
            <FieldGroup>
                <Field>
                    <Select
                        value={status}
                        disabled={disabled}
                        onValueChange={onStatusChange}
                    >
                        <SelectTrigger aria-label={label}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {statusOptions.map((statusOption: any) => (
                                    <SelectItem
                                        key={statusOption}
                                        value={statusOption}
                                    >
                                        {t(
                                            `dialog.user.status.${statusOption.replace(' ', '_')}`
                                        )}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </Field>
                <Field orientation="horizontal" data-disabled={disabled}>
                    <Switch
                        id={descEnabledId}
                        checked={descEnabled}
                        disabled={disabled}
                        onCheckedChange={onDescEnabledChange}
                    />
                    <FieldLabel htmlFor={descEnabledId}>
                        {t(
                            'view.settings.general.automation.change_status_description'
                        )}
                    </FieldLabel>
                </Field>
                {descEnabled ? (
                    <Field data-disabled={disabled}>
                        <Input
                            value={desc}
                            maxLength={32}
                            disabled={disabled}
                            placeholder={t(
                                'view.settings.general.automation.status_description_placeholder'
                            )}
                            onChange={(event: any) =>
                                onDescChange(event.target.value)
                            }
                        />
                    </Field>
                ) : null}
            </FieldGroup>
        </FieldSet>
    );
}
