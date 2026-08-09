import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';

import {
    OVERLAP_RENDER_DELAY_MS,
    USER_ACTIVITY_HOUR_LABELS,
    getActivityStatusPercentage,
    type ActivityHeatmapData,
    type TopWorldsSort,
    type UserActivityStatusDistribution,
    type UserActivityTopWorld
} from '../userActivityPanelModel';
import { HeatmapChart, TopWorldRows } from './UserActivityPanelParts';

const STATUS_DISTRIBUTION_SEGMENTS = [
    {
        countKey: 'joinMeCount',
        labelKey: 'dialog.user.status.join_me',
        color: 'var(--status-joinme)'
    },
    {
        countKey: 'activeCount',
        labelKey: 'dialog.user.status.online',
        color: 'var(--status-online)'
    },
    {
        countKey: 'askMeCount',
        labelKey: 'dialog.user.status.ask_me',
        color: 'var(--status-askme)'
    },
    {
        countKey: 'busyCount',
        labelKey: 'dialog.user.status.busy',
        color: 'var(--status-busy)'
    }
] as const;

export function UserActivityStatusDistributionSection({
    distribution
}: {
    distribution: UserActivityStatusDistribution;
}) {
    const { i18n, t } = useTranslation();
    const total = distribution.totalCount;
    const percentageFormatter = new Intl.NumberFormat(
        i18n.resolvedLanguage || 'en',
        { maximumFractionDigits: 1 }
    );
    let offset = 0;
    const segments = STATUS_DISTRIBUTION_SEGMENTS.map((segment) => {
        const count = distribution[segment.countKey];
        const percentage = getActivityStatusPercentage(count, total);
        const result = {
            ...segment,
            count,
            percentage,
            offset
        };
        offset += percentage;
        return result;
    });
    const chartLabel = segments
        .filter((segment) => segment.count > 0)
        .map(
            (segment) =>
                `${t(segment.labelKey)} ${percentageFormatter.format(segment.percentage)}%`
        )
        .join(', ');

    return (
        <section className="border-border mt-4 border-t pt-3">
            <div className="mb-3">
                <h3 className="text-sm font-medium">
                    {t('dialog.user.activity.status_distribution.header')}
                </h3>
                <p className="text-muted-foreground mt-0.5 text-xs">
                    {t('dialog.user.activity.status_distribution.description')}
                </p>
            </div>
            {total > 0 ? (
                <div className="flex flex-col items-center gap-5 py-1 sm:flex-row sm:items-center sm:justify-center">
                    <div
                        className="relative size-36 shrink-0"
                        role="img"
                        aria-label={chartLabel}
                    >
                        <svg
                            viewBox="0 0 42 42"
                            className="size-full -rotate-90"
                            aria-hidden="true"
                        >
                            <circle
                                cx="21"
                                cy="21"
                                r="16"
                                fill="none"
                                stroke="var(--muted)"
                                strokeWidth="7"
                            />
                            {segments.map((segment) =>
                                segment.count > 0 ? (
                                    <circle
                                        key={segment.countKey}
                                        cx="21"
                                        cy="21"
                                        r="16"
                                        pathLength="100"
                                        fill="none"
                                        stroke={segment.color}
                                        strokeWidth="7"
                                        strokeDasharray={`${segment.percentage} ${100 - segment.percentage}`}
                                        strokeDashoffset={-segment.offset}
                                    />
                                ) : null
                            )}
                        </svg>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-xl font-semibold tabular-nums">
                                {total}
                            </span>
                            <span className="text-muted-foreground text-[11px]">
                                {t(
                                    'dialog.user.activity.status_distribution.chart_center_label'
                                )}
                            </span>
                        </div>
                    </div>
                    <div className="grid w-full max-w-md min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                        {segments.map((segment) => (
                            <div
                                key={segment.countKey}
                                className="border-border/70 bg-muted/20 flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2"
                            >
                                <span
                                    className="size-2.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: segment.color }}
                                    aria-hidden="true"
                                />
                                <span className="min-w-0 flex-1 truncate text-sm">
                                    {t(segment.labelKey)}
                                </span>
                                <span className="shrink-0 text-right text-sm tabular-nums">
                                    <span className="font-medium">
                                        {percentageFormatter.format(
                                            segment.percentage
                                        )}
                                        %
                                    </span>
                                    <span className="text-muted-foreground ml-1 text-xs">
                                        ({segment.count})
                                    </span>
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="text-muted-foreground py-2 text-sm">
                    {t('dialog.user.activity.status_distribution.no_data')}
                </div>
            )}
        </section>
    );
}

export function UserActivityOverlapSection({
    bestOverlapTime,
    changeExcludeHours,
    changeExcludeRange,
    dayLabels,
    emptyColor,
    excludeEndHour,
    excludeHoursEnabled,
    excludeStartHour,
    hasOverlapData,
    isDarkMode,
    onOverlapChartRightClick,
    overlapHeatmap,
    overlapLoading,
    overlapLoadingVisible,
    overlapPercent,
    overlapScaleColors,
    weekStartsOn
}: {
    bestOverlapTime: string;
    changeExcludeHours: (value: unknown) => void;
    changeExcludeRange: (kind: 'start' | 'end', value: string) => void;
    dayLabels: string[];
    emptyColor: string;
    excludeEndHour: string;
    excludeHoursEnabled: boolean;
    excludeStartHour: string;
    hasOverlapData: boolean;
    isDarkMode: boolean;
    onOverlapChartRightClick?: () => void;
    overlapHeatmap: ActivityHeatmapData;
    overlapLoading: boolean;
    overlapLoadingVisible: boolean;
    overlapPercent: number;
    overlapScaleColors: string[];
    weekStartsOn: number;
}) {
    const { t } = useTranslation();

    return (
        <div className="border-border mt-4 border-t pt-3">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                        {t('dialog.user.activity.overlap.header')}
                    </span>
                    {overlapLoadingVisible ? (
                        <Spinner className="size-3.5" />
                    ) : null}
                </div>
                {hasOverlapData ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                        <Switch
                            checked={excludeHoursEnabled}
                            onCheckedChange={(value) => {
                                changeExcludeHours(value);
                            }}
                            className="scale-75"
                        />
                        <span className="text-muted-foreground text-sm whitespace-nowrap">
                            {t('dialog.user.activity.overlap.exclude_hours')}
                        </span>
                        <Select
                            value={excludeStartHour}
                            onValueChange={(value) => {
                                changeExcludeRange('start', value || '');
                            }}
                            items={USER_ACTIVITY_HOUR_LABELS.map(
                                (label, index) => ({
                                    value: String(index),
                                    label
                                })
                            )}
                        >
                            <SelectTrigger
                                size="sm"
                                className="h-6 w-[78px] px-2 text-sm"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {USER_ACTIVITY_HOUR_LABELS.map(
                                        (label, index) => (
                                            <SelectItem
                                                key={label}
                                                value={String(index)}
                                            >
                                                {label}
                                            </SelectItem>
                                        )
                                    )}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        <span className="text-muted-foreground text-xs">-</span>
                        <Select
                            value={excludeEndHour}
                            onValueChange={(value) => {
                                changeExcludeRange('end', value || '');
                            }}
                            items={USER_ACTIVITY_HOUR_LABELS.map(
                                (label, index) => ({
                                    value: String(index),
                                    label
                                })
                            )}
                        >
                            <SelectTrigger
                                size="sm"
                                className="h-6 w-[78px] px-2 text-sm"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {USER_ACTIVITY_HOUR_LABELS.map(
                                        (label, index) => (
                                            <SelectItem
                                                key={label}
                                                value={String(index)}
                                            >
                                                {label}
                                            </SelectItem>
                                        )
                                    )}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </div>
                ) : null}
            </div>
            {!overlapLoadingVisible && hasOverlapData ? (
                <div className="mb-2 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <span
                            className={cn(
                                'text-sm font-medium',
                                overlapPercent > 0
                                    ? 'text-accent-foreground'
                                    : 'text-muted-foreground'
                            )}
                        >
                            {overlapPercent}%
                        </span>
                        <span className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                            <span
                                className="block h-full rounded-full transition-[width,background-color] duration-200 ease-out motion-reduce:transition-[background-color]"
                                style={{
                                    width: `${overlapPercent}%`,
                                    backgroundColor: isDarkMode
                                        ? 'hsl(260, 60%, 55%)'
                                        : 'hsl(260, 55%, 50%)'
                                }}
                            />
                        </span>
                    </div>
                    {bestOverlapTime ? (
                        <div className="text-sm">
                            <span className="text-muted-foreground">
                                {t('dialog.user.activity.overlap.peak_overlap')}
                            </span>
                            <span className="ml-1 font-medium">
                                {bestOverlapTime}
                            </span>
                        </div>
                    ) : null}
                </div>
            ) : null}
            {hasOverlapData || overlapLoadingVisible ? (
                <HeatmapChart
                    rawBuckets={overlapHeatmap.rawBuckets}
                    normalizedBuckets={overlapHeatmap.normalizedBuckets}
                    dayLabels={dayLabels}
                    hourLabels={USER_ACTIVITY_HOUR_LABELS}
                    weekStartsOn={weekStartsOn}
                    isDarkMode={isDarkMode}
                    emptyColor={emptyColor}
                    scaleColors={overlapScaleColors}
                    unitLabel={t(
                        'dialog.user.activity.overlap.minutes_overlap'
                    )}
                    renderDelay={OVERLAP_RENDER_DELAY_MS}
                    onContextMenu={onOverlapChartRightClick}
                />
            ) : !overlapLoading && !hasOverlapData ? (
                <div className="text-muted-foreground py-2 text-sm">
                    {t('dialog.user.activity.overlap.no_data')}
                </div>
            ) : null}
        </div>
    );
}

export function UserActivityTopWorldsSection({
    changeExcludeHomeWorld,
    changeTopWorldsSort,
    currentHomeWorldId,
    excludeHomeWorldEnabled,
    loading,
    topWorlds,
    topWorldsLoading,
    topWorldsLoadingVisible,
    topWorldsSortBy
}: {
    changeExcludeHomeWorld: (value: unknown) => void;
    changeTopWorldsSort: (value: unknown) => void;
    currentHomeWorldId: string;
    excludeHomeWorldEnabled: boolean;
    loading: boolean;
    topWorlds: UserActivityTopWorld[];
    topWorldsLoading: boolean;
    topWorldsLoadingVisible: boolean;
    topWorldsSortBy: TopWorldsSort;
}) {
    const { t } = useTranslation();

    return (
        <div className="border-border mt-4 border-t pt-3">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                        {t('dialog.user.activity.most_visited_worlds.header')}
                    </span>
                    {topWorldsLoadingVisible ? (
                        <Spinner className="size-3.5" />
                    ) : null}
                </div>
                <div className="flex items-center gap-4">
                    {currentHomeWorldId ? (
                        <Field
                            orientation="horizontal"
                            className="text-muted-foreground w-auto gap-1.5"
                        >
                            <Switch
                                id="activity-exclude-home-world"
                                checked={excludeHomeWorldEnabled}
                                onCheckedChange={(value) => {
                                    changeExcludeHomeWorld(value);
                                }}
                                className="scale-75"
                            />
                            <FieldLabel
                                htmlFor="activity-exclude-home-world"
                                className="text-muted-foreground text-sm font-normal whitespace-nowrap"
                            >
                                {t(
                                    'dialog.user.activity.most_visited_worlds.exclude_home_world'
                                )}
                            </FieldLabel>
                        </Field>
                    ) : null}
                    {topWorlds.length > 0 ? (
                        <div className="flex items-center gap-2">
                            <span className="text-muted-foreground text-sm">
                                {t('common.sort_by')}
                            </span>
                            <Select
                                value={topWorldsSortBy}
                                onValueChange={(value) => {
                                    changeTopWorldsSort(value);
                                }}
                                disabled={topWorldsLoading}
                                items={[
                                    {
                                        value: 'time',
                                        label: t(
                                            'dialog.user.activity.most_visited_worlds.sort_by_time'
                                        )
                                    },
                                    {
                                        value: 'count',
                                        label: t(
                                            'dialog.user.activity.most_visited_worlds.sort_by_count'
                                        )
                                    }
                                ]}
                            >
                                <SelectTrigger size="sm" className="w-32">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value="time">
                                            {t(
                                                'dialog.user.activity.most_visited_worlds.sort_by_time'
                                            )}
                                        </SelectItem>
                                        <SelectItem value="count">
                                            {t(
                                                'dialog.user.activity.most_visited_worlds.sort_by_count'
                                            )}
                                        </SelectItem>
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>
                    ) : null}
                </div>
            </div>
            {topWorldsLoadingVisible && !topWorlds.length ? (
                <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
                    <Spinner className="size-4" />
                    <span>
                        {t('dialog.user.activity.most_visited_worlds.loading')}
                    </span>
                </div>
            ) : topWorlds.length === 0 && !loading && !topWorldsLoading ? (
                <div className="text-muted-foreground py-2 text-sm">
                    {t('dialog.user.activity.no_data_in_period')}
                </div>
            ) : (
                <TopWorldRows worlds={topWorlds} sortBy={topWorldsSortBy} />
            )}
        </div>
    );
}
