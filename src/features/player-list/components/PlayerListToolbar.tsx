import type { Table as ReactTable } from '@tanstack/react-table';
import { SearchIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { TableColumnVisibilityMenu } from '@/components/data-table/TableColumnVisibilityMenu';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

import type {
    PlayerListFilterScope,
    PlayerListScopeCounts
} from '../playerListFilters';
import type { PlayerListRow } from '../playerListTypes';

const FILTER_SCOPES = [
    'all',
    'friend',
    'favorite',
    'restricted'
] satisfies readonly PlayerListFilterScope[];

type PlayerListToolbarProps = {
    counts: PlayerListScopeCounts;
    onQueryChange: (query: string) => void;
    onResetLayout: () => void;
    onScopeChange: (scope: PlayerListFilterScope) => void;
    query: string;
    scope: PlayerListFilterScope;
    table: ReactTable<PlayerListRow>;
};

function isPlayerListFilterScope(
    value: string
): value is PlayerListFilterScope {
    return FILTER_SCOPES.some((scope) => scope === value);
}

export function PlayerListToolbar({
    counts,
    onQueryChange,
    onResetLayout,
    onScopeChange,
    query,
    scope,
    table
}: PlayerListToolbarProps) {
    const { t } = useTranslation();
    const scopeLabels: Record<PlayerListFilterScope, string> = {
        all: t('view.player_list.label.all'),
        friend: t('view.player_list.label.friends'),
        favorite: t('view.player_list.label.favorites'),
        restricted: t('view.player_list.label.restricted')
    };

    return (
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
            <InputGroup className="w-full min-w-48 sm:w-64">
                <InputGroupAddon>
                    <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder={t('view.player_list.label.search_placeholder')}
                    aria-label={`${t('common.actions.search')} · ${t('nav_tooltip.player_list')}`}
                />
                {query ? (
                    <InputGroupAddon align="inline-end">
                        <InputGroupButton
                            type="button"
                            size="icon-xs"
                            aria-label={t('common.actions.clear')}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => onQueryChange('')}
                        >
                            <XIcon data-icon="icon" />
                        </InputGroupButton>
                    </InputGroupAddon>
                ) : null}
            </InputGroup>

            <ToggleGroup
                variant="outline"
                size="sm"
                value={[scope]}
                onValueChange={(value) => {
                    const nextScope = value[0];
                    if (nextScope && isPlayerListFilterScope(nextScope)) {
                        onScopeChange(nextScope);
                    }
                }}
                className="max-w-full overflow-x-auto"
            >
                {FILTER_SCOPES.map((filterScope) => (
                    <ToggleGroupItem
                        key={filterScope}
                        value={filterScope}
                        aria-label={scopeLabels[filterScope]}
                    >
                        {scopeLabels[filterScope]}
                        <span className="text-muted-foreground tabular-nums group-data-pressed/toggle:text-current">
                            {counts[filterScope]}
                        </span>
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>

            <div className="ml-auto">
                <TableColumnVisibilityMenu
                    table={table}
                    onResetLayout={onResetLayout}
                />
            </div>
        </div>
    );
}
