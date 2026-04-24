import {
    CalendarDaysIcon,
    ChevronLeftIcon,
    ChevronRightIcon
} from 'lucide-react';
import { useMemo } from 'react';

import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';

import {
    formatDateLabel,
    getTodayKey
} from '../instance-activity/instanceActivityDate.js';

export function InstanceActivityDateControls({
    selectedDate,
    onSelectedDateChange,
    availableDates,
    dataStatus
}) {
    const sortedDatesDesc = useMemo(
        () =>
            [...availableDates].sort((left, right) =>
                right.localeCompare(left)
            ),
        [availableDates]
    );
    const earliestDate = sortedDatesDesc[sortedDatesDesc.length - 1] || null;
    const latestDate = sortedDatesDesc[0] || null;
    const selectedDateIndex = sortedDatesDesc.findIndex(
        (value) => value === selectedDate
    );
    const dateOptions = useMemo(() => {
        const options = [...sortedDatesDesc];
        if (selectedDate && !options.includes(selectedDate)) {
            options.unshift(selectedDate);
        }
        return options;
    }, [selectedDate, sortedDatesDesc]);

    const isNextDayDisabled = !latestDate || selectedDate >= latestDate;
    const isPrevDayDisabled = !earliestDate || selectedDate === earliestDate;

    function handleDateStep(isNext = false) {
        if (!sortedDatesDesc.length) {
            return;
        }

        if (selectedDateIndex === -1 && !isNext) {
            const earlierDate = sortedDatesDesc.find(
                (value) => value < selectedDate
            );
            if (earlierDate) {
                onSelectedDateChange(earlierDate);
                return;
            }
        }

        if (selectedDateIndex !== -1) {
            const nextIndex = isNext
                ? selectedDateIndex - 1
                : selectedDateIndex + 1;
            if (nextIndex >= 0 && nextIndex < sortedDatesDesc.length) {
                onSelectedDateChange(sortedDatesDesc[nextIndex]);
                return;
            }
        }

        onSelectedDateChange(isNext ? latestDate : earliestDate);
    }

    return (
        <>
            <div className="mr-2 flex items-center">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={'Previous day'}
                    disabled={isPrevDayDisabled}
                    onClick={() => handleDateStep(false)}
                >
                    <ChevronLeftIcon data-icon="inline-start" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={'Next day'}
                    disabled={isNextDayDisabled}
                    onClick={() => handleDateStep(true)}
                >
                    <ChevronRightIcon data-icon="inline-start" />
                </Button>
            </div>
            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        className="w-52 justify-start text-left font-normal"
                        disabled={dataStatus === 'running'}
                    >
                        <CalendarDaysIcon data-icon="inline-start" />
                        {selectedDate}
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 p-3">
                    <div className="grid gap-3">
                        <Input
                            type="date"
                            value={selectedDate}
                            onChange={(event) =>
                                onSelectedDateChange(
                                    event.target.value || getTodayKey()
                                )
                            }
                        />
                        {dateOptions.length ? (
                            <div className="grid max-h-56 gap-1 overflow-y-auto">
                                {dateOptions.map((dayKey) => (
                                    <Button
                                        key={dayKey}
                                        type="button"
                                        variant={
                                            dayKey === selectedDate
                                                ? 'default'
                                                : 'ghost'
                                        }
                                        size="sm"
                                        className="justify-start"
                                        onClick={() =>
                                            onSelectedDateChange(dayKey)
                                        }
                                    >
                                        {formatDateLabel(dayKey)}
                                        {availableDates.includes(dayKey)
                                            ? ''
                                            : ' (no activity)'}
                                    </Button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </PopoverContent>
            </Popover>
        </>
    );
}
