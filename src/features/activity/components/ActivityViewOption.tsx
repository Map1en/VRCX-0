import { Fragment } from 'react';

import { Toggle } from '@/ui/shadcn/toggle';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

export function OptionToggle({
    label,
    active,
    onToggle
}: {
    label: string;
    active: boolean;
    onToggle: (next: boolean) => void;
}) {
    return (
        <Toggle
            size="sm"
            pressed={active}
            onPressedChange={onToggle}
            aria-label={label}
            className="text-muted-foreground data-pressed:text-foreground shrink-0 text-xs"
        >
            {label}
        </Toggle>
    );
}

export function OptionSegmented<T extends string>({
    value,
    options,
    onValueChange
}: {
    value: T;
    options: readonly { value: T; label: string }[];
    onValueChange: (next: T) => void;
}) {
    return (
        <ToggleGroup
            variant="outline"
            size="sm"
            value={[value]}
            onValueChange={(next) => {
                const selected = options.find(
                    (option) => option.value === next[0]
                );
                if (selected) {
                    onValueChange(selected.value);
                }
            }}
            className="shrink-0"
        >
            {options.map((option, index) => (
                <Fragment key={option.value}>
                    {index > 0 ? <ToggleGroupSeparator /> : null}
                    <ToggleGroupItem
                        value={option.value}
                        aria-label={option.label}
                        className="text-xs"
                    >
                        {option.label}
                    </ToggleGroupItem>
                </Fragment>
            ))}
        </ToggleGroup>
    );
}
