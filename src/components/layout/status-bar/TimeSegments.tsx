import { ClockIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { formatClock, TIMEZONE_OPTIONS } from './statusBarClocks';
import { AppUptimeValue, ClockValue } from './StatusBarFooterParts';
import { formatAppUptime } from './statusBarFormat';
import type { StatusBarClock } from './statusBarTypes';

const TIMEZONE_ITEMS = TIMEZONE_OPTIONS.map((option) => ({
    value: String(option.value),
    label: option.label
}));

export function ClocksSegment({
    clocks,
    onUpdateClockTimezone
}: {
    clocks: StatusBarClock[];
    onUpdateClockTimezone: (index: number, offsetValue: string | null) => void;
}) {
    const { t } = useTranslation();
    const [popoverOpen, setPopoverOpen] = useState<boolean[]>([
        false,
        false,
        false
    ]);

    function setPopoverValue(index: number, open: boolean) {
        setPopoverOpen((current) => {
            const next = [...current];
            next[index] = open;
            return next;
        });
    }

    return clocks.map((clock, index) => (
        <Popover
            key={`${clock.offset}-${index}`}
            open={Boolean(popoverOpen[index])}
            onOpenChange={(open) => setPopoverValue(index, open)}
        >
            <PopoverTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-muted-foreground h-6 gap-1.5 rounded-none px-2 text-xs font-normal tabular-nums"
                    >
                        <ClockIcon
                            data-icon="inline-start"
                            className="text-muted-foreground"
                        />
                        <ClockValue
                            formatter={formatClock}
                            offset={clock.offset}
                        />
                    </Button>
                }
            />
            <PopoverContent side="top" align="center" className="w-72">
                <div className="flex flex-col gap-2 p-1">
                    <label className="text-xs font-medium">
                        {t('status_bar.timezone')}
                    </label>
                    <Select
                        value={String(clock.offset)}
                        items={TIMEZONE_ITEMS}
                        onValueChange={(offset) => {
                            onUpdateClockTimezone(index, offset);
                            setPopoverValue(index, false);
                        }}
                    >
                        <SelectTrigger size="sm" className="w-full">
                            <SelectValue
                                placeholder={t('status_bar.timezone')}
                            />
                        </SelectTrigger>
                        <SelectContent className="max-h-60">
                            <SelectGroup>
                                {TIMEZONE_OPTIONS.map((option) => (
                                    <SelectItem
                                        key={option.value}
                                        value={String(option.value)}
                                    >
                                        <span className="w-full text-right font-mono">
                                            {option.label}
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>
            </PopoverContent>
        </Popover>
    ));
}

export function AppUptimeSegment({ startedAtMs }: { startedAtMs: number }) {
    const { t } = useTranslation();

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <div className="flex h-6 items-center gap-1.5 px-2">
                        <span className="text-muted-foreground">
                            {t('status_bar.app_uptime_short')}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                            <AppUptimeValue
                                formatter={formatAppUptime}
                                startedAtMs={startedAtMs}
                            />
                        </span>
                    </div>
                }
            />
            <TooltipContent>{t('status_bar.app_uptime')}</TooltipContent>
        </Tooltip>
    );
}
