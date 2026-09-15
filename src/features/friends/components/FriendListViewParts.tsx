import { ListFilterIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { EmptyState } from '@/components/layout/PageScaffold';
import {
    ToolbarFilterMenu,
    toolbarSearchScopeTrigger
} from '@/components/layout/ToolbarControls';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Tooltip } from '@/ui/shadcn/tooltip';

import { FRIEND_LIST_SEARCH_FILTERS as SEARCH_FILTERS } from '../friendListState';

export { DataTableSortButton as SortButton };

export function FriendListEmptyState({
    title,
    description
}: ComponentProps<typeof EmptyState>) {
    return <EmptyState title={title} description={description} />;
}

export function FriendListFilterDropdown({
    favoritesOnly,
    isFavoritesLoaded,
    onToggleFavoritesOnly
}: {
    favoritesOnly: boolean;
    isFavoritesLoaded: boolean;
    onToggleFavoritesOnly: () => void;
}) {
    const { t } = useTranslation();

    return (
        <ToolbarFilterMenu activeCount={favoritesOnly ? 1 : 0}>
            <DropdownMenuGroup>
                <DropdownMenuCheckboxItem
                    checked={favoritesOnly}
                    disabled={!isFavoritesLoaded}
                    onClick={(event) => event.preventDefault()}
                    onCheckedChange={() => onToggleFavoritesOnly()}
                >
                    {t('view.friend_list.favorites_only_tooltip')}
                </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
        </ToolbarFilterMenu>
    );
}

export function FriendListSearchScopeDropdown({
    value,
    onChange
}: {
    value: Set<string>;
    onChange: (value: Set<string>) => void;
}) {
    const { t } = useTranslation();
    const label = t('view.friend_list.search_scope');

    return (
        <DropdownMenu>
            <Tooltip>
                <DropdownMenuTrigger
                    render={toolbarSearchScopeTrigger({
                        active: value.size > 0,
                        icon: ListFilterIcon,
                        label
                    })}
                />
            </Tooltip>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                    {SEARCH_FILTERS.map((filter) => (
                        <DropdownMenuCheckboxItem
                            key={filter.id}
                            checked={value.has(filter.id)}
                            onClick={(event) => event.preventDefault()}
                            onCheckedChange={(checked) => {
                                const next = new Set(value);
                                if (checked) {
                                    next.add(filter.id);
                                } else {
                                    next.delete(filter.id);
                                }
                                onChange(next);
                            }}
                        >
                            {t(filter.labelKey)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
