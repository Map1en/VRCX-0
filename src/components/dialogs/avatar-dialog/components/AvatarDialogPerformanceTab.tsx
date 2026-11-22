import { ExternalLinkIcon, RefreshCwIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
    AvatarStatsRecord,
    FileAnalysisRecord,
    PlatformFileAnalysis
} from '@/domain/entities/world';
import { cn } from '@/lib/utils';
import { openExternalLink } from '@/services/entityMediaService';
import type { PerformancePlatform } from '@/shared/constants/avatarPerformance';
import { assessPerformanceStat } from '@/shared/utils/avatarPerformance';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsList, TabsTab, TabsPanel } from '@/ui/shadcn/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { EntityDialogTabContent } from '../../EntityDialogScaffold';
import type { AvatarPlatformInfo } from '../avatarDialogTypes';
import {
    EMPTY_VALUE,
    PERFORMANCE_STAT_GROUPS,
    TRIANGLE_STAT,
    formatStatValue,
    type PerformanceStat,
    performanceDocsUrl,
    performanceRankClass,
    performanceRankFillClass
} from '../avatarPerformancePresentation';

const PLATFORM_TABS = [
    { key: 'pc', label: 'PC', analysisKey: 'standalonewindows' },
    { key: 'android', label: 'Android', analysisKey: 'android' },
    { key: 'ios', label: 'iOS', analysisKey: 'ios' }
] as const;
const STAT_GRID_CLASS =
    'grid grid-cols-1 @2xl/performance:grid-cols-2 @max-2xl/performance:[&>div:nth-child(even)]:bg-muted/30 @2xl/performance:[&>div:nth-child(4n+3)]:bg-muted/30 @2xl/performance:[&>div:nth-child(4n+4)]:bg-muted/30 @2xl/performance:[&>div:last-child:nth-child(odd)]:col-span-2';

function PerformanceFact({
    label,
    value,
    limit,
    unit,
    rank,
    ratio
}: {
    label: string;
    value: string;
    limit?: string;
    unit?: string;
    rank?: string;
    ratio?: number;
}) {
    const { t } = useTranslation();
    const rankLabel = rank
        ? t(`dialog.avatar.performance.ranks.${rank}`, { defaultValue: rank })
        : undefined;
    const rankClass = performanceRankClass(rank);
    const detail =
        rank === 'Poor' || rank === 'VeryPoor' ? rankLabel : undefined;
    const measured = value || EMPTY_VALUE;
    const suffix = unit && measured !== EMPTY_VALUE ? ` ${unit}` : '';
    return (
        <div className="min-w-0 px-3 py-2">
            <span className="text-muted-foreground block text-xs">{label}</span>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <Tooltip disabled={!rankLabel}>
                    <TooltipTrigger
                        render={
                            <span
                                className={cn(
                                    'min-w-0 text-sm font-semibold break-words tabular-nums',
                                    rankClass
                                )}
                            >
                                {limit
                                    ? `${measured}/${limit}${suffix}`
                                    : `${measured}${suffix}`}
                            </span>
                        }
                    />
                    <TooltipContent>{rankLabel}</TooltipContent>
                </Tooltip>
                {detail ? (
                    <span className={cn('text-xs', rankClass)}>{detail}</span>
                ) : null}
            </div>
            {ratio ? (
                <div className="bg-border mt-1.5 h-0.5 w-20 overflow-hidden rounded-full">
                    <div
                        className={cn(
                            'h-full rounded-full',
                            performanceRankFillClass(rank)
                        )}
                        style={{ width: `${Math.min(100, ratio * 100)}%` }}
                    />
                </div>
            ) : null}
        </div>
    );
}

function PerformanceMetric({
    stat,
    stats,
    targetPlatform
}: {
    stat: PerformanceStat;
    stats: AvatarStatsRecord;
    targetPlatform: PerformancePlatform;
}) {
    const { t, i18n } = useTranslation();
    const locale = i18n.language || 'en';
    const assessment = assessPerformanceStat(
        stat.key,
        stats[stat.key],
        targetPlatform
    );
    if (assessment.removed) {
        return null;
    }
    return (
        <PerformanceFact
            label={t(`dialog.avatar.performance.stat.${stat.label}`)}
            value={formatStatValue(stats[stat.key], stat.format, locale, t)}
            limit={
                stat.format === 'boolean' || assessment.maximum === undefined
                    ? undefined
                    : formatStatValue(
                          assessment.maximum,
                          stat.format,
                          locale,
                          t
                      )
            }
            unit={stat.unit}
            rank={assessment.rank}
            ratio={assessment.ratio}
        />
    );
}

function PlatformPerformanceSection({
    targetPlatform,
    analysis,
    onRefresh
}: {
    targetPlatform: PerformancePlatform;
    analysis?: FileAnalysisRecord;
    onRefresh?: () => void;
}) {
    const { t } = useTranslation();
    const stats = analysis?.avatarStats;
    const texture = assessPerformanceStat(
        'totalTextureUsage',
        stats?.totalTextureUsage,
        targetPlatform
    );
    return (
        <section className="@container/performance space-y-4">
            <div className={STAT_GRID_CLASS}>
                <PerformanceFact
                    label={t('dialog.avatar.performance.download_size')}
                    value={analysis?._fileSize || EMPTY_VALUE}
                />
                <PerformanceFact
                    label={t('dialog.avatar.performance.texture_memory')}
                    value={(analysis?._totalTextureUsage || '').replace(
                        / MB$/,
                        ''
                    )}
                    limit={
                        texture.maximum === undefined
                            ? undefined
                            : String(texture.maximum)
                    }
                    unit="MB"
                    rank={texture.rank}
                    ratio={texture.ratio}
                />
                <PerformanceFact
                    label={t('dialog.avatar.performance.uncompressed_size')}
                    value={analysis?._uncompressedSize || EMPTY_VALUE}
                />
                <PerformanceMetric
                    stat={TRIANGLE_STAT}
                    stats={stats ?? {}}
                    targetPlatform={targetPlatform}
                />
            </div>
            {stats ? (
                PERFORMANCE_STAT_GROUPS.map((group) => (
                    <section key={group.label} className="space-y-1.5 pt-2">
                        <h4 className="text-foreground px-3 text-sm font-semibold">
                            {t(
                                `dialog.avatar.performance.group.${group.label}`
                            )}
                        </h4>
                        <div className={STAT_GRID_CLASS}>
                            {group.stats.map((stat) => (
                                <PerformanceMetric
                                    key={stat.key}
                                    stat={stat}
                                    stats={stats}
                                    targetPlatform={targetPlatform}
                                />
                            ))}
                        </div>
                    </section>
                ))
            ) : (
                <div className="text-muted-foreground flex flex-wrap items-center gap-2 px-3 text-sm">
                    <span>
                        {t('dialog.avatar.performance.analysis_unavailable')}
                    </span>
                    {onRefresh ? (
                        <PerformanceRefreshButton onRefresh={onRefresh} />
                    ) : null}
                </div>
            )}
        </section>
    );
}

function PerformanceRefreshButton({ onRefresh }: { onRefresh: () => void }) {
    const { t } = useTranslation();
    return (
        <Button type="button" variant="outline" size="xs" onClick={onRefresh}>
            <RefreshCwIcon data-icon="inline-start" />
            {t('common.actions.refresh')}
        </Button>
    );
}

export function AvatarDialogPerformanceTab({
    platformInfo,
    fileAnalysis,
    loading = false,
    pending = false,
    onRefresh
}: {
    platformInfo: AvatarPlatformInfo;
    fileAnalysis: PlatformFileAnalysis;
    loading?: boolean;
    pending?: boolean;
    onRefresh?: () => void;
}) {
    const { t } = useTranslation();
    const [selectedPlatform, setSelectedPlatform] =
        useState<PerformancePlatform>('pc');
    const contentRef = useRef<HTMLDivElement>(null);
    const displayedPlatforms = PLATFORM_TABS.map(
        ({ key, label, analysisKey }) => ({
            key,
            label,
            platform: platformInfo[key],
            analysis: fileAnalysis[analysisKey]
        })
    ).filter(({ platform, analysis }) =>
        pending ? Boolean(analysis) : Boolean(platform.platform || analysis)
    );
    const activePlatform =
        displayedPlatforms.find(({ key }) => key === selectedPlatform) ??
        displayedPlatforms[0];
    const rating =
        activePlatform?.analysis?.performanceRating ||
        activePlatform?.platform.performanceRating ||
        EMPTY_VALUE;

    return (
        <EntityDialogTabContent value="performance">
            {loading ? (
                <div className="text-muted-foreground flex min-h-40 items-center justify-center gap-2 text-sm">
                    <Spinner />
                    <span>
                        {t('dialog.avatar.performance.analysis_loading')}
                    </span>
                </div>
            ) : (
                <div ref={contentRef} className="space-y-4">
                    {pending ? (
                        <div className="text-muted-foreground flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm">
                            <span>
                                {t(
                                    'dialog.avatar.performance.analysis_pending'
                                )}
                            </span>
                            {onRefresh ? (
                                <PerformanceRefreshButton
                                    onRefresh={onRefresh}
                                />
                            ) : null}
                        </div>
                    ) : null}
                    {activePlatform ? (
                        <Tabs
                            className="gap-4"
                            value={activePlatform.key}
                            onValueChange={(value) => {
                                const next = displayedPlatforms.find(
                                    ({ key }) => key === value
                                );
                                if (next) {
                                    setSelectedPlatform(next.key);
                                    const scrollContainer =
                                        contentRef.current?.parentElement;
                                    if (scrollContainer)
                                        scrollContainer.scrollTop = 0;
                                }
                            }}
                        >
                            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 px-3">
                                {displayedPlatforms.length > 1 ? (
                                    <TabsList size="sm">
                                        {displayedPlatforms.map(
                                            ({ key, label }) => (
                                                <TabsTab key={key} value={key}>
                                                    {label}
                                                </TabsTab>
                                            )
                                        )}
                                    </TabsList>
                                ) : null}
                                <div className="flex items-baseline gap-2">
                                    <span className="text-muted-foreground text-xs">
                                        {t('dialog.avatar.performance.rating')}
                                    </span>
                                    <span
                                        className={cn(
                                            'text-xl font-semibold',
                                            performanceRankClass(rating)
                                        )}
                                    >
                                        {t(
                                            `dialog.avatar.performance.ranks.${rating}`,
                                            { defaultValue: rating }
                                        )}
                                    </span>
                                </div>
                                <Button
                                    type="button"
                                    variant="link"
                                    size="xs"
                                    className="text-muted-foreground hover:text-foreground ml-auto h-auto p-0"
                                    onClick={() => {
                                        void openExternalLink(
                                            performanceDocsUrl(
                                                activePlatform.key
                                            )
                                        );
                                    }}
                                >
                                    <ExternalLinkIcon data-icon="inline-start" />
                                    {t(
                                        activePlatform.key === 'pc'
                                            ? 'dialog.avatar.performance.pc_rules'
                                            : 'dialog.avatar.performance.mobile_rules'
                                    )}
                                </Button>
                            </div>
                            {displayedPlatforms.map(({ key, analysis }) => (
                                <TabsPanel key={key} value={key}>
                                    <PlatformPerformanceSection
                                        targetPlatform={key}
                                        analysis={analysis}
                                        onRefresh={onRefresh}
                                    />
                                </TabsPanel>
                            ))}
                        </Tabs>
                    ) : null}
                </div>
            )}
        </EntityDialogTabContent>
    );
}
