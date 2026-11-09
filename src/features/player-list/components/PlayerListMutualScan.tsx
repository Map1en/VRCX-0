import { EyeOffIcon, UsersRoundIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MutualGraphBuildHint } from '@/components/mutual-friends/MutualGraphBuildHint';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import type { usePlayerListMutuals } from '../usePlayerListMutuals';

type MutualScan = ReturnType<typeof usePlayerListMutuals>['scan'];

function CollapsedMutualScan({ scan }: { scan: MutualScan }) {
    const { t } = useTranslation();
    const startsQuery = !scan.completed || scan.hasPending;
    const label = !startsQuery
        ? t('view.player_list.mutual_friends.show')
        : scan.completed
          ? t('view.player_list.mutual_friends.requery')
          : t('view.player_list.mutual_friends.query');
    const disabled = startsQuery && !scan.canStart;

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span className="inline-flex">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={label}
                            data-vrcx-0-control="toolbar"
                            className="vrcx-0-quiet-control"
                            disabled={disabled}
                            onClick={startsQuery ? scan.start : scan.show}
                        >
                            <UsersRoundIcon data-icon="icon" />
                        </Button>
                    </span>
                }
            />
            <TooltipContent>
                {disabled && scan.isGraphFetching
                    ? t('view.player_list.mutual_friends.graph_fetch_running')
                    : label}
            </TooltipContent>
        </Tooltip>
    );
}

export function PlayerListMutualScan({ scan }: { scan: MutualScan }) {
    const { t } = useTranslation();
    const { progress, summary } = scan;
    const circlesSuffix = t('view.player_list.mutual_friends.circles_suffix');

    if (!progress && !scan.visible) {
        return <CollapsedMutualScan scan={scan} />;
    }

    return (
        <div className="flex min-w-0 items-center gap-2">
            {scan.needsGraphBuild ? (
                <MutualGraphBuildHint onBeforeNavigate={scan.stop} />
            ) : null}
            {summary && !progress ? (
                <span className="text-muted-foreground flex min-w-0 items-center gap-1 truncate text-xs">
                    <span className="shrink-0">
                        {t('view.player_list.mutual_friends.summary', {
                            count: summary.matchedCount
                        })}
                    </span>
                    {summary.circles.length ? (
                        <>
                            <span className="shrink-0">
                                ·{' '}
                                {t(
                                    'view.player_list.mutual_friends.circles_prefix'
                                )}
                            </span>
                            {summary.circles.map((circle) => (
                                <span
                                    key={circle.index}
                                    className="flex min-w-0 items-center gap-1"
                                >
                                    <span
                                        className="size-2 shrink-0 rounded-full"
                                        style={{
                                            backgroundColor: circle.color
                                        }}
                                    />
                                    <span className="text-foreground/80 truncate">
                                        {circle.label}
                                    </span>
                                </span>
                            ))}
                            {circlesSuffix ? (
                                <span className="shrink-0">
                                    {circlesSuffix}
                                </span>
                            ) : null}
                        </>
                    ) : null}
                </span>
            ) : null}
            {progress ? (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="tabular-nums"
                    aria-label={t('view.charts.mutual_friend.actions.stop')}
                    onClick={scan.stop}
                >
                    <Spinner data-icon="inline-start" />
                    {progress.done}/{progress.total}
                    <XIcon data-icon="inline-end" />
                </Button>
            ) : (
                <>
                    {scan.hasPending ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!scan.canStart}
                            onClick={scan.start}
                        >
                            <UsersRoundIcon data-icon="inline-start" />
                            {scan.completed
                                ? t('view.player_list.mutual_friends.requery')
                                : t('view.player_list.mutual_friends.query')}
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={scan.hide}
                    >
                        <EyeOffIcon data-icon="inline-start" />
                        {t('view.player_list.mutual_friends.hide')}
                    </Button>
                </>
            )}
        </div>
    );
}
