import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { LogFilterMenuItems } from '@/components/data-table/LogFilterContextMenu';
import { Location } from '@/components/Location';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { useGameLogFilterCommands } from '../gameLogFilterCommands';
import {
    getGameLogLocationTarget,
    resolveGameLogWorldId
} from '../gameLogRows';
import { type GameLogDetailValue, type GameLogRow } from '../gameLogTypes';

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
    const filterCommands = useGameLogFilterCommands();
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
                            contextMenuExtraItems={
                                <LogFilterMenuItems
                                    commands={filterCommands}
                                    target={{
                                        worldId: resolveGameLogWorldId(row),
                                        worldName: String(row?.worldName || '')
                                    }}
                                />
                            }
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
    GameLogLocationDetail,
    DataTableSortButton as SortButton
};
