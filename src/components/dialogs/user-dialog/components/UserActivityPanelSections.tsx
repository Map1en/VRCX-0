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
    USER_ACTIVITY_HOUR_LABELS
} from '../userActivityPanelModel';
import { HeatmapChart, TopWorldRows } from './UserActivityPanelParts';

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
}: any) {
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
                            onCheckedChange={(value: any) => {
                                changeExcludeHours(value);
                            }}
                            className="scale-75"
                        />
                        <span className="text-muted-foreground text-sm whitespace-nowrap">
                            {t('dialog.user.activity.overlap.exclude_hours')}
                        </span>
                        <Select
                            value={excludeStartHour}
                            onValueChange={(value: any) => {
                                changeExcludeRange('start', value);
                            }}
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
                                        (label: any, index: any) => (
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
                            onValueChange={(value: any) => {
                                changeExcludeRange('end', value);
                            }}
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
                                        (label: any, index: any) => (
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
                                className="block h-full rounded-full transition-all duration-500"
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
}: any) {
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
                                onCheckedChange={(value: any) => {
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
                                onValueChange={(value: any) => {
                                    changeTopWorldsSort(value);
                                }}
                                disabled={topWorldsLoading}
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
