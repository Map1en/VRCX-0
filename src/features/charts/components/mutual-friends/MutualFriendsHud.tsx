import { RefreshCcwIcon, SearchIcon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { MutualFriendsFetchProgress } from '@/lib/mutual-friends/mutualFriendsTypes';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

import { MutualFriendsSurface } from './MutualFriendsSurface';

function FetchProgressPill({
    progress
}: {
    progress: MutualFriendsFetchProgress;
}) {
    const { t } = useTranslation();
    const percent = progress.totalFriends
        ? Math.min(
              100,
              Math.round(
                  (progress.processedFriends / progress.totalFriends) * 100
              )
          )
        : 0;

    return (
        <MutualFriendsSurface className="animate-in fade-in-0 slide-in-from-top-1 w-64 px-3 py-2.5 duration-200 ease-out">
            <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-foreground truncate font-medium">
                    {t('view.charts.mutual_friend.progress.fetching')}
                </span>
                <span className="text-muted-foreground tabular-nums">
                    {progress.processedFriends} / {progress.totalFriends}
                </span>
            </div>
            <div className="bg-muted mt-2 h-1 w-full overflow-hidden rounded-full">
                <div
                    className="bg-primary h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none"
                    style={{ width: `${percent}%` }}
                />
            </div>
        </MutualFriendsSurface>
    );
}

export function MutualFriendsHud({
    baseNodeCount,
    canFetch,
    fetchProgress,
    isReloading,
    onCancelFetch,
    onFetchGraph,
    onRefreshPage,
    onSearchQueryChange,
    searchQuery,
    settingsSlot
}: {
    baseNodeCount: number;
    canFetch: boolean;
    fetchProgress: MutualFriendsFetchProgress;
    isReloading: boolean;
    onCancelFetch: () => void;
    onFetchGraph: () => void;
    onRefreshPage: () => void;
    onSearchQueryChange: (value: string) => void;
    searchQuery: string;
    settingsSlot: ReactNode;
}) {
    const { t } = useTranslation();

    return (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start gap-3">
            <div className="pointer-events-auto flex flex-col gap-2">
                <MutualFriendsSurface className="flex items-center gap-2 p-1.5">
                    {fetchProgress.isFetching ? (
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={fetchProgress.cancelRequested}
                            onClick={onCancelFetch}
                        >
                            {fetchProgress.cancelRequested
                                ? t(
                                      'view.charts.mutual_friend.actions.cancelling'
                                  )
                                : t(
                                      'view.charts.mutual_friend.actions.stop_fetching'
                                  )}
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            size="sm"
                            disabled={!canFetch}
                            onClick={onFetchGraph}
                        >
                            {baseNodeCount
                                ? t(
                                      'view.charts.mutual_friend.actions.fetch_again'
                                  )
                                : t(
                                      'view.charts.mutual_friend.actions.start_fetch'
                                  )}
                        </Button>
                    )}

                    {baseNodeCount ? (
                        <div className="relative">
                            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                            <Input
                                value={searchQuery}
                                onChange={(event) =>
                                    onSearchQueryChange(event.target.value)
                                }
                                placeholder={t(
                                    'view.charts.mutual_friend.actions.find_friend'
                                )}
                                className="h-8 w-56 pr-8 pl-8"
                            />
                            {searchQuery ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="absolute top-1/2 right-1 size-6 -translate-y-1/2"
                                    aria-label={t('common.actions.clear')}
                                    onClick={() => onSearchQueryChange('')}
                                >
                                    <XIcon className="size-3.5" />
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                </MutualFriendsSurface>

                {fetchProgress.isFetching ? (
                    <FetchProgressPill progress={fetchProgress} />
                ) : null}
            </div>

            <MutualFriendsSurface className="pointer-events-auto ml-auto flex items-center gap-1 p-1.5">
                <HintTooltip label={t('common.actions.refresh')}>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={isReloading}
                        onClick={onRefreshPage}
                    >
                        {isReloading ? <Spinner /> : <RefreshCcwIcon />}
                    </Button>
                </HintTooltip>
                {settingsSlot}
            </MutualFriendsSurface>
        </div>
    );
}
