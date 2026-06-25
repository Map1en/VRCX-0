import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type { FeedTimeDisplayModePreference } from '@/state/preferencesStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { FeedDetailCell } from '../components/FeedDetailCell';
import {
    FeedUserAvatarButton,
    FeedUserLink
} from '../components/FeedTableParts';
import type { FeedColumnDensityConfig } from '../feedColumnsDensity';
import { resolveFeedColumnTimeDisplay } from '../feedTimeDisplay';
import type {
    FeedFriendActions,
    FeedLocationActionPayload,
    FeedRow
} from '../feedTypes';

type FeedColumnItemProps = {
    actions: FeedFriendActions;
    animateEntry?: boolean;
    densityConfig: FeedColumnDensityConfig;
    loadingPreviousInstancesKey: string;
    nowMs: number;
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

function FeedColumnTime({ label, title }: { label: string; title: string }) {
    return (
        <div className="ml-auto flex shrink-0 items-center">
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="text-muted-foreground text-[11px] tabular-nums">
                        {label}
                    </span>
                </TooltipTrigger>
                <TooltipContent>{title}</TooltipContent>
            </Tooltip>
        </div>
    );
}

export function FeedColumnItem(props: FeedColumnItemProps) {
    const {
        animateEntry = false,
        densityConfig,
        nowMs,
        row,
        showTypeHint,
        timeDisplayMode
    } = props;
    const { t } = useTranslation();
    const type = String(row?.type || '');
    const typeLabel = type ? t(`view.feed.filters.${type}`) : '';
    const showAvatar = densityConfig.showAvatar;
    const time = resolveFeedColumnTimeDisplay({
        mode: timeDisplayMode,
        nowMs,
        t,
        value: row?.created_at
    });

    return (
        <>
            <div
                className={cn(
                    'border-border/35 hover:bg-accent/20 group/feed-column-item bg-background/20 flex min-w-0 items-start border-b transition-colors',
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
                                label={time.label}
                                title={time.title}
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
