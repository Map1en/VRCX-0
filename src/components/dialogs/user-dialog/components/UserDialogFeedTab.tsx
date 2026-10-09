import { ArrowUpRightIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { DialogErrorState } from '@/components/dialogs/previous-instances-table/PreviousInstancesViewParts';
import { FeedDetailCell } from '@/components/feed/FeedDetailCell';
import { getFeedRowId } from '@/components/feed/feedRows';
import { FeedTypeIndicator } from '@/components/feed/FeedTypeIndicator';
import type { FeedLoadStatus, FeedRow } from '@/components/feed/feedTypes';
import {
    formatCompactDateTime,
    formatDateFilterOrFallback
} from '@/lib/dateTime';
import feedRepository from '@/repositories/feedRepository';
import {
    mergeFeedRowsWithLiveEntries,
    prepareFeedRowsForCommit,
    type FeedLiveMergeOptionsBuilder
} from '@/services/feedLiveMergeService';
import { buildFeedRoute } from '@/shared/utils/feedRouteScope';
import { useDialogStore } from '@/state/dialogStore';
import { useFriendLogStore } from '@/state/friendLogStore';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { EntityDialogTabContent } from '../../EntityDialogScaffold';
import type { UserDialogProfileRecord } from '../useUserDialogProfileResource';

export const USER_DIALOG_FEED_LIMIT = 50;

export function UserDialogFeedPanel({
    active,
    currentUserId,
    onOpenFullFeed,
    targetUserId
}: {
    active: boolean;
    currentUserId: string | null;
    onOpenFullFeed: () => void;
    targetUserId: string;
}) {
    const { t } = useTranslation();
    const friendLogRevision = useFriendLogStore((state) => state.revision);
    const [rows, setRows] = useState<FeedRow[]>([]);
    const [loadStatus, setLoadStatus] = useState<FeedLoadStatus>('idle');

    useEffect(() => {
        if (!active || !currentUserId || !targetUserId) {
            return undefined;
        }

        let requestActive = true;
        setRows([]);
        setLoadStatus('running');

        feedRepository
            .queryFeedLatest({
                userId: currentUserId,
                scopedUserIds: [targetUserId],
                maxRows: USER_DIALOG_FEED_LIMIT
            })
            .then(async (result) => {
                const buildMergeOptions: FeedLiveMergeOptionsBuilder = ({
                    rows
                }) => ({
                    rows,
                    userId: currentUserId,
                    scopedUserIds: [targetUserId],
                    maxRows: USER_DIALOG_FEED_LIMIT
                });
                const mergedResult = await mergeFeedRowsWithLiveEntries({
                    buildMergeOptions,
                    minLiveSequence: result.maxSequence,
                    requestIsCurrent: () => requestActive,
                    rows: result.rows
                });
                if (!mergedResult) {
                    return;
                }
                const commitResult = await prepareFeedRowsForCommit({
                    buildMergeOptions,
                    onMergeRound: () => undefined,
                    requestIsCurrent: () => requestActive,
                    result: mergedResult
                });
                if (!requestActive || !commitResult) {
                    return;
                }
                setRows(commitResult.rows);
                setLoadStatus('ready');
            })
            .catch((error: unknown) => {
                if (!requestActive) {
                    return;
                }
                console.error(error);
                setRows([]);
                setLoadStatus('error');
            });

        return () => {
            requestActive = false;
        };
    }, [active, currentUserId, friendLogRevision, targetUserId]);

    const openFeedLabel = t('nav_tooltip.feed');

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex min-h-8 items-center gap-2">
                <span className="text-muted-foreground text-sm font-medium">
                    {openFeedLabel}
                </span>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button
                                type="button"
                                variant="outline"
                                size="icon-sm"
                                className="ml-auto"
                                aria-label={openFeedLabel}
                                onClick={onOpenFullFeed}
                            >
                                <ArrowUpRightIcon className="size-4" />
                            </Button>
                        }
                    />
                    <TooltipContent>{openFeedLabel}</TooltipContent>
                </Tooltip>
            </div>

            {loadStatus === 'running' ? (
                <div className="text-muted-foreground flex min-h-52 flex-1 items-center justify-center gap-2 text-sm">
                    <Spinner className="size-4" />
                    {t('view.feed.loading.loading_feed_rows')}
                </div>
            ) : loadStatus === 'error' ? (
                <DialogErrorState>
                    {t('view.feed.error.feed_query_failed')}
                </DialogErrorState>
            ) : rows.length ? (
                <>
                    <div className="max-h-[33rem] min-h-0 flex-1 overflow-auto rounded-md border p-1">
                        {rows.map((row, index) => {
                            const createdAt = row.created_at;
                            const feedType = String(row.type || '');
                            return (
                                <div
                                    key={`${getFeedRowId(row)}:${index}`}
                                    className="grid min-h-9 grid-cols-[7rem_7rem_minmax(0,1fr)] items-center gap-3 rounded-md px-2 text-xs transition-colors duration-[120ms] hover:bg-(--state-hover-surface) motion-reduce:transition-none"
                                >
                                    <span
                                        className="text-muted-foreground tabular-nums"
                                        title={formatDateFilterOrFallback(
                                            createdAt,
                                            'long'
                                        )}
                                    >
                                        {formatCompactDateTime(createdAt) ||
                                            '-'}
                                    </span>
                                    <FeedTypeIndicator
                                        label={
                                            feedType
                                                ? t(
                                                      `view.feed.filters.${feedType}`
                                                  )
                                                : ''
                                        }
                                        type={feedType}
                                    />
                                    <div className="text-foreground/80 min-w-0 truncate font-normal">
                                        <FeedDetailCell row={row} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="text-muted-foreground text-center text-xs">
                        {rows.length} {t('view.feed.label.rows')}
                    </div>
                </>
            ) : loadStatus === 'ready' ? (
                <div className="text-muted-foreground flex min-h-40 flex-none items-center justify-center rounded-md border border-dashed px-4 text-center text-sm">
                    {t(
                        'view.feed.empty.no_feed_rows_match_the_current_filters'
                    )}
                </div>
            ) : null}
        </div>
    );
}

export function UserDialogFeedTab({
    active,
    currentUserId,
    profile
}: {
    active: boolean;
    currentUserId: string | null;
    profile: UserDialogProfileRecord;
}) {
    const navigate = useNavigate();
    const closeDialog = useDialogStore((state) => state.closeDialog);
    const targetUserId = profile.id || profile.userId || '';

    function openFullFeed() {
        closeDialog();
        navigate(buildFeedRoute([targetUserId]));
    }

    return (
        <EntityDialogTabContent value="feed" className="flex min-h-0 flex-col">
            <UserDialogFeedPanel
                active={active}
                currentUserId={currentUserId}
                onOpenFullFeed={openFullFeed}
                targetUserId={targetUserId}
            />
        </EntityDialogTabContent>
    );
}
