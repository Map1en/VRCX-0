import {
    CalendarDaysIcon,
    ChevronLeftIcon,
    ChevronRightIcon
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/shadcn/button';
import { Calendar } from '@/ui/shadcn/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';

import {
    formatDateLabel,
    parseLocalDayKey,
    toLocalDayKey
} from '../instance-activity/instanceActivityDate';

type InstanceActivityDateControlsProps = {
    selectedDate: string;
    onSelectedDateChange: (value: string) => void;
    availableDates: string[];
    dataStatus: string;
};

export function InstanceActivityDateControls({
    selectedDate,
    onSelectedDateChange,
    availableDates,
    dataStatus
}: InstanceActivityDateControlsProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
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
    const availableDateObjects = useMemo(
        () => availableDates.map((dayKey) => parseLocalDayKey(dayKey)),
        [availableDates]
    );
    const selectedDateObject = selectedDate
        ? parseLocalDayKey(selectedDate)
        : undefined;

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

        const fallbackDate = isNext ? latestDate : earliestDate;
        if (fallbackDate) {
            onSelectedDateChange(fallbackDate);
        }
    }

    return (
        <>
            <div className="mr-2 flex items-center">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('view.charts.instance_activity.previous_day')}
                    disabled={isPrevDayDisabled}
                    onClick={() => handleDateStep(false)}
                >
                    <ChevronLeftIcon data-icon="inline-start" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('view.charts.instance_activity.next_day')}
                    disabled={isNextDayDisabled}
                    onClick={() => handleDateStep(true)}
                >
                    <ChevronRightIcon data-icon="inline-start" />
                </Button>
            </div>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        className="w-52 justify-start text-left font-normal"
                        disabled={dataStatus === 'running'}
                    >
                        <CalendarDaysIcon data-icon="inline-start" />
                        {selectedDate
                            ? formatDateLabel(selectedDate)
                            : selectedDate}
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                        mode="single"
                        selected={selectedDateObject}
                        defaultMonth={selectedDateObject}
                        disabled={{ after: new Date() }}
                        modifiers={{ hasActivity: availableDateObjects }}
                        modifiersClassNames={{
                            hasActivity:
                                'relative after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary'
                        }}
                        onSelect={(date?: Date) => {
                            if (date) {
                                onSelectedDateChange(toLocalDayKey(date));
                                setOpen(false);
                            }
                        }}
                    />
                </PopoverContent>
            </Popover>
        </>
    );
}
