import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    ChevronRightIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/layout/PageScaffold.jsx';
import { Location } from '@/components/Location.jsx';
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

import { getGameLogLocationTarget } from '../gameLogRows.js';
import { GameLogSessionsView } from './GameLogSessionsView.jsx';

const SESSION_FILTER_TYPES = ['OnPlayerJoined', 'OnPlayerLeft', 'VideoPlay'];
function SortButton({ column, label }) {
    const direction = column.getIsSorted();

    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-auto justify-start px-0 py-0 text-left text-xs font-medium tracking-wide uppercase"
            onClick={() => column.toggleSorting(direction === 'asc')}
        >
            <span>{label}</span>
            {direction === 'asc' ? (
                <ArrowUpIcon data-icon="inline-end" />
            ) : direction === 'desc' ? (
                <ArrowDownIcon data-icon="inline-end" />
            ) : (
                <ArrowUpDownIcon data-icon="inline-end" />
            )}
        </Button>
    );
}

function GameLogEmptyState({ title, description }) {
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
}) {
    const location = getGameLogLocationTarget(row);
    const targetLocation = location || worldTarget;

    if (!targetLocation) {
        return (
            <div
                className="flex min-w-0 items-center gap-1.5 text-sm"
                title={[detailValue.primary, detailValue.secondary]
                    .filter(Boolean)
                    .join(' · ')}
            >
                <span className="min-w-0 truncate">{detailValue.primary}</span>
                {detailValue.secondary ? (
                    <span className="text-muted-foreground min-w-0 truncate text-xs">
                        {detailValue.secondary}
                    </span>
                ) : null}
            </div>
        );
    }

    return (
        <div
            className="flex min-w-0 items-center gap-1.5 text-sm"
            title={[detailValue.primary, detailValue.secondary]
                .filter(Boolean)
                .join(' · ')}
        >
            <Location
                location={targetLocation}
                hint={row?.worldName || detailValue.primary}
                grouphint={row?.groupName || ''}
                enableContextMenu
                showLaunchActions
                onShowPreviousInstances={() => void onPreviousInstances?.(row)}
                className="text-sm"
            />
            {detailValue.secondary ? (
                <span className="text-muted-foreground min-w-0 truncate text-xs">
                    {detailValue.secondary}
                </span>
            ) : null}
        </div>
    );
}

function TypeFilterDropdown({ types, selectedTypes, onSelectedTypesChange }) {
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
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={(checked) => {
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
}) {
    const { t } = useTranslation();

    function toggleType(type) {
        const nextTypes = selectedTypes.includes(type)
            ? selectedTypes.filter((entry) => entry !== type)
            : [...selectedTypes, type];

        onSelectedTypesChange(
            nextTypes.length === types.length ? [] : nextTypes
        );
    }

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
            {types.map((type) => (
                <Button
                    key={type}
                    type="button"
                    variant={
                        selectedTypes.includes(type) ? 'default' : 'outline'
                    }
                    size="sm"
                    onClick={() => toggleType(type)}
                >
                    {t(`view.game_log.filters.${type}`)}
                </Button>
            ))}
        </div>
    );
}

export {
    EmptyTableValue,
    GameLogEmptyState,
    GameLogLocationDetail,
    GameLogSessionsView,
    SESSION_FILTER_TYPES,
    SortButton,
    TypeFilterDropdown,
    TypeFilterToggleGroup
};
