import { useTranslation } from 'react-i18next';

import { HeatmapChart } from '@/components/dialogs/user-dialog/components/UserActivityPanelParts';
import { USER_ACTIVITY_HOUR_LABELS } from '@/components/dialogs/user-dialog/userActivityPanelModel';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { hourTotals, lateNightShare, peakHour } from '../activityPageModel';
import {
    heatmapScaleColors,
    type ActivityPalette
} from '../useActivityPalette';
import { Exhibit } from './ActivityExhibit';

const HEAT_STEPS = [
    'var(--act-heat-0)',
    'var(--act-heat-1)',
    'var(--act-heat-2)',
    'var(--act-heat-3)',
    'var(--act-heat-4)'
];

function heatStep(value: number, peak: number) {
    if (value <= 0 || peak <= 0) {
        return 'var(--act-track)';
    }
    const index = Math.floor((value / peak) * HEAT_STEPS.length);
    return HEAT_STEPS[Math.min(index, HEAT_STEPS.length - 1)];
}

function HourStrip({ totals }: { totals: number[] }) {
    const { t } = useTranslation();
    const peak = totals.reduce((best, value) => Math.max(best, value), 0);
    const total = totals.reduce((sum, value) => sum + value, 0);
    const hoursUnit = t('view.activity.unit.hours');

    return (
        <div>
            <div className="flex h-12 gap-[3px]">
                {totals.map((value, hour) => {
                    const fill =
                        peak > 0 ? Math.max((value / peak) * 100, 3) : 3;
                    const tint = heatStep(value, peak);
                    const share =
                        total > 0 ? Math.round((value / total) * 100) : 0;
                    const label = `${USER_ACTIVITY_HOUR_LABELS[hour]} · ${share}% · ${(value / 60).toFixed(1)}${hoursUnit}`;
                    return (
                        <Tooltip key={hour}>
                            <TooltipTrigger
                                render={
                                    <span
                                        role="img"
                                        tabIndex={0}
                                        aria-label={label}
                                        className="focus-visible:ring-ring/50 flex-1 rounded-[2px] outline-none focus-visible:ring-2"
                                        style={{
                                            backgroundImage: `linear-gradient(to top, ${tint} ${fill}%, transparent ${fill}%)`
                                        }}
                                    />
                                }
                            />
                            <TooltipContent>{label}</TooltipContent>
                        </Tooltip>
                    );
                })}
            </div>
            <div className="text-muted-foreground mt-2 flex justify-between text-[11px] tabular-nums">
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>23</span>
            </div>
        </div>
    );
}

export function ActivityRhythmExhibit({
    rawBuckets,
    normalizedBuckets,
    displayDayLabels,
    weekStartsOn,
    isDarkMode,
    palette
}: {
    rawBuckets: number[];
    normalizedBuckets: number[];
    displayDayLabels: string[];
    weekStartsOn: number;
    isDarkMode: boolean;
    palette: ActivityPalette | null;
}) {
    const { t } = useTranslation();
    const totals = hourTotals(rawBuckets);
    const peak = peakHour(rawBuckets);
    const lateNight = lateNightShare(rawBuckets);

    if (peak === null) {
        return null;
    }

    return (
        <Exhibit
            label={t('view.activity.section.when_you_play')}
            headline={USER_ACTIVITY_HOUR_LABELS[peak]}
            caption={
                lateNight > 0
                    ? t('view.activity.rhythm.late_night_share', {
                          percent: lateNight
                      })
                    : undefined
            }
            detailLabel={t('view.activity.rhythm.open_heatmap')}
            detail={
                palette ? (
                    <HeatmapChart
                        rawBuckets={rawBuckets}
                        normalizedBuckets={normalizedBuckets}
                        dayLabels={displayDayLabels}
                        hourLabels={USER_ACTIVITY_HOUR_LABELS}
                        weekStartsOn={weekStartsOn}
                        isDarkMode={isDarkMode}
                        emptyColor={palette['act-heat-empty']}
                        scaleColors={heatmapScaleColors(palette)}
                        unitLabel={t('view.activity.unit.minutes')}
                        squareCells
                        ariaDescription={t(
                            'view.activity.chart.heatmap_summary',
                            { peak: USER_ACTIVITY_HOUR_LABELS[peak] }
                        )}
                    />
                ) : null
            }
        >
            <HourStrip totals={totals} />
        </Exhibit>
    );
}
