import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { EmptyState } from '@/components/layout/PageScaffold';
import { Location } from '@/components/Location';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { getGameLogLocationTarget } from '../gameLogRows';
import {
    GAME_LOG_SESSION_FILTER_TYPES,
    type GameLogDetailValue,
    type GameLogRow
} from '../gameLogTypes';

const SESSION_FILTER_TYPES = GAME_LOG_SESSION_FILTER_TYPES;

function GameLogEmptyState({
    title,
    description,
    ...props
}: ComponentProps<typeof EmptyState>) {
    return <EmptyState {...props} title={title} description={description} />;
}

function EmptyTableValue(): null {
    return null;
}

function GameLogLocationDetail({
    row,
    detailValue,
    worldTarget,
    onPreviousInstances
}: {
    detailValue: GameLogDetailValue;
    onPreviousInstances?(row: GameLogRow): void;
    row: GameLogRow;
    worldTarget?: string;
}) {
    const location = getGameLogLocationTarget(row);
    const targetLocation = location || worldTarget;
    const primary = String(detailValue.primary || '');
    const secondary = String(detailValue.secondary || '');

    if (!targetLocation) {
        return (
            <Tooltip>
                <TooltipTrigger
                    render={
                        <div className="flex min-w-0 items-center gap-1.5 text-sm">
                            <span className="min-w-0 truncate">{primary}</span>
                            {secondary ? (
                                <span className="text-muted-foreground min-w-0 truncate text-xs">
                                    {secondary}
                                </span>
                            ) : null}
                        </div>
                    }
                />
                <TooltipContent>
                    {[primary, secondary].filter(Boolean).join(' · ')}
                </TooltipContent>
            </Tooltip>
        );
    }

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <div className="flex min-w-0 items-center gap-1.5 text-sm">
                        <Location
                            location={String(targetLocation)}
                            hint={String(row?.worldName || primary)}
                            grouphint={String(row?.groupName || '')}
                            enableContextMenu
                            showLaunchActions
                            onShowPreviousInstances={() => {
                                onPreviousInstances?.(row);
                            }}
                            className="text-sm"
                        />
                        {secondary ? (
                            <span className="text-muted-foreground min-w-0 truncate text-xs">
                                {secondary}
                            </span>
                        ) : null}
                    </div>
                }
            />
            <TooltipContent>
                {[primary, secondary].filter(Boolean).join(' · ')}
            </TooltipContent>
        </Tooltip>
    );
}

export {
    EmptyTableValue,
    GameLogEmptyState,
    GameLogLocationDetail,
    SESSION_FILTER_TYPES,
    DataTableSortButton as SortButton
};
import type { ComponentProps } from 'react';
