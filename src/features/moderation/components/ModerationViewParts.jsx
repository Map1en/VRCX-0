import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react';

import { EmptyState } from '@/components/layout/PageScaffold.jsx';
import { moderationTypes } from '@/shared/constants';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

export function SortButton({ column, label }) {
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

export function ModerationEmptyState({ title, description }) {
    return <EmptyState title={title} description={description} />;
}

export function ModerationTypeFilterDropdown({
    value,
    onChange,
    getTypeLabel,
    sanitizeTypes = (types) => types
}) {
    const selectedTypes = Array.isArray(value) ? value : [];
    const label = selectedTypes.length
        ? `${selectedTypes.length} moderation filters`
        : 'Moderation filters';

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="h-9 min-w-0 flex-1 justify-start truncate"
                >
                    {label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuGroup>
                    {moderationTypes.map((type) => (
                        <DropdownMenuCheckboxItem
                            key={type}
                            checked={selectedTypes.includes(type)}
                            onCheckedChange={(checked) => {
                                const next = checked
                                    ? [...selectedTypes, type]
                                    : selectedTypes.filter(
                                          (entry) => entry !== type
                                      );
                                onChange(sanitizeTypes(next));
                            }}
                            onSelect={(event) => event.preventDefault()}
                        >
                            {getTypeLabel(type)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
