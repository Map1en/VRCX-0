import { useTranslation } from 'react-i18next';

import { formatDateFilter } from '@/lib/dateTime';
import { cn } from '@/lib/utils';

import { MUTUAL_GRAPH_MIN_DEGREE_LIMITS } from '../../mutual-friends/mutualFriendsFilters';
import type {
    MutualFriendCommunity,
    MutualFriendsCoverage,
    MutualFriendsIsolatedCounts
} from '../../mutual-friends/mutualFriendsTypes';
import { CommitSlider } from './CommitSlider';
import { MutualFriendsSurface } from './MutualFriendsSurface';

export function MutualFriendsLegend({
    communities,
    coverage,
    focusedCommunity,
    isolatedCounts,
    minDegree,
    onMinDegreeChange,
    onToggleFocusedCommunity
}: {
    communities: MutualFriendCommunity[];
    coverage: MutualFriendsCoverage;
    focusedCommunity: number | null;
    isolatedCounts: MutualFriendsIsolatedCounts;
    minDegree: number;
    onMinDegreeChange: (value: number) => void;
    onToggleFocusedCommunity: (communityIndex: number) => void;
}) {
    const { t } = useTranslation();
    const namedCommunities = communities.filter(
        (community) => community.isNamed
    );
    const groupedCommunityCount = communities.length - namedCommunities.length;

    return (
        <MutualFriendsSurface className="animate-in fade-in-0 slide-in-from-bottom-2 pointer-events-auto absolute bottom-3 left-3 z-10 w-64 p-3 duration-200 ease-out">
            <div className="flex items-baseline justify-between">
                <span className="text-foreground text-xs font-medium">
                    {t('view.charts.mutual_friend.legend.circles')}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                    {namedCommunities.length}
                </span>
            </div>

            <div className="mt-2 flex flex-col gap-0.5">
                {namedCommunities.map((community) => {
                    const isFocused = focusedCommunity === community.index;
                    return (
                        <button
                            key={community.index}
                            type="button"
                            onClick={() =>
                                onToggleFocusedCommunity(community.index)
                            }
                            className={cn(
                                'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-[background-color,opacity] duration-150 ease-out',
                                'hover:bg-foreground/5 active:translate-y-px',
                                isFocused
                                    ? 'bg-foreground/10'
                                    : focusedCommunity !== null
                                      ? 'opacity-50'
                                      : ''
                            )}
                        >
                            <span
                                className="size-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: community.color }}
                            />
                            <span className="min-w-0 flex-1 truncate text-xs">
                                {community.label}
                            </span>
                            <span className="text-muted-foreground text-xs tabular-nums">
                                {community.size}
                            </span>
                        </button>
                    );
                })}
                {groupedCommunityCount > 0 ? (
                    <span className="text-muted-foreground px-1.5 py-1 text-xs">
                        {t('view.charts.mutual_friend.legend.more_circles', {
                            count: groupedCommunityCount
                        })}
                    </span>
                ) : null}
            </div>

            <div className="bg-border my-2.5 h-px" />

            <ul className="text-muted-foreground flex flex-col gap-1.5 text-xs">
                <li className="flex items-center gap-2">
                    <span className="flex w-4 shrink-0 items-center justify-center gap-0.5">
                        <span className="bg-muted-foreground/70 size-1 rounded-full" />
                        <span className="bg-muted-foreground/70 size-2.5 rounded-full" />
                    </span>
                    {t('view.charts.mutual_friend.legend.size_means_degree')}
                </li>
                <li className="flex items-center gap-2">
                    <span className="flex w-4 shrink-0 items-center justify-center">
                        <span className="border-muted-foreground/70 size-2.5 rounded-full border-[1.5px]" />
                    </span>
                    {t('view.charts.mutual_friend.legend.hollow_means_unknown')}
                </li>
            </ul>

            <div className="bg-border my-2.5 h-px" />

            <dl className="flex flex-col gap-1 text-xs">
                {coverage.friendCount > 0 ? (
                    <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-muted-foreground">
                            {t('view.charts.mutual_friend.legend.coverage')}
                        </dt>
                        <dd className="text-foreground tabular-nums">
                            {t(
                                'view.charts.mutual_friend.legend.coverage_value',
                                {
                                    fetched: coverage.fetchedCount,
                                    total: coverage.friendCount
                                }
                            )}
                        </dd>
                    </div>
                ) : null}
                {coverage.unavailableCount > 0 ? (
                    <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-muted-foreground">
                            {t(
                                'view.charts.mutual_friend.legend.coverage_unavailable'
                            )}
                        </dt>
                        <dd className="text-foreground tabular-nums">
                            {coverage.unavailableCount}
                        </dd>
                    </div>
                ) : null}
                {coverage.lastFetchedAt ? (
                    <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-muted-foreground">
                            {t(
                                'view.charts.mutual_friend.legend.coverage_updated'
                            )}
                        </dt>
                        <dd className="text-foreground truncate">
                            {formatDateFilter(coverage.lastFetchedAt, 'long')}
                        </dd>
                    </div>
                ) : null}
            </dl>

            <div className="mt-3 text-xs">
                <CommitSlider
                    label={t('view.charts.mutual_friend.legend.min_degree')}
                    help={
                        isolatedCounts.noConnections > 0 ||
                        isolatedCounts.unavailable > 0
                            ? [
                                  isolatedCounts.noConnections > 0
                                      ? t(
                                            'view.charts.mutual_friend.legend.isolated_nodes',
                                            {
                                                count: isolatedCounts.noConnections
                                            }
                                        )
                                      : '',
                                  isolatedCounts.unavailable > 0
                                      ? t(
                                            'view.charts.mutual_friend.legend.unavailable_nodes',
                                            {
                                                count: isolatedCounts.unavailable
                                            }
                                        )
                                      : ''
                              ]
                                  .filter(Boolean)
                                  .join(' · ')
                            : undefined
                    }
                    min={MUTUAL_GRAPH_MIN_DEGREE_LIMITS.min}
                    max={MUTUAL_GRAPH_MIN_DEGREE_LIMITS.max}
                    step={1}
                    value={minDegree}
                    onCommit={onMinDegreeChange}
                />
            </div>
        </MutualFriendsSurface>
    );
}
