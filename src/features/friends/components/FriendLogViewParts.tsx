import { ArrowRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { EmptyState } from '@/components/layout/PageScaffold';
import { openUserDialog } from '@/services/dialogService';
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

export { DataTableSortButton as SortButton };

export function FriendLogEmptyState({ title, description }: any) {
    return <EmptyState title={title} description={description} />;
}

export function friendLogTypeLabel(type: any, t: any) {
    return type ? t(`view.friend_log.filters.${type}`) : '';
}

export function FriendLogTypeFilterDropdown({ value, onChange }: any) {
    const { t } = useTranslation();
    const valueSet = new Set(value);
    const label = value.length
        ? value
              .map((type: any) => friendLogTypeLabel(type, t))
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
                    {FRIEND_LOG_TYPES.map((type: any) => (
                        <DropdownMenuCheckboxItem
                            key={type}
                            checked={valueSet.has(type)}
                            onSelect={(event: any) => event.preventDefault()}
                            onCheckedChange={(checked: any) => {
                                onChange(
                                    checked
                                        ? [...value, type]
                                        : value.filter(
                                              (entry: any) => entry !== type
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

export function renderUserCell(row: any) {
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
