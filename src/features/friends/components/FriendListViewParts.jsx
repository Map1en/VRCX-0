import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    ChevronDownIcon
} from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/layout/PageScaffold.jsx';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

import { FRIEND_LIST_SEARCH_FILTERS as SEARCH_FILTERS } from '../friendListState.js';

export function SortButton({ column, label, descFirst = false }) {
    const direction = column.getIsSorted();

    return (
        <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground h-auto justify-start gap-1 p-0 text-left text-xs font-medium tracking-wide uppercase"
            onClick={() => {
                if (!direction && descFirst) {
                    column.toggleSorting(true);
                    return;
                }
                column.toggleSorting(direction === 'asc');
            }}
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

export function FriendListEmptyState({ title, description }) {
    return <EmptyState title={title} description={description} />;
}

export function FriendListSearchFilterDropdown({ value, onChange }) {
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
                    {SEARCH_FILTERS.map((filter) => (
                        <DropdownMenuCheckboxItem
                            key={filter.id}
                            checked={activeFilters.has(filter.id)}
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={(checked) => {
                                const next = new Set(activeFilters);
                                if (checked) {
                                    next.add(filter.id);
                                } else {
                                    next.delete(filter.id);
                                }
                                onChange(next);
                            }}
                        >
                            {filter.label}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
