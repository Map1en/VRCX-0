import { useTranslation } from 'react-i18next';

import { useDateFormatPreferenceKey } from '@/components/data-table/TimestampText';
import { FeedDetailCell } from '@/components/feed/FeedDetailCell';
import type {
    FeedFriendActions,
    FeedLocationActionPayload,
    FeedRow
} from '@/components/feed/feedTypes';
import { useMinuteNowMs } from '@/lib/useMinuteNowMs';
import { cn } from '@/lib/utils';
import type { FeedTimeDisplayModePreference } from '@/state/preferencesStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    FeedUserAvatarButton,
    FeedUserLink
} from '../components/FeedTableParts';
import type { FeedColumnDensityConfig } from '../feedColumnsDensity';
import {
    formatFeedExactTime,
    formatFeedRelativeTime,
    getFeedRelativeTimeMinWidth
} from '../feedTimeDisplay';

type FeedColumnItemProps = {
    actions: FeedFriendActions;
    animateEntry?: boolean;
    densityConfig: FeedColumnDensityConfig;
    loadingPreviousInstancesKey: string;
    onOpenPreviousInstances(payload?: FeedLocationActionPayload): void;
    row: FeedRow;
    showTypeHint: boolean;
    timeDisplayMode: FeedTimeDisplayModePreference;
};

function FeedColumnTypeHint({
    type,
    typeLabel
}: {
    type: string;
    typeLabel: string;
}) {
    return (
        <span
            className="bg-muted/70 text-muted-foreground ring-border/40 max-w-24 shrink-0 truncate rounded-sm px-1.5 py-0 text-[10px] leading-4 font-medium ring-1"
            title={typeLabel || type}
        >
            {typeLabel || type}
        </span>
    );
}

function FeedRelativeTimeTitle({
    value
}: {
    value: string | null | undefined;
}) {
    return formatFeedRelativeTime(value, Date.now());
}

function FeedRelativeTimeLabel({
    value
}: {
    value: string | null | undefined;
}) {
    const nowMs = useMinuteNowMs();
    const minWidth = getFeedRelativeTimeMinWidth(useDateFormatPreferenceKey());
    return (
        <span
            className="text-muted-foreground inline-block text-right text-[11px] tabular-nums"
            style={{ minWidth }}
        >
            {formatFeedRelativeTime(value, nowMs)}
        </span>
    );
}

function FeedColumnTime({
    mode,
    value
}: {
    mode: FeedTimeDisplayModePreference;
    value: string | null | undefined;
}) {
    useDateFormatPreferenceKey();
    return (
        <div className="ml-auto flex shrink-0 items-center">
            <Tooltip>
                <TooltipTrigger
                    render={
                        mode === 'relative' ? (
                            <FeedRelativeTimeLabel value={value} />
                        ) : (
                            <span className="text-muted-foreground text-[11px] tabular-nums">
                                {formatFeedExactTime(value, 'short')}
                            </span>
                        )
                    }
                />
                <TooltipContent>
                    {mode === 'relative' ? (
                        formatFeedExactTime(value, 'long')
                    ) : (
                        <FeedRelativeTimeTitle value={value} />
                    )}
                </TooltipContent>
            </Tooltip>
        </div>
    );
}

export function FeedColumnItem(props: FeedColumnItemProps) {
    const {
        animateEntry = false,
        densityConfig,
        row,
        showTypeHint,
        timeDisplayMode
    } = props;
    const { t } = useTranslation();
    const type = row.type || '';
    const typeLabel = type ? t(`view.feed.filters.${type}`) : '';
    const showAvatar = densityConfig.showAvatar;

    return (
        <>
            <div
                className={cn(
                    'border-border/35 group/feed-column-item bg-background/20 flex min-w-0 items-start border-b transition-colors hover:bg-(--state-hover-surface)',
                    animateEntry && 'feed-column-row-new',
                    densityConfig.rowPaddingClassName
                )}
                style={{ height: densityConfig.rowHeight }}
            >
                <div
                    className={cn(
                        'min-w-0 flex-1',
                        showAvatar
                            ? 'grid grid-cols-[auto_minmax(0,1fr)]'
                            : 'flex flex-col',
                        densityConfig.itemClassName
                    )}
                >
                    {showAvatar ? (
                        <FeedUserAvatarButton
                            avatarSize={densityConfig.avatarSize}
                            className={densityConfig.avatarClassName}
                            row={row}
                        />
                    ) : null}
                    <div
                        className={cn(
                            'flex min-w-0 flex-col',
                            densityConfig.contentGapClassName
                        )}
                    >
                        <div
                            className={cn(
                                'flex min-w-0 items-center',
                                densityConfig.topRowGapClassName
                            )}
                        >
                            <FeedUserLink
                                actions={props.actions}
                                className={cn(
                                    'min-w-0 flex-1 px-0 py-0',
                                    densityConfig.userLinkClassName
                                )}
                                row={row}
                            />
                            {showTypeHint && type ? (
                                <FeedColumnTypeHint
                                    type={type}
                                    typeLabel={typeLabel}
                                />
                            ) : null}
                            <FeedColumnTime
                                mode={timeDisplayMode}
                                value={row?.created_at}
                            />
                        </div>
                        <div
                            className={cn(
                                'text-muted-foreground min-w-0 truncate',
                                densityConfig.detailClassName
                            )}
                        >
                            <FeedDetailCell
                                loadingHistoryKey={
                                    props.loadingPreviousInstancesKey
                                }
                                locationClassName="text-xs"
                                onNewInstance={
                                    props.actions.openFeedNewInstance
                                }
                                onOpenPreviousInstances={
                                    props.onOpenPreviousInstances
                                }
                                row={row}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
