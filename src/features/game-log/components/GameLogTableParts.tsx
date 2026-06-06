import { ChevronRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { EmptyState } from '@/components/layout/PageScaffold';
import { Location } from '@/components/Location';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { getGameLogLocationTarget } from '../gameLogRows';
import {
    GAME_LOG_SESSION_FILTER_TYPES,
    type GameLogDetailValue,
    type GameLogFilterType,
    type GameLogRow
} from '../gameLogTypes';
import { GameLogSessionsView } from './GameLogSessionsView';

const SESSION_FILTER_TYPES = GAME_LOG_SESSION_FILTER_TYPES;

function GameLogEmptyState({
    title,
    description
}: {
    description?: string;
    title: string;
}) {
    return <EmptyState title={title} description={description} />;
}

function EmptyTableValue() {
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
    worldTarget?: unknown;
}) {
    const location = getGameLogLocationTarget(row);
    const targetLocation = location || worldTarget;
    const primary = String(detailValue.primary || '');
    const secondary = String(detailValue.secondary || '');

    if (!targetLocation) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="flex min-w-0 items-center gap-1.5 text-sm">
                        <span className="min-w-0 truncate">{primary}</span>
                        {secondary ? (
                            <span className="text-muted-foreground min-w-0 truncate text-xs">
                                {secondary}
                            </span>
                        ) : null}
                    </div>
                </TooltipTrigger>
                <TooltipContent>
                    {[primary, secondary].filter(Boolean).join(' · ')}
                </TooltipContent>
            </Tooltip>
        );
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            <TooltipContent>
                {[primary, secondary].filter(Boolean).join(' · ')}
            </TooltipContent>
        </Tooltip>
    );
}

function TypeFilterDropdown({
    types,
    selectedTypes,
    onSelectedTypesChange
}: {
    onSelectedTypesChange(types: GameLogFilterType[]): void;
    selectedTypes: readonly GameLogFilterType[];
    types: readonly GameLogFilterType[];
}) {
    const { t } = useTranslation();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="min-w-44 justify-between"
                >
                    <span>
                        {selectedTypes.length
                            ? `${selectedTypes.length}/${types.length}`
                            : t('view.game_log.filter_placeholder')}
                    </span>
                    <ChevronRightIcon
                        data-icon="inline-end"
                        className="text-muted-foreground rotate-90"
                    />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuGroup>
                    <DropdownMenuItem
                        onSelect={() => onSelectedTypesChange([])}
                    >
                        {t('view.search.avatar.all')}
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    {types.map((type) => (
                        <DropdownMenuCheckboxItem
                            key={type}
                            checked={selectedTypes.includes(type)}
                            onSelect={(event: any) => event.preventDefault()}
                            onCheckedChange={(checked: any) => {
                                onSelectedTypesChange(
                                    checked
                                        ? [...selectedTypes, type]
                                        : selectedTypes.filter(
                                              (entry) => entry !== type
                                          )
                                );
                            }}
                        >
                            {t(`view.game_log.filters.${type}`)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function TypeFilterToggleGroup({
    types,
    selectedTypes,
    onSelectedTypesChange,
    className = 'flex min-w-0 flex-wrap items-center gap-1'
}: {
    className?: string;
    onSelectedTypesChange(types: GameLogFilterType[]): void;
    selectedTypes: readonly GameLogFilterType[];
    types: readonly GameLogFilterType[];
}) {
    const { t } = useTranslation();

    return (
        <div className={className}>
            <Button
                type="button"
                variant={selectedTypes.length === 0 ? 'default' : 'outline'}
                size="sm"
                onClick={() => onSelectedTypesChange([])}
            >
                {t('view.search.avatar.all')}
            </Button>
            <ToggleGroup
                type="multiple"
                variant="outline"
                size="sm"
                spacing={1}
                value={[...selectedTypes]}
                onValueChange={(nextTypes) => {
                    onSelectedTypesChange(
                        nextTypes.length === types.length ? [] : nextTypes
                    );
                }}
                className="flex min-w-0 flex-wrap"
            >
                {types.map((type) => (
                    <ToggleGroupItem key={type} value={type}>
                        {t(`view.game_log.filters.${type}`)}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </div>
    );
}

export {
    EmptyTableValue,
    GameLogEmptyState,
    GameLogLocationDetail,
    GameLogSessionsView,
    SESSION_FILTER_TYPES,
    DataTableSortButton as SortButton,
    TypeFilterDropdown,
    TypeFilterToggleGroup
};
