import { ArrowDownRightIcon, ArrowUpRightIcon, EqualIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
    ActivityPagePreviousSummary,
    ActivityPageSeries,
    ActivityPageSummary,
    ActivitySeriesPoint
} from '@/platform/tauri/bindings';

import { averageMinutesPerDay, periodDirection } from '../activityPageModel';
import { useCountUp } from '../useCountUp';
import { Exhibit } from './ActivityExhibit';
import { ActivitySeriesChart } from './ActivitySeriesChart';

function hours(minutes: number) {
    return minutes / 60;
}

const DIRECTION_ICONS = {
    more: ArrowUpRightIcon,
    less: ArrowDownRightIcon,
    same: EqualIcon
};

function PreviousPeriod({
    summary,
    previous,
    rangeDays
}: {
    summary: ActivityPageSummary;
    previous: ActivityPagePreviousSummary;
    rangeDays: number;
}) {
    const { t } = useTranslation();
    if (!previous.hasData) {
        return <>{t('view.activity.previous.none', { days: rangeDays })}</>;
    }
    const direction = periodDirection(
        summary.totalMinutes,
        previous.totalMinutes
    );
    const Icon = DIRECTION_ICONS[direction];
    return (
        <span className="inline-flex items-center gap-1">
            <Icon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="sr-only">
                {t(`view.activity.previous.${direction}`)}
            </span>
            {t('view.activity.previous.summary', {
                days: rangeDays,
                hours: `${hours(previous.totalMinutes).toFixed(1)}${t('view.activity.unit.hours')}`,
                activeDays: previous.activeDays
            })}
        </span>
    );
}

export function ActivityTimeExhibit({
    summary,
    previous,
    rangeDays,
    series,
    isDarkMode,
    onSelectPoint
}: {
    summary: ActivityPageSummary;
    previous: ActivityPagePreviousSummary;
    rangeDays: number;
    series: ActivityPageSeries;
    isDarkMode: boolean;
    onSelectPoint: (point: ActivitySeriesPoint) => void;
}) {
    const { t } = useTranslation();
    const totalHours = useCountUp(hours(summary.totalMinutes), 1);
    const hoursUnit = t('view.activity.unit.hours');
    const seriesLabel =
        series.bucket === 'week'
            ? t('view.activity.section.weekly_time')
            : t('view.activity.section.daily_time');
    const facts = [
        {
            value: `${hours(averageMinutesPerDay(summary)).toFixed(1)}${hoursUnit}`,
            label: t('view.activity.hero.per_day')
        },
        {
            value: String(summary.sessionCount),
            label: t('view.activity.hero.sessions')
        },
        ...(summary.longestSessionMinutes > 0
            ? [
                  {
                      value: `${hours(summary.longestSessionMinutes).toFixed(1)}${hoursUnit}`,
                      label: t('view.activity.hero.longest')
                  }
              ]
            : [])
    ];

    return (
        <Exhibit
            label={t('view.activity.stat.total_time')}
            headline={totalHours.toFixed(1)}
            unit={hoursUnit}
            caption={
                rangeDays > 0 ? (
                    <PreviousPeriod
                        summary={summary}
                        previous={previous}
                        rangeDays={rangeDays}
                    />
                ) : undefined
            }
            aside={
                <dl className="flex flex-wrap gap-x-8 gap-y-3">
                    {facts.map((fact) => (
                        <div key={fact.label} className="min-w-0">
                            <dd className="text-foreground text-lg leading-none font-semibold tabular-nums">
                                {fact.value}
                            </dd>
                            <dt className="text-muted-foreground mt-1 text-xs">
                                {fact.label}
                            </dt>
                        </div>
                    ))}
                </dl>
            }
            detailLabel={seriesLabel}
            detail={
                <ActivitySeriesChart
                    series={series}
                    label={seriesLabel}
                    isDarkMode={isDarkMode}
                    onSelectPoint={onSelectPoint}
                />
            }
        />
    );
}
