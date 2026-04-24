import {
    ArrowDownIcon,
    ArrowRightIcon,
    ArrowUpDownIcon,
    ArrowUpIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/layout/PageScaffold.jsx';
import { openUserDialog } from '@/services/dialogService.js';
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

export const FRIEND_LOG_TYPES = [
    'Friend',
    'Unfriend',
    'FriendRequest',
    'CancelFriendRequest',
    'DisplayName',
    'TrustLevel'
];

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

export function FriendLogEmptyState({ title, description }) {
    return <EmptyState title={title} description={description} />;
}

export function friendLogTypeLabel(type, t) {
    return type ? t(`view.friend_log.filters.${type}`) : '';
}

export function FriendLogTypeFilterDropdown({ value, onChange }) {
    const { t } = useTranslation();
    const valueSet = new Set(value);
    const label = value.length
        ? value
              .map((type) => friendLogTypeLabel(type, t))
              .filter(Boolean)
              .join(', ')
        : t('view.friend_log.filter_placeholder');

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="min-w-56 justify-between"
                >
                    <span className="max-w-52 truncate">{label}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => onChange([])}>
                        {t('view.friend_log.filter_placeholder')}
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    {FRIEND_LOG_TYPES.map((type) => (
                        <DropdownMenuCheckboxItem
                            key={type}
                            checked={valueSet.has(type)}
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={(checked) => {
                                onChange(
                                    checked
                                        ? [...value, type]
                                        : value.filter(
                                              (entry) => entry !== type
                                          )
                                );
                            }}
                        >
                            {friendLogTypeLabel(type, t)}
                        </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function renderUserCell(row) {
    const displayName = row?.displayName || row?.userId || '';
    const userLabel = row?.userId ? (
        <Button
            type="button"
            variant="ghost"
            className="hover:text-primary h-auto justify-start p-0 text-left text-sm font-medium"
            onClick={() =>
                openUserDialog({
                    userId: row.userId,
                    title: displayName
                })
            }
        >
            {displayName}
        </Button>
    ) : (
        <div className="text-sm font-medium">{displayName}</div>
    );

    if (row?.type === 'DisplayName') {
        return (
            <div className="flex flex-wrap items-center gap-1 text-sm">
                <span className="text-muted-foreground">
                    {row.previousDisplayName || ''}
                </span>
                <ArrowRightIcon className="text-muted-foreground size-3.5" />
                {userLabel}
            </div>
        );
    }

    if (row?.type === 'TrustLevel') {
        return (
            <div className="flex flex-wrap items-center gap-1 text-sm">
                {userLabel}
                <span className="text-muted-foreground">
                    ({row.previousTrustLevel || ''}
                    <ArrowRightIcon className="mx-1 inline size-3.5" />
                    {row.trustLevel || ''})
                </span>
            </div>
        );
    }

    return userLabel;
}
