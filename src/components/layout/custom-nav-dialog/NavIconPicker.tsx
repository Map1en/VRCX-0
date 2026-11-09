import { useState } from 'react';

import { getNavIconComponent } from '@/components/layout/navIconRegistry';
import { cn } from '@/lib/utils';
import {
    NAV_ICON_OPTIONS,
    normalizeNavIconKey
} from '@/shared/constants/navIcons';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

type NavIconPickerProps = {
    value?: string;
    fallbackIcon?: string;
    ariaLabel: string;
    onValueChange: (value: string) => void;
};

export function NavIconPicker({
    value,
    fallbackIcon,
    ariaLabel,
    onValueChange
}: NavIconPickerProps) {
    const [open, setOpen] = useState(false);
    const normalizedIcon = normalizeNavIconKey(value, fallbackIcon);
    const CurrentIcon = getNavIconComponent(normalizedIcon);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <span className="inline-flex shrink-0">
                            <PopoverTrigger
                                render={
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={ariaLabel}
                                    >
                                        <CurrentIcon data-icon="icon" />
                                    </Button>
                                }
                            />
                        </span>
                    }
                />
                <TooltipContent>{ariaLabel}</TooltipContent>
            </Tooltip>
            <PopoverContent
                align="start"
                className="grid w-auto grid-cols-8 gap-1 p-2"
            >
                {NAV_ICON_OPTIONS.map((option) => {
                    const OptionIcon = getNavIconComponent(option.key);
                    const selected = option.key === normalizedIcon;
                    return (
                        <HintTooltip key={option.key} label={option.label}>
                            <Button
                                type="button"
                                variant={selected ? 'secondary' : 'ghost'}
                                size="icon-sm"
                                aria-pressed={selected}
                                className={cn(selected && 'text-primary')}
                                onClick={() => {
                                    onValueChange(option.key);
                                    setOpen(false);
                                }}
                            >
                                <OptionIcon data-icon="icon" />
                            </Button>
                        </HintTooltip>
                    );
                })}
            </PopoverContent>
        </Popover>
    );
}
