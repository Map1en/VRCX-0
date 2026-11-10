import { Field, FieldDescription, FieldLabel } from '@/ui/shadcn/field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

export interface WorldNewInstanceMultiSelectOption {
    value: string;
    label: string;
}

export function WorldNewInstanceMultiSelectField({
    id,
    label,
    placeholder,
    description,
    options,
    value,
    limit,
    disabled,
    onChange
}: {
    id: string;
    label: string;
    placeholder: string;
    description?: string;
    options: WorldNewInstanceMultiSelectOption[];
    value: string[];
    limit: number;
    disabled: boolean;
    onChange: (value: string[]) => void;
}) {
    const labelByValue = new Map(
        options.map((option) => [option.value, option.label])
    );
    const full = value.length >= limit;

    return (
        <Field>
            <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor={id}>{label}</FieldLabel>
                <span className="text-muted-foreground text-xs tabular-nums">
                    {value.length}/{limit}
                </span>
            </div>
            <Select
                multiple
                value={value}
                items={options}
                disabled={disabled}
                onValueChange={(next: string[]) =>
                    onChange(next.slice(0, limit))
                }
            >
                <SelectTrigger id={id} className="w-full">
                    <SelectValue>
                        {(selected: string[]) =>
                            selected.length
                                ? selected
                                      .map(
                                          (item) =>
                                              labelByValue.get(item) || item
                                      )
                                      .join(', ')
                                : placeholder
                        }
                    </SelectValue>
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {options.map((option) => (
                            <SelectItem
                                key={option.value}
                                value={option.value}
                                disabled={full && !value.includes(option.value)}
                            >
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            {description ? (
                <FieldDescription>{description}</FieldDescription>
            ) : null}
        </Field>
    );
}
