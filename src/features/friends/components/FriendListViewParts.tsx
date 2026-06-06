import { ChevronDownIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { EmptyState } from '@/components/layout/PageScaffold';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

import { FRIEND_LIST_SEARCH_FILTERS as SEARCH_FILTERS } from '../friendListState';

export { DataTableSortButton as SortButton };

export function FriendListEmptyState({ title, description }: any) {
    return <EmptyState title={title} description={description} />;
}

export function FriendListSearchFilterDropdown({ value, onChange }: any) {
    const { t } = useTranslation();
    const activeFilters = value instanceof Set ? value : new Set();
    const label = activeFilters.size
        ? `${activeFilters.size}/${SEARCH_FILTERS.length}`
        : t('view.friend_list.filter_placeholder');

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-36 justify-between"
                >
                    <span className="truncate">{label}</span>
                    <ChevronDownIcon
                        data-icon="inline-end"
                        className="text-muted-foreground"
                    />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuGroup>
                    {SEARCH_FILTERS.map((filter: any) => (
                        <DropdownMenuCheckboxItem
                            key={filter.id}
                            checked={activeFilters.has(filter.id)}
                            onSelect={(event: any) => event.preventDefault()}
                            onCheckedChange={(checked: any) => {
                                const next = new Set(activeFilters);
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
